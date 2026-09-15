import type { Plugin } from 'vite'
import { syntheticPlaces } from './placeFixtures.ts'
import { readFileSync } from 'node:fs'

/** Never included in the production bundle or preview server. */
export function placeFixtureServer(): Plugin {
    return {
        name: 'local-place-performance-fixtures',
        apply: 'serve',
        configureServer(server) {
            const photos = new Map([
                [
                    '/uploads/markers/__dev_figma_desktop.png',
                    {
                        type: 'image/png',
                        bytes: readFileSync(
                            new URL(
                                '../../assets/figma/fixtures/desktop-photo.png',
                                import.meta.url,
                            ),
                        ),
                    },
                ],
                [
                    '/uploads/markers/__dev_figma_mobile.jpg',
                    {
                        type: 'image/jpeg',
                        bytes: readFileSync(
                            new URL(
                                '../../assets/figma/fixtures/mobile-photo.jpg',
                                import.meta.url,
                            ),
                        ),
                    },
                ],
            ])
            const payloads = new Map(
                [1000, 10000].map((count) => [count, JSON.stringify(syntheticPlaces(count))]),
            )
            server.middlewares.use((request, response, next) => {
                const url = new URL(request.url ?? '/', 'http://127.0.0.1')
                const photo = photos.get(url.pathname)
                if (photo && request.method === 'GET') {
                    response.setHeader('Content-Type', photo.type)
                    response.end(photo.bytes)
                    return
                }
                if (url.pathname !== '/__dev/fixtures/places') {
                    next()
                    return
                }
                const payload = payloads.get(Number(url.searchParams.get('count')))
                if (request.method !== 'GET' || !payload) {
                    response.statusCode = 400
                    response.end()
                    return
                }
                response.setHeader('Content-Type', 'application/json')
                response.setHeader('Cache-Control', 'no-store')
                response.end(payload)
            })
        },
    }
}
