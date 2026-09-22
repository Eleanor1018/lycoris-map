# Android release checklist

Record the commit, APK checksum, device/OS, build variant, and results with release artifacts. See [isolated testing](testing-qa.md) and [signing](signing.md).

## Automated checks

From `apps/android/`:

```sh
./gradlew --no-daemon --max-workers=2 :app:testQaUnitTest :app:lintQa
./gradlew --no-daemon --max-workers=2 :app:assembleQa :app:assemblePreview :app:assembleRelease :app:assembleQaAndroidTest
./gradlew --no-daemon --max-workers=2 :app:connectedQaAndroidTest
```

The last command requires a test device. The [workflow](../../../.github/workflows/android.yml) tests QA on AOSP API 36 and API 26 without Google Play services; the second job reuses the already-built APKs. It does not sign or publish a release, start the optional synthetic backend, or use production credentials. Backend integration tests require explicit synthetic fixtures and otherwise skip.

## Device checks

- [ ] Install the intended signed release, verify its certificate and update path, and check the shipping ABIs and 16 KB page-size compatibility.
- [ ] Check minimum-SDK and current devices, including one without Google Play services.
- [ ] Check phone/tablet layouts, sheet dragging, keyboard behavior, TalkBack, large text, and contrast.
- [ ] Exercise location denial/retry, heading, voice input, provider switching, repeated zoom/pan, and background return.
- [ ] Verify registration codes, recovery, login/logout, bookmarks, profile changes, and account switching.
- [ ] Submit and edit synthetic places; interrupt and resume image uploads without duplicate submissions.
- [ ] Verify navigation app choices and cold/warm place links, including invalid or unavailable IDs.
- [ ] Test actual provider keys and attribution on the signed package. Local fixture tests cannot prove provider authorization.
- [ ] Check privacy disclosures, permissions, retained drafts, and photo handling against the shipping app.

## Distribution

Configure release signing before distribution. Publish and verify Android App Links for the shipping package/certificate; an intent parser test does not establish domain verification. Keep the signed artifact, mapping file, checksums, and device results with the release. A successful QA/Preview build alone does not complete these checks.
