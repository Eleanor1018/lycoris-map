import { afterEach, expect, it, vi } from 'vitest'
import { fetchMe, fetchMyAvatar, register, logout, uploadMyAvatar } from './session'
import { readAccountPlace, readFavoriteDetails, setFavorite } from './privatePlaces'
import { syntheticPlace } from '@/features/dev/placeFixtures'
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())
it('does not accept a nonzero account envelope as successful logout', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => json({ code: 4001, message: 'Account failed', data: null })),
    )
    await expect(logout()).rejects.toMatchObject({ status: 200, code: 4001 })
})
it('never retries registration whose account was created before a 503', async () => {
    const fetch = vi.fn(async () =>
        json({ code: 503, message: '账号已创建，请稍后登录', data: null }, 503),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(
        register({ username: 'S4', email: 's4@example.test', password: 'synthetic' }),
    ).rejects.toMatchObject({ status: 503, message: '账号已创建，请稍后登录' })
    expect(fetch).toHaveBeenCalledTimes(1)
})
it('bypasses HTTP caches for identity-dependent account, avatar and private DTO reads', async () => {
    const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(json({ code: 0, message: 'ok', data: null }))
        .mockResolvedValueOnce(new Response('image'))
        .mockResolvedValueOnce(json([]))
        .mockResolvedValueOnce(json(syntheticPlace()))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await fetchMe(signal)
    await fetchMyAvatar(signal)
    await readFavoriteDetails('en', signal)
    await readAccountPlace('1', 'en', signal)
    for (const [, init] of fetch.mock.calls) {
        expect(init).toMatchObject({ cache: 'no-store', credentials: 'include', signal })
    }
})
it('allows empty favorite responses and sends avatar multipart without a forced content type', async () => {
    const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response(''))
        .mockResolvedValueOnce(json({ code: 0, message: 'ok', data: null }))
    vi.stubGlobal('fetch', fetch)
    await setFavorite(1, true, new AbortController().signal)
    const file = new File(['synthetic'], 'avatar.png', { type: 'image/png' })
    await uploadMyAvatar(file)
    const init = fetch.mock.calls[1]?.[1]
    expect((init?.body as FormData).get('file')).toBe(file)
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
})
