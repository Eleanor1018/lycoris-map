# Lycoris 🌸

[简体中文](./README.md) | [English](./README.en.md)

**Lycoris** is a platform offering **accessible facility information** and **community support information** for **transgender people**. 💗

The project currently includes these pages:

- Map: the **core of Lycoris**, where people can share accessible restrooms, trans-friendly clinics, baby care rooms, and other places.
- Documents: currently featuring **Nora's HRT Guide**, written to share practical HRT experience and lessons learned in clear, approachable language.
- About: the project's values, background, and contact details, explaining why we built this small light for our community.

Lycoris is available as a **web application** and a **React Native mobile application**.

## Android APK download

[Download the Lycoris 1.0.1 Android APK](https://github.com/Eleanor1018/lycoris/releases/download/v1.0.1/Lycoris-v1.0.1.apk) · [SHA-256 checksum file](https://github.com/Eleanor1018/lycoris/releases/download/v1.0.1/Lycoris-v1.0.1.apk.sha256) · [Release notes](https://github.com/Eleanor1018/lycoris/releases/tag/v1.0.1)

This release is **Lycoris 1.0.1 (versionCode 3)** for **Android 7.0 and later**, with `arm64-v8a` and `x86_64` support. It retains the release signing key introduced on 2026-09-06 and can be sideloaded on devices.

**This APK cannot be installed over the old v1.0 or earlier development builds. Uninstall the old app first; uninstalling removes local sign-in state, settings, and other app data.**

The **1.0.3 test build (versionCode 2) from 2026-09-06, signed with the same certificate, can be updated directly** without uninstalling. This release displays version 1.0.1, while the `versionCode` Android uses to determine update order has increased from 2 to 3.

JavaScript and document assets are bundled, so **Metro is not required**. The APK connects to the production API at `https://api.lycoris.online`; online features such as maps and accounts require a network connection.

## Built-in map features

- Places: share accessible restrooms, friendly clinics, baby care rooms, and other places with names, photos, opening hours, and more.
- Nearby search: find accessible restrooms and other places within 0–10,000 meters of your location.
- Favorites: save places to a personal list for easy access later.

**New places and edits require administrator review to help prevent malicious changes. Thank you for understanding.**

## Our values

**Care and expertise can make everyday life safer for transgender people. Shared information can help us light the way for one another.**

Every transgender person deserves to live openly and confidently, without hiding who they are. Equal rights belong to everyone, including transgender people.

Social progress can be slow, but every small effort matters. We are starting with accessible restrooms.

We want people to open their phones and find a restroom they can use, reducing misunderstanding and uncomfortable encounters so that going out feels less daunting.

**You are not alone.** Whether you are exploring, struggling, or rebuilding your life, you deserve respect and to be taken seriously. When you need it, we hope to offer something practical that helps you feel safer and face less harm in the real world.

If this small light helps someone through a difficult night, everything we have done will have been worthwhile.

## Technology

Developer overview: [Rust backend guide (Chinese)](./backend-rust/README.md).

- `frontend`: React and TypeScript
- `backend-rust`: Rust, Axum, and SQLx (default backend; no ORM)
- `backend`: deprecated Java / Spring Boot source, retained for current production and rollback reference
- `mobile`: React Native and TypeScript, with Android / iOS native bridges
- Database: PostgreSQL with PostGIS; Redis for sessions, caching, and rate limiting

## License

This project is open source under the [MIT License](./LICENSE).

## Clone and initialize

This monorepo contains `backend-rust`, `frontend`, and `mobile`; `backend` holds the legacy Java implementation.

### 1. Prerequisites and source code

| Component | Repository requirements |
| --- | --- |
| JavaScript | Node.js 22, at least 22.12.0, or Node.js 20, at least 20.19.4, with npm. These satisfy both Vite 7 and React Native 0.83.1. |
| Backend | rustup with Rust 1.98.1 pinned in `backend-rust/rust-toolchain.toml`. Native Windows builds require Visual Studio C++ Build Tools. JDK/Maven are no longer backend requirements; Android builds still need their Java toolchain. |
| Database | Local Compose pins PostgreSQL 18.6 with PostGIS 3.6.4. Nearby queries use PostGIS candidate filtering and distance calculation. |
| Cache and sessions | Local Compose pins Redis 8.10.1. Login sessions require Redis. |
| Android | Android Studio, Android SDK Platform 36, Build-Tools 36.0.0, NDK 27.1.12297006, and an emulator or an Android device with USB debugging enabled. |
| iOS | macOS, full Xcode, Ruby/Bundler, and CocoaPods. See the [iOS guide](./mobile/IOS.md) for detailed requirements. |

The examples check out `refactor/rust-backend`, which contains the features described in this README:

```bash
git clone --branch refactor/rust-backend https://github.com/Eleanor1018/lycoris-map.git
cd lycoris-map
```

For an existing checkout, switch to that branch and update it. Install dependencies and configure each machine separately; do not copy `node_modules` from another computer.

```bash
git switch refactor/rust-backend
git pull
```

Start each section below from the repository root. Keep the backend, web server, and Metro running in separate terminals.

### 2. Backend: Rust, database, and local startup

**`backend-rust/` (Axum + SQLx) is the repository and local default.** Legacy Java in `backend/` remains available for current production and rollback reference. This change does not switch the production API.

Start PostgreSQL / PostGIS and Redis with Docker from the repository root:

```bash
docker compose -f backend-rust/compose.test.yml up -d --wait
```

The Rust binary reads process environment variables; it does not load `.env` automatically. All settings are listed in `backend-rust/.env.example`. These examples use the empty Compose development database; adjust the variables for another local database or upload directory.

Windows PowerShell:

```powershell
cd backend-rust
$env:DATABASE_URL = 'postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust'
$env:REDIS_URL = 'redis://127.0.0.1:56379'
$env:WRITE_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173'
$env:SQLX_OFFLINE = 'true'
```

macOS / Linux:

```bash
cd backend-rust
export DATABASE_URL='postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust'
export REDIS_URL='redis://127.0.0.1:56379'
export WRITE_ALLOWED_ORIGINS='http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173'
export SQLX_OFFLINE=true
```

Explicitly migrate a new development database once, then start the service. Use only the last command for daily development:

```bash
cargo run --locked -- --migrate
cargo run --locked
```

Run Cargo inside `backend-rust/` to select the pinned toolchain. The default address is `http://127.0.0.1:8080`; check `/health/ready` and `/api/markers/public`. An empty list is normal for a new database. Normal startup only checks migration state; existing Java databases require the [baseline adoption procedure](./backend-rust/README.md).

Web requests to `/api` and `/uploads` use the Vite same-origin proxy. Update `WRITE_ALLOWED_ORIGINS` when the page port or hostname changes. For physical devices, also set `SERVER_HOST=0.0.0.0` and use the computer's LAN address.

Python development scripts and root `docs/` remain local and are excluded from Git. Existing local copies of `run-local.py` can still load `.env`; a fresh checkout uses the Cargo commands above and does not require Python. See the [Rust backend guide](./backend-rust/README.md) for configuration and tests.

### 3. Web: install dependencies and start Vite

In a new terminal, start from the repository root:

```bash
cd frontend
npm ci
cp .env.example .env.local
```

Edit `frontend/.env.local`, keeping `VITE_API_BASE_URL=` empty for local development. Clear unused placeholder map keys, including `VITE_THUNDERFOREST_API_KEY` and `VITE_TIANDITU_API_KEY`, to use OSM.

```bash
npm run dev
```

Open the address printed in the terminal, normally `http://localhost:5173`. Vite proxies `/api` and `/uploads` to `http://127.0.0.1:8080`. To change the proxy target, set `VITE_BACKEND_URL` in the **environment of the process that starts Vite**. If the configured local certificate and key files exist, Vite automatically uses HTTPS; follow the address printed in the terminal.

Build and lint:

```bash
npm run build
npm run lint
```

Static output is written to `frontend/dist/`. For static deployment, set `VITE_API_BASE_URL` to the intended API origin; the development proxy is not included in the static output.

### 4. Mobile: install dependencies and run Android / iOS

In a new terminal, install the mobile application's locked JavaScript dependencies from the repository root:

```bash
cd mobile
npm ci
```

**Android:** Install the SDK/NDK versions listed above through Android Studio's SDK Manager. Configure `ANDROID_HOME` or `sdk.dir` in your local `android/local.properties`, then start an emulator or connect a debugging device.

```bash
cp .env.mobile.example .env.mobile
```

Edit `mobile/.env.mobile`. An Android emulator can reach a backend on your computer with `LY_API_BASE_URL=http://10.0.2.2:8080`; a physical device needs the computer's reachable LAN address. Leave unused map keys empty. This configuration is compiled into the native application, so reinstall the application after changing it.

Start Metro from `mobile/`:

```bash
npm start
```

In another terminal, also in `mobile/`, install and run the Android application:

```bash
npm run android
```

**iOS (macOS only):** Run `npm ci` again on the Mac, install full Xcode and Ruby/Bundler, then install the dependencies defined by the repository's Gemfile and Podfile:

```bash
bundle install
cd ios
bundle exec pod install
cd ..
npm start
```

In another terminal, run `npm run ios` from `mobile/`. The iOS development build derives the backend host from Metro and uses port 8080 by default. Configure custom Debug/Release addresses through `ios/RuntimeConfig.local.json`; iOS does not read Android's `.env.mobile`. See [mobile/IOS.md](./mobile/IOS.md) for Xcode, simulators, device networking, permissions, signing, and Archive instructions.

Mobile checks:

```bash
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

See [mobile/README.md](./mobile/README.md) for more mobile configuration details. Local development is separate from installing the test APK above. Future updates should retain this release's package identifier and signing key.
