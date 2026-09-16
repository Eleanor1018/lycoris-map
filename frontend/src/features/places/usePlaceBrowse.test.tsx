import type { PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/ApiError'
import * as reads from '@/shared/api/markerReads'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import { mapView } from '@/features/map/viewport'
import { usePlaceBrowse } from './usePlaceBrowse'
vi.mock('@/shared/api/markerReads', async (importOriginal) => ({
    ...(await importOriginal<typeof reads>()),
    readViewport: vi.fn(),
    readSearch: vi.fn(),
    readNearby: vi.fn(),
    readPublicPlace: vi.fn(),
}))
const clients: QueryClient[] = []
function wrapper() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    clients.push(client)
    return ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
}
beforeEach(() => {
    vi.mocked(reads.readViewport).mockResolvedValue([syntheticPlace()])
    vi.mocked(reads.readSearch).mockResolvedValue([])
    vi.mocked(reads.readNearby).mockResolvedValue([])
    vi.mocked(reads.readPublicPlace).mockResolvedValue(syntheticPlace())
})
afterEach(() => {
    cleanup()
    clients.splice(0).forEach((client) => client.clear())
    vi.resetAllMocks()
    vi.unstubAllGlobals()
})
it('splits date-line requests without filtering historical categories and deduplicates results', async () => {
    const { result } = renderHook(() => usePlaceBrowse('zh', null), { wrapper: wrapper() })
    act(() => result.current.onView(mapView(-10, 10, 170, 190, { lat: 0, lng: 180 }, 4)))
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(reads.readViewport).toHaveBeenCalledTimes(2)
    expect(reads.readViewport).toHaveBeenCalledWith(
        { minLat: -10, maxLat: 10, minLng: 170, maxLng: 180, categories: [] },
        'zh',
        expect.any(AbortSignal),
    )
})
it('debounces search, aborts old requests and never lets a late result replace a newer term', async () => {
    let finishOld!: (value: ReturnType<typeof syntheticPlace>[]) => void
    vi.mocked(reads.readSearch).mockImplementation((query) =>
        query === 'old'
            ? new Promise((resolve) => {
                  finishOld = resolve
              })
            : Promise.resolve([syntheticPlace({ title: query })]),
    )
    const { result } = renderHook(() => usePlaceBrowse('en', null), { wrapper: wrapper() })
    act(() => result.current.setSearch('old'))
    expect(reads.readSearch).not.toHaveBeenCalled()
    await waitFor(() => expect(reads.readSearch).toHaveBeenCalledTimes(1))
    const oldSignal = vi.mocked(reads.readSearch).mock.calls[0]![2]
    act(() => result.current.setSearch('new'))
    expect(result.current.state.pending).toBe(true)
    expect(result.current.results).toEqual([])
    await waitFor(() => expect(result.current.results[0]?.title).toBe('new'))
    expect(oldSignal.aborted).toBe(true)
    await act(async () => finishOld([syntheticPlace({ title: 'old' })]))
    expect(result.current.results[0]?.title).toBe('new')
})
it('refetches translated DTOs on language changes without trusting marker version', async () => {
    vi.mocked(reads.readPublicPlace).mockImplementation(async (_, language) =>
        syntheticPlace({ title: language, contentLanguage: language }),
    )
    const { result, rerender } = renderHook(
        ({ lang }: { lang: 'en' | 'zh' }) => usePlaceBrowse(lang, '1'),
        { initialProps: { lang: 'en' }, wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.detail?.title).toBe('en'))
    rerender({ lang: 'zh' })
    await waitFor(() => expect(result.current.detail?.title).toBe('zh'))
    expect(result.current.detail?.version).toBe(1)
})
it('withdraws a formerly public selected marker and cached list row after a 404', async () => {
    const { result } = renderHook(() => usePlaceBrowse('en', '1'), { wrapper: wrapper() })
    act(() => result.current.onView(mapView(31, 32, 121, 122, { lat: 31.5, lng: 121.5 }, 10)))
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    await waitFor(() => expect(result.current.detail?.id).toBe(1))
    vi.mocked(reads.readPublicPlace).mockRejectedValue(new ApiError(404, 'HTTP 404'))
    act(() => result.current.detailState.retry())
    await waitFor(() => expect(result.current.detailState.error).toBe('This place is unavailable.'))
    expect(result.current.detail).toBeUndefined()
    expect(result.current.markers).toEqual([])
})
it('allows a freshly public list to restore a previously unavailable place', async () => {
    const { result, rerender } = renderHook(
        ({ id }: { id: string | null }) => usePlaceBrowse('en', id),
        { initialProps: { id: '1' as string | null }, wrapper: wrapper() },
    )
    act(() => result.current.onView(mapView(31, 32, 121, 122, { lat: 31.5, lng: 121.5 }, 10)))
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    vi.mocked(reads.readViewport).mockResolvedValue([])
    vi.mocked(reads.readPublicPlace).mockRejectedValue(new ApiError(404, 'HTTP 404'))
    act(() => result.current.detailState.retry())
    await waitFor(() => expect(result.current.detailState.error).toContain('unavailable'))
    await waitFor(() => expect(result.current.results).toEqual([]))
    rerender({ id: null })
    vi.mocked(reads.readViewport).mockResolvedValue([syntheticPlace({ title: 'Public again' })])
    act(() => result.current.state.retry())
    await waitFor(() => expect(result.current.results[0]?.title).toBe('Public again'))
})
it('exposes an inline request error and can retry into an honest empty result', async () => {
    vi.mocked(reads.readSearch).mockRejectedValue(new ApiError(400, 'Bad query'))
    const { result } = renderHook(() => usePlaceBrowse('en', null, 'place'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.state.error).toContain('Could not load'))
    vi.mocked(reads.readSearch).mockResolvedValue([])
    act(() => result.current.state.retry())
    await waitFor(() => expect(result.current.state.error).toBeNull())
    expect(result.current.state.pending).toBe(false)
    expect(result.current.results).toEqual([])
})
it('reports invalid links without fetching and updates nearby reference after a fresh location fix', async () => {
    const get = vi.fn<Geolocation['getCurrentPosition']>()
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: get } })
    const { result } = renderHook(() => usePlaceBrowse('en', 'bad'), { wrapper: wrapper() })
    expect(result.current.detailState.error).toContain('invalid')
    expect(reads.readPublicPlace).not.toHaveBeenCalled()
    act(() => result.current.onView(mapView(31, 32, 121, 122, { lat: 31.5, lng: 121.5 }, 10)))
    act(() => result.current.chooseCategory('baby_room'))
    await waitFor(() =>
        expect(reads.readNearby).toHaveBeenCalledWith(
            expect.objectContaining({ lat: 31.5, lng: 121.5 }),
            'en',
            expect.any(AbortSignal),
        ),
    )
    expect(result.current.nearby?.located).toBe(false)
    act(() => result.current.location.locate())
    act(() =>
        get.mock.calls[0]?.[0]({
            coords: { latitude: 32.12345678, longitude: 122 },
        } as GeolocationPosition),
    )
    await waitFor(() =>
        expect(reads.readNearby).toHaveBeenLastCalledWith(
            expect.objectContaining({ lat: 32.123457, lng: 122 }),
            'en',
            expect.any(AbortSignal),
        ),
    )
    expect(result.current.nearby?.located).toBe(true)
})

