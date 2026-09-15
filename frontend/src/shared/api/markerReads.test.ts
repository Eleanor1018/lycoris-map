import { afterEach, expect, it, vi } from 'vitest'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import { parseMarkerId, readNearby, readPublicPlace, readSearch, readViewport } from './markerReads'

afterEach(() => vi.unstubAllGlobals())
function reply(body: unknown) {
    const fetcher = vi.fn(
        async () =>
            new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetcher)
    return fetcher
}
it('reads bare arrays with explicit anonymous credentials, filters, language and cancellation', async () => {
    const fetcher = reply([syntheticPlace()])
    const signal = new AbortController().signal
    await readViewport(
        { minLat: 31, maxLat: 32, minLng: 121, maxLng: 122, categories: [] },
        'zh',
        signal,
    )
    await readNearby({ lat: 31, lng: 121, radius: 1000, category: 'baby_room' }, 'en', signal)
    await readSearch('  clinic %  ', 'zh', signal)
    expect(fetcher).toHaveBeenNthCalledWith(
        1,
        '/api/markers/viewport?minLat=31&maxLat=32&minLng=121&maxLng=122&lang=zh',
        expect.objectContaining({ credentials: 'omit', signal }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
        2,
        '/api/markers/nearby?lat=31&lng=121&radius=1000&category=baby_room&lang=en',
        expect.objectContaining({ credentials: 'omit', signal }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
        3,
        '/api/markers/search?q=clinic+%25&lang=zh',
        expect.objectContaining({ credentials: 'omit', signal }),
    )
})
it('never sends cookies to OptionalUser details', async () => {
    const fetcher = reply(syntheticPlace())
    await expect(readPublicPlace('1', 'en', new AbortController().signal)).resolves.toMatchObject({
        id: 1,
    })
    expect(fetcher).toHaveBeenCalledWith(
        '/api/markers/1?lang=en',
        expect.objectContaining({ credentials: 'omit' }),
    )
})
it('rejects malformed or unsafe IDs before making a request; blank search makes no request', async () => {
    const fetcher = reply([])
    for (const id of ['', '0', '-1', '01', '1e2', '1/2', '9007199254740992']) {
        expect(parseMarkerId(id)).toBeNull()
        await expect(readPublicPlace(id, 'en', new AbortController().signal)).rejects.toThrow()
    }
    expect(parseMarkerId('9007199254740991')).toBe('9007199254740991')
    await expect(readSearch('  ', 'en', new AbortController().signal)).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
})
it.each([{ lat: 91 }, { lng: -181 }, { id: 9007199254740992 }, { version: 1.5 }])(
    'rejects invalid DTO values %j at the boundary',
    async (invalid) => {
        reply([syntheticPlace(invalid)])
        await expect(readSearch('place', 'en', new AbortController().signal)).rejects.toThrow()
    },
)
