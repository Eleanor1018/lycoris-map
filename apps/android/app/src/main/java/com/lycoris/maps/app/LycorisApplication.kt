package com.lycoris.maps.app

import android.app.Application
import com.lycoris.maps.BuildConfig
import okhttp3.Cache
import okhttp3.OkHttpClient
import org.maplibre.android.MapLibre
import org.maplibre.android.module.http.HttpRequestUtil
import java.io.File
import java.util.concurrent.TimeUnit

class LycorisApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
        // This client is deliberately cookie-free and separate from account requests.
        HttpRequestUtil.setOkHttpClient(
            OkHttpClient.Builder()
                .cache(Cache(File(cacheDir, "map-http"), 64L * 1024 * 1024))
                .connectTimeout(15, TimeUnit.SECONDS)
                .callTimeout(30, TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    chain.proceed(chain.request().newBuilder()
                        .header("User-Agent", "LycorisAndroid/${BuildConfig.VERSION_NAME} (+https://lycoris-map.com)")
                        .build())
                }.build()
        )
        HttpRequestUtil.setPrintRequestUrlOnFailure(false)
    }
}
