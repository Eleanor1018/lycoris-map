package com.lycoris.maps.core.network

import android.content.Context
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.buffer
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class ApiClients(
    baseUrl: String,
    val cookies: SessionCookieJar,
    userAgent: String,
    publicMediaHosts: Set<String> = emptySet(),
    testEnvironment: Boolean = false,
) {
    val origin: HttpUrl = baseUrl.toHttpUrl().newBuilder().encodedPath("/").query(null).fragment(null).build()
    init {
        require(sameOrigin(origin, cookies.origin))
        require(origin.isHttps || origin.host in setOf("127.0.0.1", "localhost", "10.0.2.2"))
        require(origin.username.isEmpty() && origin.password.isEmpty())
    }

    private val base = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(35, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false) // POST/PATCH may already have committed.
        .followRedirects(false)
        .followSslRedirects(false)
        .cookieJar(CookieJar.NO_COOKIES)
        .cache(null)
        .addInterceptor { chain ->
            val request = chain.request().newBuilder()
                .header("User-Agent", userAgent)
                .removeHeader("Origin").removeHeader("Referer")
                .removeHeader("Sec-Fetch-Site").removeHeader("Sec-Fetch-Mode")
                .removeHeader("Authorization")
                .build()
            if (!sameOrigin(origin, request.url)) throw IOException("Invalid API origin")
            chain.proceed(request)
        }
        .addInterceptor(ResponseLimitInterceptor())
        .apply { if (testEnvironment) addInterceptor(QaEnvironmentGuard(origin, userAgent)) }
        .build()

    val publicClient: OkHttpClient = base.newBuilder().addInterceptor { chain ->
        chain.proceed(chain.request().newBuilder().removeHeader("Cookie").build())
    }.build()
    val publicApi: LycorisApi = api(publicClient)
    val media = MediaUrlResolver(origin, publicMediaHosts)
    private val imageRouting = ImageRouting(origin, testEnvironment)

    /** Public R2 images have a separate, cookie-free origin; the API origin lock stays intact. */
    val publicMediaClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(35, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .followRedirects(false)
        .followSslRedirects(false)
        .cookieJar(CookieJar.NO_COOKIES)
        .cache(null)
        .addInterceptor { chain ->
            val incoming = chain.request()
            if (incoming.method !in setOf("GET", "HEAD") || !imageRouting.allowsPublicRequest(incoming.url)) {
                throw IOException("Invalid public image request")
            }
            chain.proceed(incoming.newBuilder()
                .header("User-Agent", userAgent)
                .removeHeader("Cookie").removeHeader("Authorization").removeHeader("Proxy-Authorization")
                .removeHeader("Origin").removeHeader("Referer")
                .removeHeader("Sec-Fetch-Site").removeHeader("Sec-Fetch-Mode")
                .build())
        }
        .addInterceptor(ResponseLimitInterceptor())
        .build()

    fun resolveImage(
        value: String?,
        variant: ImageVariant = ImageVariant.ORIGINAL,
        publiclyVisible: Boolean = false,
    ): MediaResource? = imageRouting.resolve(value, variant, publiclyVisible)

    /** The fixed epoch travels with queued requests, so an old read cannot borrow new cookies. */
    fun authenticatedClient(epoch: Long): OkHttpClient = base.newBuilder()
        .addInterceptor(SessionInterceptor(cookies, epoch))
        .build()

    fun authenticatedApi(epoch: Long): LycorisApi = api(authenticatedClient(epoch))

    private fun api(client: OkHttpClient): LycorisApi = Retrofit.Builder()
        .baseUrl(origin)
        .client(client)
        .addConverterFactory(LycorisJson.asConverterFactory("application/json".toMediaType()))
        .build().create(LycorisApi::class.java)

    companion object {
        fun create(context: Context, baseUrl: String, userAgent: String, testEnvironment: Boolean = false): ApiClients {
            val origin = baseUrl.toHttpUrl().newBuilder().encodedPath("/").query(null).fragment(null).build()
            return ApiClients(baseUrl, SessionCookieJar(origin, EncryptedCookiePersistence(context, origin.toString())), userAgent, testEnvironment = testEnvironment)
        }
    }
}

private class SessionInterceptor(private val jar: SessionCookieJar, private val epoch: Long) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val snapshot = jar.snapshot(chain.request().url)
        if (snapshot.epoch != epoch) throw ApiFailure.SessionChanged()
        val request = chain.request().newBuilder().removeHeader("Cookie").apply {
            if (snapshot.cookies.isNotEmpty()) header("Cookie", snapshot.cookies.joinToString("; ") { "${it.name}=${it.value}" })
        }.build()
        val response = chain.proceed(request)
        try {
            jar.saveFromResponse(response.request.url, Cookie.parseAll(response.request.url, response.headers), epoch)
        } catch (error: Exception) {
            response.close()
            throw error
        }
        return response
    }
}

/** Applies to the entire decoded body, including chunked responses with no Content-Length. */
private class ResponseLimitInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val response = chain.proceed(chain.request())
        val original = response.body
        if (!response.isSuccessful) {
            // Retrofit buffers error bodies. Bound that buffer without losing HTTP status/headers.
            val bounded = original.use { body ->
                val source = body.source()
                source.request(8193)
                source.readByteArray(minOf(source.buffer.size, 8192)).toResponseBody(body.contentType())
            }
            return response.newBuilder().body(bounded).build()
        }
        val maximum = 16L * 1024 * 1024
        if (original.contentLength() > maximum) {
            response.close()
            throw ApiFailure.InvalidResponse()
        }
        val limited = object : ResponseBody() {
            private val limitedSource = object : ForwardingSource(original.source()) {
                var total = 0L
                override fun read(sink: Buffer, byteCount: Long): Long {
                    val read = super.read(sink, minOf(byteCount, maximum - total + 1))
                    if (read > 0) total += read
                    if (total > maximum) throw ApiFailure.InvalidResponse()
                    return read
                }
            }.buffer()
            override fun contentType(): MediaType? = original.contentType()
            override fun contentLength(): Long = original.contentLength()
            override fun source(): BufferedSource = limitedSource
        }
        return response.newBuilder().body(limited).build()
    }
}
