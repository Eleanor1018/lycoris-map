package com.lycoris.maps.feature.account

import android.graphics.Bitmap
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.lycoris.maps.core.data.AccountState
import com.lycoris.maps.core.designsystem.LycorisTheme
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.model.User
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.MemoryCookiePersistence
import com.lycoris.maps.core.network.SessionCookieJar
import com.lycoris.maps.feature.map.SearchBar
import okhttp3.Cookie
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Before
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Decode real PNG responses on-device, using only a loopback server and synthetic identities. */
class SearchAvatarTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private var originalProxy: ProxySelector? = null

    @Before fun keepSyntheticLoopbackTrafficInsideTheTestProcess() {
        originalProxy = ProxySelector.getDefault()
        ProxySelector.setDefault(object : ProxySelector() {
            override fun select(uri: URI): List<Proxy> =
                if (uri.host in setOf("localhost", "127.0.0.1", "::1", "[::1]")) listOf(Proxy.NO_PROXY)
                else originalProxy?.select(uri) ?: listOf(Proxy.NO_PROXY)
            override fun connectFailed(uri: URI, address: SocketAddress, failure: IOException) {
                originalProxy?.connectFailed(uri, address, failure)
            }
        })
    }

    @After fun restoreTestProcessProxy() { ProxySelector.setDefault(originalProxy) }

    @Test fun searchAvatarLoadsRefreshesAndDisappearsOnLogoutWithoutSendingCookies() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(image(Color.RED))
            server.enqueue(image(Color.BLUE))
            val origin = server.url("/")
            val cookies = SessionCookieJar(origin, MemoryCookiePersistence()).apply {
                saveFromResponse(origin, listOf(Cookie.Builder().name("session").value("synthetic-only").hostOnlyDomain(origin.host).build()))
            }
            val clients = ApiClients(origin.toString(), cookies, "LycorisAndroid/QA")
            val account = mutableStateOf(AccountState(initialized = true))
            var opened = 0
            compose.setContent { LycorisTheme { Surface {
                SearchBar("", {}, {}, {}, { SearchAccountAvatar(account.value, clients, Language.EN) },
                    { opened++ }, false, Modifier.fillMaxWidth())
            } } }
            compose.onNodeWithContentDescription("Not signed in", useUnmergedTree = true).assertIsDisplayed()
            val user = User("synthetic-a", nickname = "Nora Example", avatarUrl = "/uploads/avatars/first.png")
            compose.runOnIdle { account.value = AccountState(initialized = true, user = user, epoch = 1) }
            awaitImage("NE")
            val first = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            assertEquals("/uploads/avatars/first.png?variant=thumb", first.path)
            assertNull(first.getHeader("Cookie"))
            assertNull(first.getHeader("Authorization"))
            // Uploading a replacement changes the URL within the same login session.
            compose.runOnIdle { account.value = account.value.copy(user = user.copy(avatarUrl = "/uploads/avatars/replacement.png")) }
            awaitImage("NE")
            val replacement = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            assertEquals("/uploads/avatars/replacement.png?variant=thumb", replacement.path)
            compose.onNodeWithContentDescription("Account").performClick()
            compose.runOnIdle {
                assertEquals(1, opened)
                account.value = AccountState(initialized = true, epoch = 2)
            }
            compose.onNodeWithContentDescription("Avatar", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithContentDescription("Not signed in", useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithContentDescription("Account").performClick()
            compose.runOnIdle { assertEquals(2, opened) }
        }
    }

    @Test fun failedAndMissingAvatarsKeepTheAccountEntryUsable() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse().setResponseCode(404))
            val origin = server.url("/")
            val clients = ApiClients(origin.toString(), SessionCookieJar(origin, MemoryCookiePersistence()), "LycorisAndroid/QA")
            val account = mutableStateOf(AccountState(initialized = true,
                user = User("synthetic-b", nickname = "测试", avatarUrl = "/uploads/avatars/missing.png")))
            var opened = 0
            compose.setContent { LycorisTheme { Surface {
                SearchBar("", {}, {}, {}, { SearchAccountAvatar(account.value, clients, Language.ZH) },
                    { opened++ }, true, Modifier.fillMaxWidth())
            } } }
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("头像", useUnmergedTree = true).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText("测", useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithContentDescription("账号").performClick()
            compose.runOnIdle { account.value = account.value.copy(user = User("synthetic-c", nickname = "Alice Example"), epoch = 1) }
            compose.onNodeWithText("AE", useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithText("测", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithContentDescription("账号").performClick()
            compose.runOnIdle { assertEquals(2, opened) }
            assertEquals(1, server.requestCount)
        }
    }

    private fun awaitImage(initials: String) {
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText(initials, useUnmergedTree = true).fetchSemanticsNodes().isEmpty() &&
                compose.onAllNodesWithContentDescription("Avatar", useUnmergedTree = true).fetchSemanticsNodes().size == 1
        }
        compose.onNodeWithContentDescription("Avatar", useUnmergedTree = true).assertIsDisplayed()
    }

    private fun image(color: Int): MockResponse {
        val bitmap = Bitmap.createBitmap(24, 24, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
        val bytes = ByteArrayOutputStream().use { output -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); output.toByteArray() }
        bitmap.recycle()
        return MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(bytes))
    }
}