it('keeps a nearby search anchored while panning and cancels a superseded category request', async () => {
    let finishOld!: (value: ReturnType<typeof syntheticPlace>[]) => void
    vi.mocked(reads.readNearby).mockImplementation(({ category }) =>
        category === 'baby_room'
            ? new Promise((resolve) => {
                  finishOld = resolve
              })
            : Promise.resolve([syntheticPlace({ category, title: 'Newest nearby' })]),
    )
    const { result } = renderHook(() => usePlaceBrowse('en', null), { wrapper: wrapper() })
    act(() => result.current.onView(mapView(31, 32, 121, 122, { lat: 31.5, lng: 121.5 }, 10)))
    act(() => result.current.chooseCategory('baby_room'))
    await waitFor(() => expect(reads.readNearby).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(reads.readNearby).mock.calls[0]![2]
    act(() => result.current.onView(mapView(32, 33, 122, 123, { lat: 32.5, lng: 122.5 }, 10)))
    expect(result.current.nearby?.point).toEqual({ lat: 31.5, lng: 121.5 })
    act(() => result.current.chooseCategory('friendly_clinic'))
    await waitFor(() => expect(result.current.results[0]?.title).toBe('Newest nearby'))
    expect(signal.aborted).toBe(true)
    await act(async () => finishOld([syntheticPlace({ title: 'Old nearby' })]))
    expect(result.current.results[0]?.title).toBe('Newest nearby')
})
