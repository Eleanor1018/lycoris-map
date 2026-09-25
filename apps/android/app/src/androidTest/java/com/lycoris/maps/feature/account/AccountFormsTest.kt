package com.lycoris.maps.feature.account

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import com.lycoris.maps.core.designsystem.LycorisTheme
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.network.EmailCodeReceipt
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AccountFormsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun loginWaitsForCredentialsAndDisablesDuplicateSubmission() {
        val busy = mutableStateOf(false)
        var submitted = 0
        compose.setContent {
            FormHost { LoginForm(Language.EN, busy.value, { _, _ -> submitted++; busy.value = true }, {}) }
        }
        compose.onNodeWithText("Log In").assertIsNotEnabled()
        field("Username or Email").performTextInput("synthetic")
        field("Password").performTextInput("synthetic-password")
        compose.onNodeWithText("Log In").assertIsEnabled().performClick()
        compose.onNodeWithText("Log In").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(1, submitted) }
    }

    @Test fun passwordIsMaskedAndNotRestoredAfterRecreation() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            FormHost { LoginForm(Language.EN, false, { _, _ -> }, {}) }
        }
        val password = hasSetTextAction() and hasText("Password")
        compose.onNode(password).performTextInput("synthetic-secret")
        compose.onNode(password and SemanticsMatcher.keyIsDefined(SemanticsProperties.Password)).assertExists()
        restoration.emulateSavedInstanceStateRestore()
        assertEquals("", compose.onNode(password).fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
    }

    @Test fun changingPasswordRequiresMatchingConfirmation() {
        var submitted = 0
        compose.setContent {
            FormHost { PasswordForm(Language.EN, false) { _, _ -> submitted++ } }
        }
        field("Current Password").performTextInput("old-synthetic")
        field("New Password").performTextInput("new-synthetic")
        field("Confirm New Password").performTextInput("different")
        compose.onNodeWithText("Change Password").assertIsNotEnabled()
        compose.onNodeWithText("The new passwords do not match.").assertExists()
        compose.runOnIdle { assertEquals(0, submitted) }
    }

    @Test fun registrationCanReturnToLoginWithChineseLabels() {
        var returned = false
        compose.setContent {
            FormHost {
                RegisterForm(Language.ZH, false, { _, _, _, _, _ -> }, { returned = true },
                    onSendCode = { EmailCodeReceipt(60, 600) })
            }
        }
        field("邮箱").assertExists()
        compose.onNodeWithText("注册").assertIsNotEnabled()
        compose.onNodeWithText("已有账号？登录").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(true, returned) }
    }

    @Test fun loginOffersPasswordRecoveryInBothLanguages() {
        val language = mutableStateOf(Language.EN)
        var recoveries = 0
        compose.setContent {
            FormHost { LoginForm(language.value, false, { _, _ -> }, {}, { recoveries++ }) }
        }
        compose.onNodeWithText("Forgot password?").performScrollTo().performClick()
        compose.runOnIdle { language.value = Language.ZH }
        compose.onNodeWithText("忘记密码？").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(2, recoveries) }
    }

    @Test fun recoveryRequiresValidEmailMatchingPasswordsAndSixAsciiDigits() {
        var submitted: Triple<String, String, String>? = null
        compose.setContent {
            FormHost {
                RecoveryForm(Language.EN, false, null, { EmailCodeReceipt(60, 600) },
                    { email, code, password -> submitted = Triple(email, code, password) }, {})
            }
        }
        field("Email").performTextInput("synthetic@")
        compose.onNodeWithText("Enter a valid email address.").assertExists()
        compose.onNodeWithText("Send code").assertIsNotEnabled()
        field("Email").performTextReplacement("synthetic@example.test")
        field("New Password").performTextInput("new-synthetic")
        field("Confirm Password").performTextInput("different")
        field("Verification Code").performTextInput("12345")
        compose.onNodeWithText("The new passwords do not match.").assertExists()
        compose.onNodeWithText("Reset Password").assertIsNotEnabled()
        field("Confirm Password").performTextReplacement("new-synthetic")
        compose.onNodeWithText("Reset Password").assertIsNotEnabled()
        // Non-ASCII digits and letters cannot satisfy the six-digit API contract.
        field("Verification Code").performTextReplacement("1a2３45")
        assertEquals("1245", editableText("Verification Code"))
        compose.onNodeWithText("Reset Password").assertIsNotEnabled()
        field("Verification Code").performTextReplacement("1234567")
        assertEquals("123456", editableText("Verification Code"))
        compose.onNodeWithText("Reset Password").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals(Triple("synthetic@example.test", "123456", "new-synthetic"), submitted)
        }
    }

    @Test fun sendingCodeLocksFormAndUsesServerReceiptBeforeAllowingResend() {
        val response = CompletableDeferred<EmailCodeReceipt>()
        var sends = 0
        compose.setContent {
            FormHost {
                RecoveryForm(Language.EN, false, null,
                    onSendCode = { sends++; response.await() }, onSubmit = { _, _, _ -> }, onLogin = {})
            }
        }
        field("Email").performTextInput("synthetic@example.test")
        field("Verification Code").performTextInput("123456")
        compose.onNodeWithText("Send code").performScrollTo().performClick()
        compose.onNodeWithText("Sending…").assertIsNotEnabled().performClick()
        compose.onNodeWithText("Email").assertIsNotEnabled()
        compose.onNodeWithText("Verification Code").assertIsNotEnabled()
        compose.onNodeWithText("Back to login").assertIsNotEnabled()
        compose.runOnIdle {
            assertEquals(1, sends)
            response.complete(EmailCodeReceipt(retryAfterSeconds = 2, expiresInSeconds = 91))
        }
        compose.onNodeWithText("A code has been sent. It expires in 91 seconds.").assertExists()
        compose.onNodeWithText("Resend in", substring = true).assertIsNotEnabled()
        field("Email").assertIsEnabled()
        assertEquals("", editableText("Verification Code"))
        // Cooldowns use elapsed realtime, so wait for the short receipt deadline rather than
        // moving the Compose animation clock (which must not bypass the server's cooldown).
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText("Send code").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Send code").assertIsEnabled()
        compose.runOnIdle { assertEquals(1, sends) }
        field("Verification Code").performTextInput("654321")
        field("Email").performTextReplacement("other@example.test")
        assertEquals("", editableText("Verification Code"))
        compose.onNodeWithText("A code has been sent. It expires in 91 seconds.").assertDoesNotExist()
    }

    @Test fun recoveryRestoresEmailAndCooldownWithoutRestoringSecretsOrResending() {
        val restoration = StateRestorationTester(compose)
        var sends = 0
        restoration.setContent {
            FormHost {
                RecoveryForm(Language.EN, false, null,
                    onSendCode = { sends++; EmailCodeReceipt(60, 600) },
                    onSubmit = { _, _, _ -> }, onLogin = {})
            }
        }
        field("Email").performTextInput("synthetic@example.test")
        compose.onNodeWithText("Send code").performScrollTo().performClick()
        compose.onNodeWithText("A code has been sent. It expires in 10 minutes.").assertExists()
        field("New Password").performScrollTo().performTextInput("new-synthetic")
        field("Confirm Password").performScrollTo().performTextInput("new-synthetic")
        field("Verification Code").performScrollTo().performTextInput("123456")
        compose.onNodeWithText("Reset Password").assertIsEnabled()

        restoration.emulateSavedInstanceStateRestore()

        assertEquals("synthetic@example.test", editableText("Email"))
        compose.onNodeWithText("Resend in", substring = true).assertIsNotEnabled()
        assertEquals("", editableText("New Password"))
        assertEquals("", editableText("Confirm Password"))
        assertEquals("", editableText("Verification Code"))
        compose.onNodeWithText("Reset Password").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(1, sends) }
    }

    private fun field(label: String) = compose.onNode(hasSetTextAction() and hasText(label))
    private fun editableText(label: String) = field(label).fetchSemanticsNode().config[SemanticsProperties.EditableText].text
}

@Composable
private fun FormHost(content: @Composable () -> Unit) {
    LycorisTheme {
        Surface {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(30.dp)) { content() }
        }
    }
}
