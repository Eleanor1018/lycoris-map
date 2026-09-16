import { StrictMode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLocationFix } from './useLocationFix'

afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})
function geolocation() {
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>()
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    return getCurrentPosition
}
it('requests location once on entry in StrictMode and provides a recoverable denial', () => {
    vi.useFakeTimers()
    const get = geolocation(),
        found = vi.fn()
    const { result } = renderHook(() => useLocationFix(found), { wrapper: StrictMode })
    act(() => vi.advanceTimersByTime(0))
    expect(get).toHaveBeenCalledOnce()
    expect(result.current.pending).toBe(true)
    act(() => get.mock.calls[0]?.[1]?.({ code: 1 } as GeolocationPositionError))
    expect(result.current.error).toContain('denied')
    expect(result.current.position).toBeNull()
    expect(result.current.pending).toBe(false)
    expect(found).not.toHaveBeenCalled()
})
it('times out a pending permission and ignores late results or results after unmount', () => {
    vi.useFakeTimers()
    const get = geolocation(),
        found = vi.fn()
    const { result, unmount } = renderHook(() => useLocationFix(found))
    act(() => result.current.locate())
    act(() => vi.advanceTimersByTime(20_000))
    expect(result.current.error).toContain('timed out')
    act(() =>
        get.mock.calls[0]?.[0]({ coords: { latitude: 31, longitude: 121 } } as GeolocationPosition),
    )
    expect(found).not.toHaveBeenCalled()
    act(() => result.current.locate())
    unmount()
    act(() =>
        get.mock.calls[1]?.[0]({ coords: { latitude: 31, longitude: 121 } } as GeolocationPosition),
    )
    expect(found).not.toHaveBeenCalled()
})
it('accepts valid coordinates and refuses malformed device results', () => {
    const get = geolocation(),
        found = vi.fn()
    const { result } = renderHook(() => useLocationFix(found))
    act(() => result.current.locate())
    act(() =>
        get.mock.calls[0]?.[0]({ coords: { latitude: 31, longitude: 121 } } as GeolocationPosition),
    )
    expect(result.current.position).toEqual({ lat: 31, lng: 121 })
    expect(found).toHaveBeenCalledWith({ lat: 31, lng: 121 }, false)
    act(() => result.current.locate())
    act(() =>
        get.mock.calls[1]?.[0]({ coords: { latitude: 91, longitude: 121 } } as GeolocationPosition),
    )
    expect(result.current.error).toContain('unavailable')
    expect(found).toHaveBeenCalledTimes(1)
})
it('cancels an outstanding initial fix when the user explicitly retries', () => {
    vi.useFakeTimers()
    const get = geolocation(),
        found = vi.fn()
    const { result } = renderHook(() => useLocationFix(found))
    act(() => vi.advanceTimersByTime(0))
    act(() => result.current.locate())
    act(() =>
        get.mock.calls[0]?.[0]({ coords: { latitude: 30, longitude: 120 } } as GeolocationPosition),
    )
    expect(found).not.toHaveBeenCalled()
    act(() =>
        get.mock.calls[1]?.[0]({ coords: { latitude: 31, longitude: 121 } } as GeolocationPosition),
    )
    expect(found).toHaveBeenCalledWith({ lat: 31, lng: 121 }, false)
})
it('reports an initial successful fix as automatic without prompting again on rerender', () => {
    vi.useFakeTimers()
    const get = geolocation(),
        found = vi.fn()
    const { rerender } = renderHook(() =>
        useLocationFix((point, automatic) => found(point, automatic)),
    )
    act(() => vi.advanceTimersByTime(0))
    act(() =>
        get.mock.calls[0]?.[0]({ coords: { latitude: 31, longitude: 121 } } as GeolocationPosition),
    )
    rerender()
    act(() => vi.advanceTimersByTime(0))
    expect(get).toHaveBeenCalledOnce()
    expect(found).toHaveBeenCalledWith({ lat: 31, lng: 121 }, true)
})
it('still accepts the initial fix when the user takes time to answer the permission prompt', () => {
    vi.useFakeTimers()
    const get = geolocation(),
        found = vi.fn()
    const { result } = renderHook(() => useLocationFix(found))
    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current.error).toBeNull()
    act(() =>
        get.mock.calls[0]?.[0]({ coords: { latitude: 31, longitude: 121 } } as GeolocationPosition),
    )
    expect(found).toHaveBeenCalledWith({ lat: 31, lng: 121 }, true)
})
