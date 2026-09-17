import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compassHeading, requestDeviceHeading, useDeviceHeading } from './useDeviceHeading'

function orientation(values: Record<string, unknown>, type = 'deviceorientation') {
    return Object.assign(
        new Event(type),
        { alpha: null, beta: null, gamma: null, absolute: false },
        values,
    ) as DeviceOrientationEvent
}
beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

it('uses north-referenced iOS/Android readings and compensates screen rotation', () => {
    expect(
        compassHeading(orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 })),
    ).toBe(90)
    expect(compassHeading(orientation({ absolute: true, alpha: 270 }))).toBe(90)
    expect(compassHeading(orientation({ absolute: true, alpha: 270 }), 90)).toBe(180)
    expect(compassHeading(orientation({ absolute: false, alpha: 270 }))).toBeNull()
    expect(compassHeading(orientation({ absolute: true, alpha: null }))).toBeNull()
    expect(
        compassHeading(orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: -1 })),
    ).toBeNull()
    expect(compassHeading(orientation({ webkitCompassHeading: NaN }))).toBeNull()
})
it('crosses north by the short arc and retains a stationary compass until hidden', () => {
    const { result, unmount } = renderHook(() => useDeviceHeading(true))
    function send(values: Record<string, unknown>) {
        act(() => {
            window.dispatchEvent(orientation(values))
            vi.advanceTimersByTime(20)
        })
    }
    send({ absolute: true, alpha: 1 })
    expect(result.current).toBe(359)
    send({ absolute: true, alpha: 359 })
    expect(result.current).toBe(361)
    send({ absolute: false, alpha: 70 })
    expect(result.current).toBe(361)
    act(() => vi.advanceTimersByTime(10_020))
    expect(result.current).toBe(361)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
        vi.advanceTimersByTime(20)
    })
    expect(result.current).toBeNull()
    vi.restoreAllMocks()
    unmount()
    send({ absolute: true, alpha: 45 })
    expect(vi.getTimerCount()).toBe(0)
})
it('restores a previous iOS grant when the location first becomes available', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    const { result, rerender } = renderHook(({ enabled }) => useDeviceHeading(enabled), {
        initialProps: { enabled: false },
    })
    act(() => {
        window.dispatchEvent(orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 }))
        vi.advanceTimersByTime(20)
    })
    expect(result.current).toBeNull()
    await act(async () => rerender({ enabled: true }))
    expect(requestPermission).toHaveBeenCalledWith(true)
    expect(result.current).toBe(90)
})
it('uses the first map gesture for a new iOS permission and does not repeatedly prompt', async () => {
    const requestPermission = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('Needs activation', 'NotAllowedError'))
        .mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    const map = document.createElement('div')
    map.className = 'product-map'
    document.body.append(map)
    const { result, unmount } = renderHook(() => useDeviceHeading(true))
    await act(async () => {})
    expect(requestPermission).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(document.body)
    expect(requestPermission).toHaveBeenCalledTimes(1)
    await act(async () => fireEvent.pointerUp(map))
    expect(requestPermission).toHaveBeenCalledTimes(2)
    act(() => {
        window.dispatchEvent(orientation({ webkitCompassHeading: 45, webkitCompassAccuracy: 5 }))
        vi.advanceTimersByTime(20)
    })
    expect(result.current).toBe(45)
    fireEvent.pointerUp(map)
    expect(requestPermission).toHaveBeenCalledTimes(2)
    unmount()
    map.remove()
})
it('tolerates denied permission and removes activation listeners on unmount', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    expect(await requestDeviceHeading()).toBe('denied')
    requestPermission.mockRejectedValue(new DOMException('Needs activation', 'NotAllowedError'))
    const map = document.createElement('div')
    map.className = 'product-map'
    document.body.append(map)
    const { unmount } = renderHook(() => useDeviceHeading(true))
    await act(async () => {})
    unmount()
    fireEvent.pointerUp(map)
    expect(requestPermission).toHaveBeenCalledTimes(2)
    map.remove()
})
