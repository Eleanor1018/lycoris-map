# Lycoris 🌸

[简体中文](./README.md) | [English](./README.en.md)

**Lycoris** is a platform offering **accessible facility information** and **community support information** for **transgender people**. 💗

The project currently includes these pages:

- Map: the **core of Lycoris**, where people can share accessible restrooms, trans-friendly clinics, baby care rooms, and other places.
- Documents: currently featuring **Nora's HRT Guide**, written to share practical HRT experience and lessons learned in clear, approachable language.
- About: the project's values, background, and contact details, explaining why we built this small light for our community.

Lycoris provides a **web application** and a previously published React Native app. The old app source is now retained locally in preparation for a native rewrite.

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

Developer overview: [Rust backend guide (Chinese)](./backend/README.md).

- `frontend`: new Web v2 project, React 19 + TypeScript 7 + Vite 8 + Tailwind 4 (S1 engineering foundation; pages incomplete)
- `frontend-old`: archived legacy web app, React + MUI + Leaflet, kept for behaviour comparison and rollback; no new features
- `backend`: Rust, Axum, and SQLx (default backend; no ORM)
- `backend-old`: deprecated Java / Spring Boot source, retained for current production and rollback reference
- `mobile`: legacy React Native app, retained locally; native rewrite pending
- Database: PostgreSQL with PostGIS; Redis for sessions, caching, and rate limiting

## License

This project is open source under the [MIT License](./LICENSE).

## Clone and initialize

This monorepo contains `backend` and `frontend`; `backend-old` holds legacy Java and `frontend-old` the archived legacy web app. The local `mobile/` tree is excluded from Git.

### 1. Prerequisites and source code

| Component | Repository requirements |
| --- | --- |
| JavaScript | Node.js 24.19.0 (pinned in `frontend/.nvmrc`) with pnpm 11.19.0 (pinned in `packageManager`). |
| Backend | rustup with Rust 1.98.1 pinned in `backend/rust-toolchain.toml`. Native Windows builds require Visual Studio C++ Build Tools. JDK/Maven are no longer backend requirements. |
| Database | Local Compose pins PostgreSQL 18.6 with PostGIS 3.6.4. Nearby queries use PostGIS candidate filtering and distance calculation. |
| Cache and sessions | Local Compose pins Redis 8.10.1. Login sessions require Redis. |

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

Start each section below from the repository root. Keep the backend and web server running in separate terminals.

### 2. Backend: Rust, database, and local startup

**`backend/` (Axum + SQLx) is the repository and local default.** Legacy Java in `backend-old/` remains available for current production and rollback reference. This change does not switch the production API.

Start PostgreSQL / PostGIS and Redis with Docker from the repository root:

```bash
docker compose -f backend/compose.test.yml up -d --wait
```

The Rust binary reads process environment variables; it does not load `.env` automatically. All settings are listed in `backend/.env.example`. These examples use the empty Compose development database; adjust the variables for another local database or upload directory.

Windows PowerShell:

```powershell
cd backend
$env:DATABASE_URL = 'postgres://lycoris:lycoris_local_test@127.0.0.1:55432/lycoris_rust'
$env:REDIS_URL = 'redis://127.0.0.1:56379'
$env:WRITE_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173'
$env:SQLX_OFFLINE = 'true'
```

macOS / Linux:

```bash
cd backend
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

Run Cargo inside `backend/` to select the pinned toolchain. The default address is `http://127.0.0.1:8080`; check `/health/ready` and `/api/markers/public`. An empty list is normal for a new database. Normal startup only checks migration state; existing Java databases require the [baseline adoption procedure](./backend/README.md).

Web requests to `/api` and `/uploads` use the Vite same-origin proxy. Update `WRITE_ALLOWED_ORIGINS` when the page port or hostname changes. For physical devices, also set `SERVER_HOST=0.0.0.0` and use the computer's LAN address.

Python development scripts and root `docs/` remain local and are excluded from Git. Existing local copies of `run-local.py` can still load `.env`; a fresh checkout uses the Cargo commands above and does not require Python. See the [Rust backend guide](./backend/README.md) for configuration and tests.

### 3. Web: install dependencies and start Vite

> **Current state: Web v2 is at the S1 engineering foundation.** The new project only contains the engineering shell and a backend-connectivity status screen; the full Figma pages arrive in later stages and this is not yet a usable product. For legacy behaviour, see [frontend-old](./frontend-old) (archived, no new features; its MUI/Cypress/legacy build commands apply to the old project only).

In a new terminal, start from the repository root:

```bash
cd frontend
pnpm install
pnpm dev
```

The dev server is fixed at `http://127.0.0.1:5173` (`strictPort`, so it cannot silently move ports and break the backend cookie/write-origin allowlist). Vite proxies `/api`, `/uploads` and the diagnostics-only `/health` same-origin to the local Rust backend at `http://127.0.0.1:8080`. The proxy target is a fixed local value: no environment variable, no server address or secret, and no `Origin` rewriting.

Build and checks:

```bash
pnpm build
pnpm typecheck
pnpm format:check
pnpm test:unit
```

Static output is written to `frontend/dist/`. The project has no ESLint or lint script; type boundaries are enforced by TypeScript 7 strict.

### S1 development verification entries (not product pages; the S1 build is not deployable)

S1 delivers only the engineering foundation and verification tools; the real map and account flows arrive in S2 and S4. The following paths are **included in the current S1 build output** (they are not dev-server-only and are not excluded from a production build), but are agreed to be used locally and not published, and they are not shippable features:

| Path | Purpose |
| --- | --- |
| `/` | Status screen: backend `/health/live` and `/health/ready` connectivity with retry |
| `/__dev/map-spike` | Map lifecycle verification: 200 fixed **synthetic** Shanghai points, a persistent Leaflet instance, language/panel/field-update/add-remove controls and an update cost reading |
| `/__dev/qa` | Local browser diagnostics: a 375×812 fixed CSS viewport iframe preview plus a dev session form (real `/api/login`, `/api/me`, avatar Blob, `/api/logout`; no registration, no password change, no hardcoded credentials) |

These diagnostics ship no deployment scripts, and the S1 build/static output is **not a deployable artefact**. Release and traffic switching belong to later tasks.

### 3.1 Legacy web app (frontend-old, archived reference)

`frontend-old` is the pre-refactor web app: React 19.2 + TypeScript 5.9 + Vite 7 + MUI + Leaflet, with Cypress specs. It exists only for rollback and behaviour comparison, and its install and build commands belong to that project:

```bash
cd frontend-old
npm ci
npm run dev
npm run build
npm run lint
```

Legacy notes about MUI components, Cypress end-to-end specs and the old `.env.local`/basemap key configuration apply to `frontend-old` only and do not affect the new `frontend`.

### 4. App: preparing for a native rewrite

The legacy React Native application remains in the local `mobile/` directory. Git ignores the entire directory, so fresh checkouts do not include it. Its previous development instructions remain locally in `mobile/README.md` and `mobile/IOS.md`.

A native application rewrite is planned. This change only reorganizes the repository; it does not create a new native app project. The APK download information above remains as a reference for the previously published version.
