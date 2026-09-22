# Email verification and password recovery

## Contract

- `POST /api/auth/email-code`: `{ "email": "user@example.com", "purpose": "register" }`
  or purpose `reset_password`. `X-App-Language: zh` selects the Chinese email;
  otherwise English. Success returns `data.retryAfterSeconds: 60` and
  `data.expiresInSeconds: 600`. Account existence is not exposed by this endpoint:
  every valid requested mailbox receives a purpose-bound challenge. A missing,
  inactive or ambiguous account cannot reset a password.
- `POST /api/register`: existing fields plus required six-digit `verificationCode`.
  Success keeps the existing registration/session behavior. New accounts receive
  `email_verified_at`; migration 0007 leaves all historical accounts unverified.
- `POST /api/auth/reset-password`: `email`, `verificationCode`, `newPassword`.
  Success increments the account session version, invalidating all old sessions.
  It does not log in or issue a cookie. Clients return to login.

Codes are generated using the OS CSPRNG, expire after ten minutes, and can be
consumed once. Redis Lua makes consumption atomic under concurrent requests.
Only HMAC digests are stored; email/IP key suffixes also use keyed digests.
Purpose, normalized email and (for recovery) account ID/session version are bound
to the digest. A password change invalidates an older recovery challenge.

Five incorrect submissions against active challenges lock the email for one
hour, across both purposes. Resending never clears failed attempts or the lock.
After the lock expires, a fresh code starts a new attempt window. A successful
verification clears the failure counter. Missing/expired challenges cannot
verify. Failed SMTP deliveries never activate a challenge.

Mail quotas are atomic and server-enforced: one send per email per 60 seconds,
five per email per hour, 30 per source IP per hour, and 200 sends globally per
24-hour window. These conservative limits fit the current Gmail sender. Failed
SMTP attempts count toward quotas. At most two deliveries are in flight; SMTP
uses required STARTTLS with certificate validation and a 15-second outer timeout.

Errors use the existing JSON envelope. `429` also includes `Retry-After` and
`data.retryAfterSeconds` so clients can display the actual remaining cooldown:

| Code | Meaning |
| --- | --- |
| 40021 | Invalid, expired, consumed or mismatched code |
| 40022 | Invalid email address |
| 42931 | Five incorrect attempts; email locked |
| 42932 | Resend/hourly/daily quota reached |
| 50321 | SMTP, Redis, configuration or delivery temporarily unavailable |

The existing registration IP limiter also remains active. SMTP credentials and
`EMAIL_VERIFICATION_SECRET` never enter frontend builds or responses. Do not log
request bodies or codes. Preserve Redis data across restarts to retain locks.

## Configuration and coordinated rollout

Production Compose loads `/opt/lycoris/private/app.env` and the required private
`/opt/lycoris/private/smtp.env` (raw format, root mode 0600). The latter contains
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY=starttls`, `SMTP_USERNAME`,
`SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`, and a separate random
`EMAIL_VERIFICATION_SECRET` of at least 32 bytes. Use the Gmail app password
already configured privately, never the account password. No credentials belong
in this document or Git. An absent SMTP configuration returns 503 rather than
allowing unverified registration; an incomplete configured transport fails startup.

1. Prepare/build the backend image and matching Web, iOS and Android releases.
   Retain current image/config and take a database backup under the deployment lock.
2. Add the independent secret privately and verify the SMTP settings without
   printing them. Run migration 0007 explicitly; normal app startup never migrates.
3. Coordinate the backend switch with the owner's Web merge/deployment. Do not
   enable mandatory verification while the live registration form is still the
   old disabled placeholder. Publish updated native clients in the same release.
   Old clients can still log in, but registration now requires an upgrade.
4. Verify readiness and the live Web assets. Send a real verification email only
   to an explicitly authorized test address, then check registration/recovery with
   a disposable test account. Do not reset an existing user's password to test.
5. Keep the additive migration on application rollback. Preserve new accounts,
   session versions and Redis locks; investigate mail/config errors before
   changing enforcement.

## Local verification

`cargo test --lib email_verification` uses isolated Redis keys. The HTTP suite
`cargo test --test email_verification` uses temporary PostgreSQL databases,
isolated Redis and an injected mailbox (no real messages). It covers required
verification, replay rejection, missing accounts, SMTP failure, password change
and old-session invalidation. Existing account/media tests provision synthetic
challenges so the rest of the authenticated API continues to be exercised.

Recorded acceptance for this change: 5 Redis challenge tests, 5 email HTTP
tests, 29 account/session HTTP tests, 11 migration/readiness tests and 22 media
HTTP tests passed; `cargo clippy --all-targets --locked -- -D warnings` passed.
Web strict type checking/production build and 97 account/admin/contribution/map
regressions passed. Native acceptance is recorded in each app README. Local
Computer Use checked Chinese registration/recovery forms at 390×844 and 1280×900.
These checks do not claim a production verification-email delivery or rollout.
