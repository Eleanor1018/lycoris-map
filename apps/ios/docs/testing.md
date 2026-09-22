# iOS testing

Run tests from `apps/ios/` using the **Test** configuration. It fixes the backend at `127.0.0.1:8080`, including cold launches; UI write suites refuse other configurations. Debug/Release normally address the real API.

## Unit tests

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project Lycoris.xcodeproj -scheme Lycoris -configuration Test \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/lycoris-ios-tests \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- SWIFT_EMIT_LOC_STRINGS=NO \
  -only-testing:LycorisTests test
```

Use an installed simulator. Ad-hoc signing is required for Keychain tests. `SWIFT_EMIT_LOC_STRINGS=NO` prevents test builds from rewriting string catalogs.

## UI fixtures

These Python servers provide repeatable synthetic responses on loopback port 8080. Run only one at a time, with no other backend on that port:

| Script                                        | UI suites                                                           |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `scripts/account-regression-fixture.py`       | `AccountRegressionUITests`                                          |
| `scripts/accessibility-regression-fixture.py` | `AccessibilityRegressionUITests`                                    |
| `scripts/place-metadata-fixture.py`           | `PlaceMetadataUITests`, `IPadLayoutTests`, `IPadCompactWindowTests` |

Start the matching script in another terminal, then use the unit-test command above with `-parallel-testing-enabled NO` and the appropriate `-only-testing:LycorisUITests/<Suite>` instead. Use an iPad simulator for iPad suites. Fixture servers use in-memory accounts and places; they do not send real email or write production data.

Location-granted and location-denied tests need separate simulator permission states. Configure only the intended test simulator, record its prior state, and restore it afterward. Map, speech, heading, and navigation checks still need physical-device testing.

## Rust-backed account and contribution tests

Optional end-to-end suites use a separate synthetic Rust stack at loopback. Their preflight checks must pass before writes. Supply preseeded disposable accounts through these JSON environment values:

- `LYCORIS_I4_FIXTURE_JSON` and a distinct `LYCORIS_I4_SECOND_FIXTURE_JSON`: `username`, `email`, `password`.
- `LYCORIS_I5_FIXTURE_JSON`: `username`, `password`.

Do not use real account credentials or bypass email verification to register test users. Without the required fixture, these opt-in suites skip. A skipped suite is not evidence that its workflow passed.

For releases, record the tested commit, device/OS, configuration, and outstanding device checks with the build artifacts rather than adding dated execution logs to source control.
