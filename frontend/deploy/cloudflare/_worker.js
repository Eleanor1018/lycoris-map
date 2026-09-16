// Server-side Pages entry point. Never bundle this file into the browser app.
const BACKEND_ORIGIN = 'https://api.lycoris-map.com'

export default {
    async fetch(request, env) {
        const incoming = new URL(request.url)
        const isBackend = ['/api', '/uploads', '/health'].some(
            (prefix) => incoming.pathname === prefix || incoming.pathname.startsWith(`${prefix}/`),
        )
        if (!isBackend) return env.ASSETS.fetch(request)

        const upstream = new URL(BACKEND_ORIGIN)
        upstream.pathname = incoming.pathname
        upstream.search = incoming.search
        const forwarded = new Request(upstream, request)
        forwarded.headers.set('X-Forwarded-Host', incoming.host)
        forwarded.headers.set('X-Forwarded-Proto', 'https')
        // Preserve Origin, cookies, methods and streaming bodies. The Rust server
        // validates the real browser Origin; redirects must not forward credentials.
        try {
            const response = await fetch(forwarded, {
                redirect: 'manual',
                cf: { cacheTtl: 0, cacheEverything: false },
            })
            const result = new Response(response.body, response)
            result.headers.set('Cache-Control', 'private, no-store')
            return result
        } catch {
            return Response.json(
                { message: 'Service temporarily unavailable' },
                { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
            )
        }
    },
}
