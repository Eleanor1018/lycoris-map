package com.lycoris.maps.feature.account

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import com.lycoris.maps.core.data.AccountRepository
import com.lycoris.maps.core.designsystem.LycorisTheme
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.LycorisJson
import com.lycoris.maps.core.network.MemoryCookiePersistence
import com.lycoris.maps.core.network.SessionCookieJar
import java.io.IOException
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Native forms and the real repository talk only to a process-local synthetic mail service. */
class AccountEmailFlowTest {
    @get:Rule val compose = createComposeRule()

    private lateinit var server: MockWebServer
    private lateinit var repositoryScope: CoroutineScope
    private lateinit var clients: ApiClients
    private lateinit var accounts: AccountRepository
    private var originalProxy: ProxySelector? = null
    private val page = mutableStateOf(AccountPage.LOGIN)
    private val showing = mutableStateOf(true)
    private var signedIn = 0
    private val navigation = mutableListOf<AccountPage>()

    @Before fun startLocalMailService() {
        originalProxy = ProxySelector.getDefault()
        ProxySelector.setDefault(object : ProxySelector() {
            override fun select(uri: URI): List<Proxy> =
                if (uri.host in setOf("localhost", "127.0.0.1", "::1", "[::1]")) listOf(Proxy.NO_PROXY)
                else originalProxy?.select(uri) ?: listOf(Proxy.NO_PROXY)
            override fun connectFailed(uri: URI, address: SocketAddress, failure: IOException) {
                originalProxy?.connectFailed(uri, address, failure)
            }
        })
        server = MockWebServer().apply { start() }
        repositoryScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val origin = server.url("/")
        clients = ApiClients(origin.toString(), SessionCookieJar(origin, MemoryCookiePersistence()), "LycorisAndroid/EmailFlowTest")
        accounts = AccountRepository(clients, repositoryScope)
        runBlocking { accounts.restore() }
    }

    @After fun stopLocalMailService() {
        repositoryScope.cancel()
        server.shutdown()
        ProxySelector.setDefault(originalProxy)
    }

    @Test fun registrationThenRecoveryRequiresExplicitLoginWithTheNewPassword() {
        showPanel()
        tap("Create an Account")
        input("Username", "synthetic")
        input("Email", "Synthetic@Example.test")
        input("Password", "original-synthetic")
        server.enqueue(receipt())
        tap("Send code")
        val registerCode = request("/api/auth/email-code")
        assertEquals("register", registerCode.field("purpose"))
        assertEquals("synthetic@example.test", registerCode.field("email"))
        assertEquals("en", registerCode.getHeader("X-App-Language"))
        awaitText("A code has been sent. It expires in 10 minutes.")
        input("Verification Code", "123456")
        server.enqueue(signedInResponse())
        tap("Register")
        assertEquals("123456", request("/api/register").field("verificationCode"))
        awaitText("Log Out")
        compose.runOnIdle {
            assertEquals(1, signedIn)
            assertEquals("synthetic-user", accounts.state.value.user?.publicId)
        }
        server.enqueue(success())
        tap("Log Out")
        request("/api/logout")
        awaitText("Open account")
        tap("Open account")
        tap("Forgot password?")
        input("Email", "Synthetic@Example.test")
        server.enqueue(receipt())
        tap("Send code")
        val resetCode = request("/api/auth/email-code")
        assertEquals("reset_password", resetCode.field("purpose"))
        assertEquals("synthetic@example.test", resetCode.field("email"))
        awaitText("A code has been sent. It expires in 10 minutes.")
        input("New Password", "new-synthetic")
        input("Confirm Password", "new-synthetic")
        input("Verification Code", "654321")
        server.enqueue(success())
        tap("Reset Password")
        val reset = request("/api/auth/reset-password")
        assertEquals("654321", reset.field("verificationCode"))
        assertEquals("new-synthetic", reset.field("newPassword"))
        awaitText("Password reset. Sign in with your new password.")
        compose.runOnIdle {
            assertNull(accounts.state.value.user)
            assertFalse(clients.cookies.hasCookies())
            assertEquals(1, signedIn)
            assertEquals(AccountPage.LOGIN, page.value)
        }
        // Reset alone must never initiate /api/login or recreate a session.
        assertEquals(5, server.requestCount)
        compose.onNodeWithText("Log In").assertIsNotEnabled()
        input("Username or Email", "synthetic@example.test")
        input("Password", "new-synthetic")
        server.enqueue(signedInResponse())
        tap("Log In")
        val login = request("/api/login")
        assertEquals("synthetic@example.test", login.field("username"))
        assertEquals("new-synthetic", login.field("password"))
        awaitText("Log Out")
        compose.runOnIdle { assertEquals(2, signedIn) }
        assertEquals(6, server.requestCount)
    }

