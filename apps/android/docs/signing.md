# Android signing

Release uses package `com.lycoris.maps`. Keep the signing key and passwords outside the repository, and retain the same identity for APK updates.

Point the build at a private Java properties file using, in order:

1. `LYCORIS_ANDROID_SIGNING_PROPERTIES` environment variable.
2. `lycoris.signingProperties` Gradle property.
3. `lycoris.signingProperties` in ignored `local.properties`.

The file requires `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. Prefer an absolute keystore path. Explicit missing or incomplete configuration fails the build; with no signing configuration, CI produces an unsigned release. Debug, QA, and Preview keep their debug signing identity.

From `apps/android/`:

```sh
./gradlew :app:signingReport :app:assembleRelease :app:bundleRelease
```

Signed outputs are `app/build/outputs/apk/release/app-release.apk` and `app/build/outputs/bundle/release/app-release.aab`. Verify the APK with the SDK's `apksigner verify --verbose --print-certs`.

Map-service registrations must match the package and certificate actually installed: Debug uses `.debug`, QA `.qa`, Preview `.preview`, and Release has no suffix. CI debug certificates can differ from a developer's local certificate. For Play distribution, use the certificate that signs delivered APKs, which may differ from the upload key.

Back up the private keystore and credentials separately from source code. Do not commit credentials, publish them as CI artifacts, or replace the established release key during routine builds.
