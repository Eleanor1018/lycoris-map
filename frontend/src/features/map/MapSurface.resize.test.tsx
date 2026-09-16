import { act, fireEvent, render } from '@testing-library/react'
import L, { type Map as LeafletMap } from 'leaflet'
import { MapSurface } from './MapSurface'

it('keeps the real Leaflet camera within one pixel through repeated viewport changes', () => {
    let width = 1440
    let height = 1024
    let notifyResize = () => {}
    let currentMap: LeafletMap | null = null
    const disconnected = vi.fn()
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(callback: () => void) {
                notifyResize = callback
            }
            observe() {}
            unobserve() {}
            disconnect = disconnected
        },
    )
    const readMap = (): LeafletMap => {
        if (!currentMap) throw new Error('Leaflet has not mounted')
        return currentMap
    }
    try {
        const { unmount } = render(
            <MapSurface
                onMap={(value) => {
                    currentMap = value
                }}
            />,
        )
        const map = readMap()
        const instance = L.stamp(map)
        act(() => map.setView([31.231, 121.479], 15, { animate: false }))
        const original = map.project(map.getCenter(), 15)
        const invalidate = vi.spyOn(map, 'invalidateSize')
        act(() => notifyResize())
        vi.useFakeTimers()
        fireEvent.resize(window)
        act(() => vi.advanceTimersByTime(100))
        expect(invalidate).not.toHaveBeenCalled()
        vi.useRealTimers()
        const viewports = [
            [375, 812],
            [390, 844],
            [430, 932],
            [768, 1024],
            [1440, 1024],
        ]
        for (let cycle = 0; cycle < 4; cycle += 1) {
            for (const [nextWidth, nextHeight] of viewports) {
                width = nextWidth!
                height = nextHeight!
                act(() => notifyResize())
                const projected = map.project(map.getCenter(), 15)
                // Initial pixel-origin rounding and odd/even size rounding
                // together stay below one pixel; repeated changes must not drift.
                expect(Math.abs(projected.x - original.x)).toBeLessThanOrEqual(1.001)
                expect(Math.abs(projected.y - original.y)).toBeLessThanOrEqual(1.001)
                expect(map.getZoom()).toBe(15)
                expect(L.stamp(readMap())).toBe(instance)
            }
        }
        expect(invalidate).toHaveBeenCalledTimes(20)
        unmount()
        expect(disconnected).toHaveBeenCalledOnce()
        expect(currentMap).toBeNull()
    } finally {
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    }
})
