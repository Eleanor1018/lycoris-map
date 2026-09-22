import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { compassHeading, useDeviceHeading } from './useDeviceHeading'

function orientation(values: Record<string, unknown>, type = 'deviceorientation') {
    return Object.assign(
        new Event(type),
        { alpha: null, beta: null, gamma: null, absolute: false },
        values,
    ) as DeviceOrientationEvent
}
beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

/**
 * The permission store is module-level state. Reset it so each test starts
 * from a clean store with the sensor/touch profile it stubs.
 */
async function freshModule() {
    vi.resetModules()
    return import('./useDeviceHeading')
}
function touchDevice(sensor = true, requestPermission?: () => Promise<string>) {
    vi.stubGlobal(
        'DeviceOrientationEvent',
        sensor ? { requestPermission: requestPermission ?? (async () => 'granted') } : {},
    )
    Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => 5,
    })
}

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

it('reports unsupported when no touch device needs a gesture', async () => {
    vi.stubGlobal('DeviceOrientationEvent', {})
    Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => 0,
    })
    const module = await freshModule()
    expect(module.headingPermissionRequired()).toBe(false)
    expect(await module.enableDeviceHeading()).toBe('unsupported')
})

it('does not require a gesture on a touch browser reading absolute alpha without requestPermission', async () => {
    // Android Chrome: touch points exist but no requestPermission API.
    vi.stubGlobal('DeviceOrientationEvent', {})
    Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => 5,
    })
    const module = await freshModule()
    expect(module.headingPermissionRequired()).toBe(false)
    const { result } = renderHook(() => module.useDeviceHeading(true))
    act(() => {
        window.dispatchEvent(orientation({ absolute: true, alpha: 270 }))
        vi.advanceTimersByTime(20)
    })
    expect(result.current).toBe(90)
})

it('deduplicates a rapid double activation into one request and never re-prompts after grant', async () => {
    touchDevice()
    const { useHeadingPermission, enableDeviceHeading } = await freshModule()
    let resolve!: (value: string) => void
    const requestPermission = vi.fn(
        () =>
            new Promise<string>((r) => {
                resolve = r
            }),
    )
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    const { result } = renderHook(() => useHeadingPermission())
    expect(result.current).toBe('prompt')
    let first!: Promise<string>
    let second!: Promise<string>
    act(() => {
        first = enableDeviceHeading()
        second = enableDeviceHeading()
    })
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    await act(async () => {
        resolve('granted')
        await first
    })
    expect(result.current).toBe('granted')
    await act(async () => {
        await enableDeviceHeading()
    })
    expect(requestPermission).toHaveBeenCalledTimes(1)
})

it('keeps the prompt state when activation is rejected so the button can retry', async () => {
    touchDevice()
    const { useHeadingPermission, enableDeviceHeading } = await freshModule()
    const requestPermission = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('Needs user activation', 'NotAllowedError'))
        .mockResolvedValueOnce('granted')
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    const { result } = renderHook(() => useHeadingPermission())
    await act(async () => {
        await enableDeviceHeading()
    })
    expect(result.current).toBe('prompt')
    await act(async () => {
        await enableDeviceHeading()
    })
    expect(result.current).toBe('granted')
    expect(requestPermission).toHaveBeenCalledTimes(2)
})

it('turns a synchronous requestPermission throw into a retryable prompt', async () => {
    touchDevice()
    const { useHeadingPermission, enableDeviceHeading } = await freshModule()
    const requestPermission = vi.fn(() => {
        throw new DOMException('needs activation', 'NotAllowedError')
    })
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    const { result } = renderHook(() => useHeadingPermission())
    let outcome!: string
    act(() => {
        // The click handler must not see the throw escape.
        outcome = ''
        void enableDeviceHeading().then((value) => {
            outcome = value
        })
    })
    await act(async () => {})
    expect(outcome).toBe('prompt')
    expect(result.current).toBe('prompt')
})

it('recognizes existing compass access from valid events without calling requestPermission', async () => {
    touchDevice()
    const module = await freshModule()
    const requestPermission = vi.fn(async () => 'granted')
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    const { result } = renderHook(() => ({
        heading: module.useDeviceHeading(true),
        permission: module.useHeadingPermission(),
    }))
    expect(result.current.permission).toBe('prompt')
    act(() => {
        window.dispatchEvent(orientation({ alpha: 90, absolute: false }))
        vi.advanceTimersByTime(20)
    })
    expect(result.current.permission).toBe('prompt')
    await act(async () => {})
    act(() => {
        window.dispatchEvent(orientation({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 }))
        vi.advanceTimersByTime(20)
    })
    expect(result.current.heading).toBe(90)
    expect(result.current.permission).toBe('granted')
    expect(module.headingPermissionRequired()).toBe(true)
    expect(requestPermission).not.toHaveBeenCalled()
})

it('asks for an explicit grant only when enabled and never opens a second prompt', async () => {
    touchDevice()
    const module = await freshModule()
    const requestPermission = vi.fn(async () => 'granted')
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission })
    renderHook(() => module.useHeadingPermission())
    await act(async () => {})
    await act(async () => {
        await module.enableDeviceHeading()
    })
    expect(requestPermission).toHaveBeenCalledWith(true)
    expect(requestPermission).toHaveBeenCalledTimes(1)
})

it('never treats a stored choice as current browser permission after a reload', async () => {
    const requestPermission = vi.fn(async () => 'granted')
    touchDevice(true, requestPermission)
    const first = await freshModule()
    await first.enableDeviceHeading()
    expect(first.hasRememberedHeadingChoice()).toBe(true)
    const reloaded = await freshModule()
    const { result } = renderHook(() => reloaded.useHeadingPermission())
    await act(async () => {})
    expect(result.current).toBe('prompt')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    requestPermission.mockResolvedValue('denied')
    await act(async () => {
        await reloaded.enableDeviceHeading()
    })
    expect(result.current).toBe('denied')
    expect(requestPermission).toHaveBeenCalledTimes(2)
})
