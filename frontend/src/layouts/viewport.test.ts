import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    isNormalScale,
    resetViewportStore,
    useViewportSnapshot,
    viewportStoreInternals,
} from './viewport'

type FakeVisualViewport = {
    height: number
    offsetTop: number
    scale: number
    addEventListener: (type: string, listener: () => void) => void
    removeEventListener: (type: string, listener: () => void) => void
    dispatch: (type: string) => void
    listenerCount: () => number
}

function makeFakeVisualViewport(init: {
    height?: number
    offsetTop?: number
    scale?: number
}): FakeVisualViewport {
    const listeners = new Map<string, Set<() => void>>()
    return {
        height: init.height ?? 800,
        offsetTop: init.offsetTop ?? 0,
        scale: init.scale ?? 1,
        addEventListener(type, listener) {
            const set = listeners.get(type) ?? new Set()
            set.add(listener)
            listeners.set(type, set)
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener)
        },
        dispatch(type) {
            for (const listener of listeners.get(type) ?? []) listener()
        },
        listenerCount() {
            let total = 0
            for (const set of listeners.values()) total += set.size
            return total
        },
    }
}

let frames: FrameRequestCallback[]
let nextFrame: number
function flushFrames() {
    const pending = [...frames]
    frames.length = 0
    for (const callback of pending) callback(0)
}

function Probe() {
    const snapshot = useViewportSnapshot()
    return createElement(
        'output',
        { 'data-testid': 'snapshot' },
        `${snapshot.height}|${snapshot.offsetTop}|${snapshot.bottom}|${snapshot.scale}`,
    )
}

function readSnapshot(view: ReturnType<typeof render>) {
    return view.getByTestId('snapshot').textContent
}

beforeEach(() => {
    resetViewportStore()
    vi.stubGlobal('innerHeight', 800)
    frames = []
    nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback)
        return ++nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        frames[id - 1] = () => {}
    })
})

