# I6 — settings and system experience

Completed locally on 2026-09-16, branch `feat/ios-native`. No deployment, production configuration, or main-branch merge.

## Delivered

- Figma `45:248` settings entries open native language, distance, Apple Maps source and About forms. English/Chinese and 1–50,000m radius persist, affect requests and invalidate stale responses. The map instance/camera survives preference changes.
- Model-generated categories, hours, distance origins and errors use the selected localization bundle. Current navigation titles update immediately. Existing contribution drafts keep their content language.
- The microphone starts native on-device speech recognition only after system permission and device support checks. The user confirms text before it becomes a search. Unsupported devices return to focused keyboard input. Permission denial offers Settings and an explicit retry; returning never automatically starts recording.
- Audio engine, tap, recognition task and pending permission callbacks are cleaned up on dismissal, backgrounding, interruptions or input loss. Recording stops after 55 seconds. No cloud speech fallback or saved audio file.
- Native sharing produces `lycoris://maps?markerId=<id>`. Cold/warm opening validates the route and fetches the current place. Public reads stay cookie-free; authenticated fallback verifies owner/epoch and keeps private content out of public caches. Closing a link sheet invalidates its completion.
- 44pt microphone/avatar/edit/handle targets; headings/detail focus for VoiceOver; updated annotation labels; one-column categories and stacked metadata at accessibility sizes; opaque panel under Reduce Transparency; existing nonanimated Reduce Motion path retained.
- Profile and password focus progression and dismissal; disabled password fields during writes; cleared password state on exit. Foreground location permission refresh clears revoked position references; denied access offers system Settings, temporary failures offer retry.
- Production launches contain no preview bookmarks or AA initials. Visual fixtures remain explicitly Debug-only; Release has no configured service endpoint until release setup.

## Verification

Xcode 26.6, Swift 6 complete concurrency checking, iOS 26.5 simulator.

| Check | Evidence |
| --- | --- |
| Unit suites | 65 tests passed, including preference persistence/validation, request radius and language, Int64 link parsing, stale-radius results, language-switch detail race, revoked position reference; all existing account/contribution suites passed |
| Map interaction UI | 3 passed: panel gestures and keyboard, bookmark preview/detail navigation, accessibility-size detail actions |
| I6 UI | 3 passed: language/radius restart persistence, largest text with voice keyboard fallback, cold/warm links and native sharing |
| Public-data regression UI | 4 passed against the identified loopback synthetic stack: empty search, every Nearby category with denied location, search/detail/share/Apple Maps, simulated location origin |
| Navigation language fix | The settings flow passed again with assertions that the open navigation bar changes language immediately |
| Builds | Debug and Release simulator builds succeeded |
| Computer Use | iPhone 17 Pro: Chinese/English map settings, native language form, unchanged map camera, actual unsupported on-device speech state |

Local logs: `/tmp/lycoris-ios-i6-unit.log`, `/tmp/lycoris-ios-i6-ui2.log`, `/tmp/lycoris-ios-i6-final-ui.log`, `/tmp/lycoris-ios-i6-final-release.log`. Curated screenshots are under `outputs/ios-i6` in the working task directory, including settings, range, accessibility text, voice fallback, share sheet and cold-link detail. No credential-bearing output is included.

## I7 and release boundaries

- This simulator reports no on-device speech model. Unsupported/keyboard behavior was actually verified; microphone capture, recognition quality, headset changes and real-device permission recovery still need our I7 device session. VoiceOver semantics were inspected; a spoken end-to-end accessibility walkthrough and device Reduce Transparency/Motion checks remain part of that session.
- The custom scheme needs Lycoris installed. HTTPS Universal Links, uninstalled-app fallback and AASA require the chosen public domain and release hosting; none were invented or published. Optional `lang` in an incoming link does not override the recipient's language setting.
- UI/API checks use existing synthetic fixtures on localhost. No real account or production data was needed. App signing, actual-device backend reachability, public domain/server configuration and distribution remain separate work.

Design reference: [Figma native settings](https://www.figma.com/design/nmsiDbbgm0LG0CSwXUSLPW/Lycoris-v2-design?node-id=45-248). Speech behavior follows Apple's [on-device support check](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition) and [device-only request setting](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition).
