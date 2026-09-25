# Email registration and password recovery

Android uses the same email-code endpoints as the web client. The account panel provides
`Log In → Create an Account` and `Log In → Forgot password?` in English and Chinese.

- Registration sends a code with purpose `register`, then submits the email, six ASCII
  digits, username and password to `/api/register`. A successful response establishes
  the normal account session.
- Recovery sends a code with purpose `reset_password`. Matching new passwords and the
  six-digit code are submitted to `/api/auth/reset-password`. Success clears the old
  session and returns to Log In with a confirmation; it does not automatically log in.
- Email is trimmed and lowercased. Basic address validation and the 254 UTF-8 byte limit
  run before sending; the backend remains the authoritative mailbox parser.
- Password validation follows the backend: at least four UTF-16 units, at most 72 UTF-8
  bytes. Existing passwords are not restricted by these new-password rules at login.

Sending blocks duplicate requests and edits to the recipient. Successful sends use
`retryAfterSeconds` and `expiresInSeconds` from the receipt. HTTP 429 reads `Retry-After`
with a fallback to `data.retryAfterSeconds`. A send quota blocks resending; a verification
lock also blocks code submission until its own deadline. Server-side limits remain
authoritative and are shared across registration and recovery for the same email.

Countdowns use elapsed realtime, so changing the device wall clock does not bypass them.
The current form restores its email and deadlines after recreation, but never stores
passwords or one-time codes in saved instance state. Leaving the panel cancels its UI
work; a late response cannot navigate back into a closed panel.

## Local verification

`AccountRepositoryTest`, `ApiFailureTest` and `EmailCodeStateTest` cover request/response
contracts, local validation, session behavior, retry headers/body and independent send
and verification deadlines. `AccountFormsTest` and `AccountEmailFlowTest` exercise native
UI behavior and the registration/recovery/login loop using a process-local MockWebServer.
They do not send real email or write to production accounts.

Run unit tests and lint with `:app:testQaUnitTest :app:lintQa`. With an emulator selected
using `ANDROID_SERIAL`, run the focused native tests:

```sh
./gradlew :app:connectedQaAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.lycoris.maps.feature.account.AccountFormsTest,com.lycoris.maps.feature.account.AccountEmailFlowTest,com.lycoris.maps.app.AppSmokeTest#accountAndRegisterReturnWithoutSubmittingCredentials
```

On API 37, the QA package needs local-network permission to reach its synthetic service.
Real SMTP delivery and inbox receipt are a separate manual check with an authorized test
mailbox; a passing local test does not assert delivery to a real mailbox.

Validated on 2026-09-25: 161 unit tests passed, lint reported no errors, and all 12 focused
device tests passed on the Pixel 10 Pro API 37 emulator with no skips. QA and minified
Preview builds succeeded. The device suite includes the real app's account-entry/back
navigation, local mail-service flows and form-state recreation.
