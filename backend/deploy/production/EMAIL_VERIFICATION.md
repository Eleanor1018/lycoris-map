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

| Code  | Meaning                                                        |
| ----- | -------------------------------------------------------------- |
| 40021 | Invalid, expired, consumed or mismatched code                  |
| 40022 | Invalid email address                                          |
| 42931 | Five incorrect attempts; email locked                          |
| 42932 | Resend/hourly/daily quota reached                              |
| 50321 | SMTP, Redis, configuration or delivery temporarily unavailable |

The existing registration IP limiter also remains active. SMTP credentials and
`EMAIL_VERIFICATION_SECRET` never enter frontend builds or responses. Do not log
request bodies or codes. Preserve Redis data across restarts to retain locks.

## Configuration

Production Compose loads private `app.env` and `smtp.env` files. SMTP requires
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY=starttls`, `SMTP_USERNAME`,
`SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`, and an independent
`EMAIL_VERIFICATION_SECRET` of at least 32 bytes. With Gmail, use an app password,
not the account password. Keep these values out of Git, logs, and client builds.

Missing SMTP configuration returns 503 for code requests; incomplete configured
transport fails startup. Verification is never bypassed. Preserve Redis data
across restarts so quotas and lockouts remain effective.

Deploy a matching registration/recovery UI when enabling verification. Older
clients can log in, but registration requires the code field. Apply migration
0007 explicitly and retain it during compatible application rollbacks; existing
users remain unverified until a relevant verified flow succeeds. See the
[deployment procedure](README.md).

## Tests

`cargo test --lib email_verification` checks Redis challenges.
`cargo test --test email_verification` exercises HTTP flows with temporary
PostgreSQL databases, isolated Redis, and an injected mailbox. Tests cover
required codes, replay, SMTP failure, recovery, and old-session invalidation
without sending real messages. Test actual delivery only with a designated
disposable account and an authorized recipient.
