# Lycoris Web

React and TypeScript, with Vite, Tailwind CSS, TanStack Query, and Leaflet. Tool versions are pinned in `.nvmrc` and `package.json`; TypeScript strict mode is enabled.

## Run locally

Start the [Rust backend](../backend/README.md), then run these commands from `frontend/`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Vite listens on `http://127.0.0.1:5173` and proxies `/api`, `/uploads`, and `/health` to `http://127.0.0.1:8080`. It preserves `Origin`; changing the page origin also requires updating the backend's `WRITE_ALLOWED_ORIGINS`.

For optional map providers, copy `.env.example` to ignored `.env.local` and configure the browser keys. With no explicit preference, Chinese prefers Tencent → Tianditu → OSM; English prefers OSM → Tencent → Tianditu. Unavailable providers are skipped. Browser keys are public build configuration; restrict them with the provider and keep server credentials out of Vite variables.

## Check and build

```sh
pnpm typecheck
pnpm format:check
pnpm test:unit
node --test deploy/cloudflare/worker.test.js
pnpm build
```

Output is `dist/`. There is no ESLint configuration. [Cloudflare deployment](deploy/cloudflare/README.md) documents the Worker and production build command.

## Working in the app

`src/features/` contains product features; `src/shared/` contains API contracts, query keys, translations, and UI primitives. `src/layouts/` owns the persistent map shell and responsive panels. See the [architecture](../ARCHITECTURE.md) for data flow and account boundaries.

Local design and diagnostic routes are gated by `import.meta.env.DEV`: `/__design/desktop`, `/__design/mobile`, `/__dev/status`, `/__dev/map-spike`, `/__dev/qa`, and `/__dev/places-performance`. They use synthetic data and are excluded from production builds. Keep fixture accounts and places out of the normal map route.

Map previews retain their [source attribution](src/assets/map-sources/README.md); provider attribution stays visible on the map.
