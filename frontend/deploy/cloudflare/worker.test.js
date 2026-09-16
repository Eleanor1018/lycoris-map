import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from './_worker.js'

test('static pages and admin deep links stay on Pages', async () => {
    for (const path of ['/', '/admin/review', '/assets/app.js', '/api-not-a-route']) {
        const request = new Request(`https://lycoris-map.com${path}`)
        const response = await worker.fetch(request, {
            ASSETS: {
                fetch: (received) => {
                    assert.equal(received, request)
                    return new Response('asset')
                },
            },
        })
        assert.equal(await response.text(), 'asset')
    }
})

test('API writes preserve authentication, Origin and body without caching or following redirects', async (t) => {
    t.mock.method(globalThis, 'fetch', async (request, options) => {
        assert.equal(request.url, 'https://api.lycoris-map.com/api/markers?lang=en')
        assert.equal(request.method, 'POST')
        assert.equal(request.headers.get('Origin'), 'https://lycoris-map.com')
        assert.equal(request.headers.get('Cookie'), 'LYCORIS_SESSION=test')
        assert.equal(await request.text(), '{"name":"A"}')
        assert.equal(options.redirect, 'manual')
        assert.equal(options.cf.cacheTtl, 0)
        return new Response('created', {
            status: 201,
            headers: { 'Set-Cookie': 'LYCORIS_SESSION=next; Secure; HttpOnly; Path=/' },
        })
    })
    const response = await worker.fetch(
        new Request('https://lycoris-map.com/api/markers?lang=en', {
            method: 'POST',
            headers: { Origin: 'https://lycoris-map.com', Cookie: 'LYCORIS_SESSION=test' },
            body: '{"name":"A"}',
        }),
        {},
    )
    assert.equal(response.status, 201)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.match(response.headers.get('Set-Cookie'), /LYCORIS_SESSION=next/)
})

test('uploads retain range headers; API failures do not fall through to SPA HTML', async (t) => {
    t.mock.method(globalThis, 'fetch', async (request) => {
        assert.equal(request.url, 'https://api.lycoris-map.com/uploads/markers/a.jpg')
        assert.equal(request.headers.get('Range'), 'bytes=0-99')
        throw new Error('unreachable')
    })
    const response = await worker.fetch(
        new Request('https://lycoris-map.com/uploads/markers/a.jpg', {
            headers: { Range: 'bytes=0-99' },
        }),
        {},
    )
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { message: 'Service temporarily unavailable' })
})
