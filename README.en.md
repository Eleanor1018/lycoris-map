# Lycoris 🌸

[简体中文](./README.md) | [English](./README.en.md)

**Lycoris** is a platform offering **accessible facility information** and **community support information** for **transgender people**. 💗

Production website: [lycoris-map.com](https://lycoris-map.com). The new Web app provides the map, nearby search, place details, bookmarks, contributions, accounts and settings, backed by Rust. The native iOS project is in `apps/ios/`; the React Native app is retained only as a historical reference.

## Historical Android APK (legacy)

[Download the Lycoris 1.0.1 Android APK](https://github.com/Eleanor1018/lycoris/releases/download/v1.0.1/Lycoris-v1.0.1.apk) · [SHA-256 checksum file](https://github.com/Eleanor1018/lycoris/releases/download/v1.0.1/Lycoris-v1.0.1.apk.sha256) · [Release notes](https://github.com/Eleanor1018/lycoris/releases/tag/v1.0.1)

This release is **Lycoris 1.0.1 (versionCode 3)** for **Android 7.0 and later**, with `arm64-v8a` and `x86_64` support. It retains the release signing key introduced on 2026-09-06 and can be sideloaded on devices.

**This APK cannot be installed over the old v1.0 or earlier development builds. Uninstall the old app first; uninstalling removes local sign-in state, settings, and other app data.**

The **1.0.3 test build (versionCode 2) from 2026-09-06, signed with the same certificate, can be updated directly** without uninstalling. This release displays version 1.0.1, while the `versionCode` Android uses to determine update order has increased from 2 to 3.

This historical APK is tied to `https://api.lycoris.online`. That backend has been retired, so use the new website instead; these download links are release archives.

## Built-in map features

- Places: share accessible restrooms, friendly clinics, baby care rooms, and other places with names, photos, opening hours, and more.
- Nearby search: find accessible restrooms and other places within a configurable radius of your location.
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

- `frontend`: new Web v2 project, React 19 + TypeScript 7 + Vite 8 + Tailwind 4 (production Web app on Cloudflare Pages)
- `frontend-old`: local-only legacy Web archive, removed from Git tracking and ignored; historical source remains in Git history
- `backend`: Rust, Axum, and SQLx (default backend; no ORM)
- `backend-old`: retired Java / Spring Boot implementation, retained as historical source
- `apps/ios`: native Swift / SwiftUI iOS app; legacy React Native `mobile/` is local-only
- Database: PostgreSQL with PostGIS; Redis for sessions, caching, and rate limiting

## License

This project is open source under the [MIT License](./LICENSE).

## Clone and initialize

This monorepo contains `backend`, `frontend` and `apps/ios`. `backend-old` holds legacy Java; `frontend-old/` and `mobile/` are local archives excluded from Git.

### 1. Prerequisites and source code

| Component | Repository requirements |
| --- | --- |
| JavaScript | Node.js 24.19.0 (pinned in `frontend/.nvmrc`) with pnpm 11.19.0 (pinned in `packageManager`). |
| Backend | rustup with Rust 1.98.1 pinned in `backend/rust-toolchain.toml`. Native Windows builds require Visual Studio C++ Build Tools. JDK/Maven are no longer backend requirements. |
| Database | Local Compose pins PostgreSQL 18.6 with PostGIS 3.6.4. Nearby queries use PostGIS candidate filtering and distance calculation. |
| Cache and sessions | Local Compose pins Redis 8.10.1. Login sessions require Redis. |

The examples check out the main branch:

```bash
git clone --branch main https://github.com/Eleanor1018/lycoris-map.git
cd lycoris-map
```

For an existing checkout, switch to that branch and update it. Install dependencies and configure each machine separately; do not copy `node_modules` from another computer.

```bash
git switch main
git pull
```

Start each section below from the repository root. Keep the backend and web server running in separate terminals.

### 2. Backend: Rust, database, and local startup

**`backend/` (Axum + SQLx) is the repository and local default.** The production API at `https://api.lycoris-map.com` already runs on the new server. `backend-old/` is historical source; do not restart a writer on the obsolete database copy.

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

> **`frontend/` is the sole production Web project.** Use it for development, testing and deployment. See the [Cloudflare deployment guide](./frontend/deploy/cloudflare/README.md).

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

### 3.1 Production deployment and development diagnostics

Cloudflare Pages Git integration tracks `main`, builds from `frontend/` and publishes `dist/`. Tests and type checks must pass before publishing the assets and same-origin API proxy. Development branches produce previews; merging a PR updates production without a manual ZIP upload.

`/__dev/map-spike`, `/__dev/qa` and `/__dev/places-performance` load synthetic diagnostics only in development mode and are excluded from production. Existing local `frontend-old/` copies are retained; fresh clones omit this archive. Retrieve historical source from a commit before the cutover if needed.

### 4. Native apps

See [apps/ios/README.md](./apps/ios/README.md) for the native iOS project. Native Android development follows later. Git ignores the legacy `mobile/` tree; APK links above document historical releases only.
