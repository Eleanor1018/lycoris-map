import { act, cleanup, renderHook } from '@testing-library/react'
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
it('crosses north by the short arc, ignores relative events, and expires stale readings', () => {
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
    expect(result.current).toBeNull()
    unmount()
    send({ absolute: true, alpha: 45 })
    expect(vi.getTimerCount()).toBe(0)
})
it('requests restricted orientation only on an explicit locate action and tolerates denial', async () => {
    const requestPermission = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    renderHook(() => useDeviceHeading(true))
    expect(requestPermission).not.toHaveBeenCalled()
    requestDeviceHeading()
    await Promise.resolve()
    expect(requestPermission).toHaveBeenCalledWith(true)
})
