# Android delivery evidence

Base: `c139926` (main with merged iOS and Web interaction fixes).
Branch: `feat/android-native`; isolated worktree, no edits to the active iOS checkout.

| Stage | State | Evidence required |
|---|---|---|
| A0 | In progress | Reproducible build, running native map, isolated QA environment, provider checks |
| A1 | Pending | Figma comparison and sheet/keyboard/navigation interaction |
| A2 | Pending | Public browsing, request race/recovery and clustering tests |
| A3 | Pending | Location/heading implementation, emulator and device evidence |
| A4 | Pending | Accounts and favorites end-to-end in synthetic environment |
| A5 | Pending | Draft recovery, editing uncertainty and resumable image proposals |
| A6 | Pending | Settings, speech, share, navigation and strict links |
| A7 | Pending | Regression matrix, performance evidence, APK and release checklist |

Completion is determined from this evidence, not from the existence of code or a successful compile alone.

## 2026-09-20 foundation checks

- `:app:assembleQa` succeeded and the QA APK installed successfully on the dedicated AOSP API 36 ARM64 emulator (412 × 925 dp, no Google Play services).
- Native ARM64 and x86_64 libraries have 16384-byte ELF PT_LOAD alignment; APK `zipalign -c -P 16 4` passed. This is a packaging check, not a 16 KB runtime test.
- The configured browser-only Tianditu key returned 403 / 301012 for a real native WMTS request. OSM is retained; no forged browser headers are used.
- Visual map, camera recovery and sheet interaction acceptance are still outstanding.
