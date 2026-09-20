# Android release signing

The direct-distribution Android package is `com.lycoris.maps`. A separate RSA 3072-bit app-signing key was created on 2026-09-20, with a SHA256withRSA certificate valid until 2056-09-12. Its alias is `lycoris-release`; the keystore uses PKCS12. This is a self-managed APK signing identity, not a Google Play registration or a publication of the app.

## Local configuration

The private files live outside the worktree, in `/Users/nora/.android/lycoris-signing/` (directory mode 700; files mode 600):

- `lycoris-release.keystore`: encrypted private key.
- `release.properties`: keystore path, alias and randomly generated passwords. Keep this private.
- `release-certificate.pem`: public certificate, without a private key.
- `certificate-info.txt`: public certificate metadata and fingerprints.
- `README.txt`: recovery and backup notes.

Ignored `apps/android/local.properties` contains only the pointer `lycoris.signingProperties=/Users/nora/.android/lycoris-signing/release.properties`, alongside its existing Android SDK configuration. No private key or password is committed. Back up the keystore and credentials to owner-controlled encrypted offline storage or a password manager; the directory on this Mac is not an off-device backup. Retain the same signing identity for APK updates.

The build resolves the credentials-file path in this order:

1. Environment variable `LYCORIS_ANDROID_SIGNING_PROPERTIES`.
2. Gradle property `lycoris.signingProperties`.
3. `lycoris.signingProperties` in ignored `local.properties`.

The external Java properties file must contain all four fields: `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. Use an absolute `storeFile` path; relative paths resolve from `apps/android`. If a credentials path is explicitly configured but is blank, missing or incomplete, configuration fails instead of silently producing an unsigned APK. With no configured path, release stays unsigned for the existing CI checks. Debug, QA and Preview continue using the debug certificate even when release signing is configured.

From `apps/android`:

```sh
./gradlew :app:signingReport :app:assembleRelease :app:bundleRelease
```

With valid signing configuration, outputs are `app/build/outputs/apk/release/app-release.apk` and `app/build/outputs/bundle/release/app-release.aab`. Verify APKs with the Android SDK's `apksigner verify --verbose --print-certs`. A signed bundle does not mean Google Play will distribute APKs with the same certificate: Play App Signing must be configured separately.

## Map-service registration

For an APK signed with this release key:

| Field | Value |
| --- | --- |
| Package | `com.lycoris.maps` |
| SHA-1 | `C9:8E:77:DB:E7:7C:79:67:A0:82:F1:66:F0:47:D4:D4:97:B9:37:54` |
| SHA-256 | `56:91:78:AC:A0:86:01:9F:85:79:73:87:98:E5:48:05:96:C1:B3:69:90:C9:13:2A:CF:46:45:48:EC:12:D1:1F` |

The current Mac's debug certificate has SHA-1 `BF:84:10:DB:13:5D:97:12:F2:32:90:7D:A6:20:FB:7A:B0:AE:8E:5E`. Dev uses `com.lycoris.maps.debug`, QA uses `com.lycoris.maps.qa`, and Preview uses `com.lycoris.maps.preview`. Register the actual package/certificate pair being installed; a release package registration does not authorize these suffixed packages. Fresh CI runners generate their own debug certificates, so their QA/Preview fingerprints are not the Mac's fingerprint.

GitHub's ordinary Android workflow receives no release private key or passwords and continues to publish unsigned release build artifacts. If Google Play distribution is added, register the certificate that signs the APKs delivered to users, not merely the upload certificate. See the official [Android signing and API-provider guidance](https://developer.android.com/studio/publish/app-signing).