    @Test fun incorrectCodeLockDisablesResetAndResendUntilServerDeadline() {
        showPanel(AccountPage.RESET)
        fillRecovery()
        server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "2")
            .setBody("""{"code":42931,"message":"synthetic lock"}"""))
        tap("Reset Password")
        request("/api/auth/reset-password")
        awaitText("Too many incorrect codes. Try again after the countdown.")
        compose.onNodeWithText("Reset Password").assertIsNotEnabled()
        compose.onNodeWithText("Verification Code").assertIsNotEnabled()
        compose.onNodeWithText("Resend in", substring = true).assertIsNotEnabled().performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0, signedIn) }
        assertEquals(1, server.requestCount)
        compose.waitUntil(timeoutMillis = 5_000) { hasTextNode("Send code") }
        compose.onNodeWithText("Send code").assertIsEnabled()
        compose.onNodeWithText("Reset Password").assertIsEnabled()
        assertEquals(1, server.requestCount)
    }

    @Test fun closingRecoveryBeforeResponsePreventsLateNavigationOrSignIn() {
        val releaseResponse = CountDownLatch(1)
        val responseReleased = CountDownLatch(1)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                try {
                    check(releaseResponse.await(5, TimeUnit.SECONDS)) { "Test did not release the synthetic reset" }
                    return success()
                } finally {
                    responseReleased.countDown()
                }
            }
        }
        try {
            showPanel(AccountPage.RESET)
            fillRecovery()
            tap("Reset Password")
            request("/api/auth/reset-password")
            tap("Close account")
            awaitText("Open account")
            releaseResponse.countDown()
            assertTrue(responseReleased.await(5, TimeUnit.SECONDS))
            compose.waitUntil(timeoutMillis = 5_000) {
                clients.publicClient.dispatcher.runningCallsCount() == 0
            }
            compose.runOnIdle {
                assertEquals(AccountPage.RESET, page.value)
                assertTrue(navigation.isEmpty())
                assertEquals(0, signedIn)
                assertNull(accounts.state.value.user)
            }
            compose.onNodeWithText("Password reset. Sign in with your new password.").assertDoesNotExist()
            assertEquals(1, server.requestCount)
        } finally {
            releaseResponse.countDown()
        }
    }

    private fun showPanel(initialPage: AccountPage = AccountPage.LOGIN) {
        page.value = initialPage
        compose.setContent {
            LycorisTheme {
                Surface {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                        if (showing.value) {
                            TextButton(onClick = { showing.value = false }) { Text("Close account") }
                            AccountPanel(accounts, clients, Language.EN, page.value,
                                onPage = { navigation += it; page.value = it },
                                onSignedIn = { signedIn++; page.value = AccountPage.PROFILE },
                                onClose = { showing.value = false }, onMyPlaces = {})
                        } else {
                            TextButton(onClick = { page.value = AccountPage.LOGIN; showing.value = true }) {
                                Text("Open account")
                            }
                        }
                    }
                }
            }
        }
    }

    private fun fillRecovery() {
        input("Email", "synthetic@example.test")
        input("New Password", "new-synthetic")
        input("Confirm Password", "new-synthetic")
        input("Verification Code", "654321")
    }

    private fun input(label: String, value: String) {
        compose.onNode(hasSetTextAction() and hasText(label)).performScrollTo().performTextInput(value)
    }

    private fun tap(label: String) { compose.onNodeWithText(label).performScrollTo().performClick() }
    private fun hasTextNode(label: String) = compose.onAllNodesWithText(label).fetchSemanticsNodes().isNotEmpty()
    private fun awaitText(label: String) { compose.waitUntil(timeoutMillis = 5_000) { hasTextNode(label) } }
    private fun request(path: String): RecordedRequest = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS)).also {
        assertEquals("POST", it.method)
        assertEquals(path, it.path)
    }
    private fun RecordedRequest.field(name: String): String? =
        LycorisJson.parseToJsonElement(body.clone().readUtf8()).jsonObject[name]?.jsonPrimitive?.content
    private fun receipt() = MockResponse().setBody("""{"code":0,"data":{"retryAfterSeconds":60,"expiresInSeconds":600}}""")
    private fun success() = MockResponse().setBody("""{"code":0,"data":null}""")
    private fun signedInResponse() = MockResponse()
        .setBody("""{"code":0,"data":{"publicId":"synthetic-user","nickname":"Synthetic User","email":"synthetic@example.test"}}""")
        .setHeader("Set-Cookie", "session=synthetic-only; Path=/; Max-Age=600; HttpOnly")
}