afterEach(() => {
    cleanup()
    resetViewportStore()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('viewport snapshot', () => {
    it('uses visualViewport.height at scale 1 and reports the bottom edge', () => {
        vi.stubGlobal('visualViewport', makeFakeVisualViewport({ height: 700, offsetTop: 0 }))
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('700|0|700|1')
    })

    it('falls back to innerHeight when visualViewport is missing', () => {
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('800|0|800|1')
    })

    it('falls back to innerHeight when visualViewport height is 0, negative or invalid', () => {
        const viewport = makeFakeVisualViewport({ height: 0 })
        vi.stubGlobal('visualViewport', viewport)
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('800|0|800|1')
        act(() => {
            viewport.height = -10
            window.dispatchEvent(new Event('resize'))
        })
        expect(readSnapshot(view)).toBe('800|0|800|1')
        act(() => {
            viewport.height = Number.NaN
            window.dispatchEvent(new Event('resize'))
        })
        expect(readSnapshot(view)).toBe('800|0|800|1')
    })

    it('updates on a visualViewport resize, coalesced through one animation frame', () => {
        const viewport = makeFakeVisualViewport({ height: 700 })
        vi.stubGlobal('visualViewport', viewport)
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('700|0|700|1')
        act(() => {
            viewport.height = 640
            // Two rapid events must collapse into a single pending frame.
            viewport.dispatch('resize')
            viewport.dispatch('scroll')
            expect(viewportStoreInternals().pendingFrame).toBe(true)
        })
        // Nothing committed until the frame runs.
        expect(readSnapshot(view)).toBe('700|0|700|1')
        act(() => flushFrames())
        expect(readSnapshot(view)).toBe('640|0|640|1')
    })

    it('tracks a keyboard pan through offsetTop without treating it as extra safe area', () => {
        const viewport = makeFakeVisualViewport({ height: 500, offsetTop: 120 })
        vi.stubGlobal('visualViewport', viewport)
        const view = render(createElement(Probe))
        // bottom = offsetTop + height; the UI caps height (not bottom) at -46.
        expect(readSnapshot(view)).toBe('500|120|620|1')
    })

    it('updates synchronously on window resize, orientationchange and pageshow', () => {
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('800|0|800|1')
        act(() => {
            vi.stubGlobal('innerHeight', 400)
            window.dispatchEvent(new Event('resize'))
        })
        expect(readSnapshot(view)).toBe('400|0|400|1')
        act(() => {
            vi.stubGlobal('innerHeight', 900)
            window.dispatchEvent(new Event('orientationchange'))
        })
        expect(readSnapshot(view)).toBe('900|0|900|1')
        act(() => {
            vi.stubGlobal('innerHeight', 650)
            window.dispatchEvent(new Event('pageshow'))
        })
        expect(readSnapshot(view)).toBe('650|0|650|1')
    })

    it('schedules one bounded calibration frame after a global layout event', () => {
        const view = render(createElement(Probe))
        act(() => flushFrames())
        act(() => {
            window.dispatchEvent(new Event('pageshow'))
        })
        expect(viewportStoreInternals().pendingFrame).toBe(true)
        // The final layout may only be committed next frame; the extra read
        // picks it up without any recurring timer.
        act(() => {
            vi.stubGlobal('innerHeight', 480)
            flushFrames()
        })
        expect(readSnapshot(view)).toBe('480|0|480|1')
        expect(viewportStoreInternals().pendingFrame).toBe(false)
    })

    it('resyncs when the page becomes visible again', () => {
        const view = render(createElement(Probe))
        act(() => {
            vi.stubGlobal('innerHeight', 512)
            vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            document.dispatchEvent(new Event('visibilitychange'))
            vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
            document.dispatchEvent(new Event('visibilitychange'))
        })
        expect(readSnapshot(view)).toBe('512|0|512|1')
    })

    it('ignores pinch-zoom height changes and resyncs once scale returns to 1', () => {
        const viewport = makeFakeVisualViewport({ height: 800 })
        vi.stubGlobal('visualViewport', viewport)
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('800|0|800|1')
        act(() => {
            // Pinching out shrinks the visual viewport; the layout must not.
            viewport.scale = 2
            viewport.height = 400
            viewport.dispatch('resize')
            flushFrames()
        })
        expect(readSnapshot(view)).toBe('800|0|800|2')
        act(() => {
            viewport.scale = 1
            viewport.height = 400
            viewport.dispatch('resize')
            flushFrames()
        })
        expect(readSnapshot(view)).toBe('400|0|400|1')
    })

    it('seeds a valid innerHeight fallback when the first subscribe is already zoomed', () => {
        // Reloading while pinch-zoomed must not adopt the 812 default.
        vi.stubGlobal('innerHeight', 733)
        const viewport = makeFakeVisualViewport({ height: 300, scale: 2 })
        vi.stubGlobal('visualViewport', viewport)
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('733|0|733|2')
        // Returning to scale 1 adopts the real visual viewport height.
        act(() => {
            viewport.scale = 1
            viewport.height = 640
            viewport.dispatch('resize')
            flushFrames()
        })
        expect(readSnapshot(view)).toBe('640|0|640|1')
    })

    it('does not carry a stale height into the next page that mounts the store', () => {
        const viewport = makeFakeVisualViewport({ height: 600 })
        vi.stubGlobal('visualViewport', viewport)
        const first = render(createElement(Probe))
        expect(readSnapshot(first)).toBe('600|0|600|1')
        first.unmount()
        // A different page (same runtime) and window size, zoomed at mount.
        vi.stubGlobal('innerHeight', 500)
        viewport.height = 250
        viewport.scale = 2
        const second = render(createElement(Probe))
        expect(readSnapshot(second)).toBe('500|0|500|2')
    })

    it('keeps the previous metrics while zoomed across further resize events', () => {
        const viewport = makeFakeVisualViewport({ height: 760, offsetTop: 10 })
        vi.stubGlobal('visualViewport', viewport)
        const view = render(createElement(Probe))
        expect(readSnapshot(view)).toBe('760|10|770|1')
        act(() => {
            viewport.scale = 3
            viewport.height = 200
            viewport.offsetTop = 300
            viewport.dispatch('scroll')
            flushFrames()
            viewport.height = 210
            viewport.dispatch('scroll')
            flushFrames()
        })
        expect(readSnapshot(view)).toBe('760|10|770|3')
    })

    it('attaches listeners once for multiple subscribers and detaches on the last unmount', () => {
        const viewport = makeFakeVisualViewport({ height: 700 })
        vi.stubGlobal('visualViewport', viewport)
        const first = render(createElement(Probe))
        // First attach schedules one bounded calibration frame.
        expect(viewportStoreInternals()).toEqual({
            listeners: 1,
            attached: true,
            pendingFrame: true,
        })
        act(() => flushFrames())
        expect(viewportStoreInternals().pendingFrame).toBe(false)
        const second = render(createElement(Probe))
        expect(viewportStoreInternals().listeners).toBe(2)
        expect(viewport.listenerCount()).toBe(2)
        first.unmount()
        expect(viewportStoreInternals().listeners).toBe(1)
        // Still attached for the remaining subscriber.
        expect(viewportStoreInternals().attached).toBe(true)
        second.unmount()
        expect(viewportStoreInternals()).toEqual({
            listeners: 0,
            attached: false,
            pendingFrame: false,
        })
        expect(viewport.listenerCount()).toBe(0)
    })

    it('cancels a pending animation frame when the last subscriber unmounts', () => {
        const viewport = makeFakeVisualViewport({ height: 700 })
        vi.stubGlobal('visualViewport', viewport)
        const view = render(createElement(Probe))
        act(() => {
            viewport.height = 680
            viewport.dispatch('resize')
        })
        expect(viewportStoreInternals().pendingFrame).toBe(true)
        view.unmount()
        expect(viewportStoreInternals()).toEqual({
            listeners: 0,
            attached: false,
            pendingFrame: false,
        })
    })
})

describe('isNormalScale', () => {
    it('accepts 1 within tolerance and rejects pinched values', () => {
        expect(isNormalScale(1)).toBe(true)
        expect(isNormalScale(1.005)).toBe(true)
        expect(isNormalScale(1.5)).toBe(false)
        expect(isNormalScale(0.5)).toBe(false)
        expect(isNormalScale(Number.NaN)).toBe(false)
    })
})
