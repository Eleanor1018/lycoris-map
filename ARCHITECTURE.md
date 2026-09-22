# Architecture

Lycoris has three clients and one Rust API. PostgreSQL is the source of truth for accounts, places, bookmarks, and review decisions. Redis stores sessions, verification challenges, rate limits, and short-lived query caches.

## Repository

| Path                                                         | Responsibility                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `backend/src/app.rs`                                         | Axum routes, shared state, middleware, health checks                    |
| `backend/src/modules/markers/`                               | Place queries, localization, visibility, submissions, and review        |
| `backend/src/routes/`                                        | Account, admin, and media HTTP handlers                                 |
| `backend/src/media/`                                         | Image validation, storage, thumbnails, and resumable uploads            |
| `backend/src/auth.rs`, `session.rs`, `email_verification.rs` | Access control, sessions, email codes, and password recovery            |
| `backend/migrations/`, `queries/`, `.sqlx/`                  | Versioned schema, SQL, and offline query metadata                       |
| `frontend/src/app/`, `layouts/`                              | Web entry points, routing, desktop panels, and mobile sheets            |
| `frontend/src/features/`                                     | Map, search, accounts, bookmarks, contributions, settings, and admin UI |
| `frontend/src/shared/`                                       | API contracts, query keys, translations, and UI primitives              |
| `apps/ios/Lycoris/`                                          | SwiftUI features, MapKit integration, and native API/storage services   |
| `apps/android/app/src/main/`                                 | Compose features, map adapters, repositories, and persistent work       |

## Requests and storage

Web requests use same-origin `/api` and `/uploads` routes. Vite proxies them to the local API during development; the Cloudflare Pages Worker forwards them to the HTTPS backend in production. Native clients use the configured API origin directly.

Axum handlers validate requests and identities, then call domain services and SQLx repositories. Place writes use transactions and version checks. New places and proposed edits/photos pass through review. Admin removal deactivates records. Public reads exclude them; authenticated admin access supports review and recovery.

The backend keeps original images and generated renditions under its upload directory. The Pages Worker uses private R2 and edge caches for delivery, but checks current access with the backend before serving cached bytes. It must not serve cached media when authorization fails. Map tiles use provider adapters; OSM Web/Android tiles go through the edge Worker, not Rust.

## Boundaries to preserve

- **Identity:** an opaque cookie identifies a Redis session. Password changes invalidate old sessions through `session_version`. Admin mutations also require the configured secondary verification. Client account epochs keep late responses from repopulating a previous user's private state.
- **Email codes:** registration and password recovery use separate, single-use challenges. Redis atomically enforces expiry, resend quotas, and the shared one-hour lock after five wrong codes. SMTP credentials stay on the backend.
- **Coordinates:** storage, API requests, and contribution drafts use WGS84. Convert only at a provider's rendering, picking, or navigation boundary; never save display coordinates as geographic source data.
- **Map lifecycle:** panels and provider switches preserve the geographic camera. Viewport queries reuse a padded region within a scale band; stale requests cannot replace newer results.
- **Uploads:** persist the created place receipt before uploading its image. Reconcile server upload offsets and completion before retrying. An uncertain edit must not be replayed as if it were an idempotent creation.
- **Schema:** application startup checks migrations but never applies them. Run migrations explicitly. Applied SQL files are immutable because SQLx verifies their checksums.
- **Tests:** write tests use synthetic, isolated services. Production origins and real account data are not test fixtures.

## Client structure

Web features share a typed API layer and TanStack Query caches; private cache state follows the account lifecycle. Map and sheet geometry are separate from route content. Design previews and diagnostics load only in development builds.

iOS keeps its map alive beneath SwiftUI panels. Core services own API transport, account state, preferences, coordinates, and protected contribution drafts. Its Test configuration uses a loopback backend independently of Debug/Release.

Android keeps one Activity and a saved panel state. Repositories own account and place data; provider adapters own map rendering. Room checkpoints and WorkManager share the contribution engine, while the `qa` variant uses an isolated backend and app identity.

## Build and deployment

Cloudflare Pages builds `frontend/` and publishes `dist/` with its Worker. The Rust runtime is a Docker image behind Caddy, with PostgreSQL, Redis, and uploads on persistent volumes. Native apps build and release independently against the same API.

See the [backend](backend/README.md), [Web](frontend/README.md), [iOS](apps/ios/README.md), and [Android](apps/android/README.md) guides for commands. Deployment details live with the [backend configuration](backend/deploy/production/README.md) and [Pages Worker](frontend/deploy/cloudflare/README.md).
