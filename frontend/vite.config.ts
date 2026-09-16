import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { placeFixtureServer } from './src/features/dev/placeFixtureServer.ts'

/**
 * Local development only. The frontend never carries a server target or secrets.
 *
 * `/api`, `/uploads` and `/health` are proxied same-origin to the fixed local
 * Rust backend at `http://127.0.0.1:8080`. There is deliberately no
 * `VITE_BACKEND_URL` override: a `VITE_`-prefixed value is embedded into the
 * client bundle and would misrepresent a client-visible setting. The proxy does
 * not rewrite `Origin`, so browser writes keep the Vite origin that the backend
 * `WRITE_ALLOWED_ORIGINS` allowlist expects.
 *
 * `strictPort` keeps the dev origin at 5173 instead of silently moving to 5174,
 * which would fall outside that cookie/write allowlist.
 */
const LOCAL_BACKEND = 'http://127.0.0.1:8080'
const DEV_PORT = 5173

export default defineConfig({
    plugins: [react(), tailwindcss(), placeFixtureServer()],
    build: {
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: 'map-engine',
                            test: /\/node_modules\/(?:leaflet|react-leaflet|@react-leaflet)\//,
                        },
                    ],
                },
            },
        },
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        port: DEV_PORT,
        strictPort: true,
        proxy: {
            '/api': { target: LOCAL_BACKEND, changeOrigin: false },
            '/uploads': { target: LOCAL_BACKEND, changeOrigin: false },
            '/health': { target: LOCAL_BACKEND, changeOrigin: false },
        },
    },
})
