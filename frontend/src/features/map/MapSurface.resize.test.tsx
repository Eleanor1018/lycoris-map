import { act, fireEvent, render } from '@testing-library/react'
import L, { type Map as LeafletMap } from 'leaflet'
import { afterEach, expect, it, vi } from 'vitest'
import { MapSurface } from './MapSurface'

/** Controllable RAF queue: effects coalesce frames, tests flush explicitly. */
function installFrames() {
    let next = 1
    const queue = new Map<number, FrameRequestCallback>()
    const request = vi.fn((callback: FrameRequestCallback) => {
        const id = next++
        queue.set(id, callback)
        return id
    })
    const cancel = vi.fn((id: number) => {
        queue.delete(id)
    })
    const flush = () => {
        const pending = [...queue.entries()]
        queue.clear()
        for (const [, callback] of pending) callback(performance.now())
    }
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    return { request, cancel, flush, pending: () => queue.size }
}

function installResizeObserver() {
    let notify = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(callback: () => void) {
                notify = callback
            }
            observe() {}
            unobserve() {}
            disconnect = disconnect
        },
    )
    return { notify: () => notify(), disconnect }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

it('keeps the real Leaflet camera within one pixel through repeated viewport changes', () => {
    let width = 1440
    let height = 1024
    let currentMap: LeafletMap | null = null
    const observer = installResizeObserver()
    const frames = installFrames()
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    const readMap = (): LeafletMap => {
        if (!currentMap) throw new Error('Leaflet has not mounted')
        return currentMap
    }
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
    act(() => observer.notify())
    act(() => frames.flush())
    fireEvent.resize(window)
    act(() => frames.flush())
    expect(invalidate).not.toHaveBeenCalled()
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
            act(() => observer.notify())
            act(() => frames.flush())
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
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(currentMap).toBeNull()
})

it('invalidates and redraws tiles when a BFCache pageshow restores the same size', () => {
    let width = 390
    let height = 844
    let currentMap: LeafletMap | null = null
    installResizeObserver()
    const frames = installFrames()
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    const view = render(
        <MapSurface
            onMap={(value) => {
                currentMap = value
            }}
        />,
    )
    const map = currentMap as LeafletMap | null
    if (!map) throw new Error('Leaflet has not mounted')
    const tileLayers: L.TileLayer[] = []
    map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) tileLayers.push(layer)
    })
    expect(tileLayers).toHaveLength(1)
    const invalidate = vi.spyOn(map, 'invalidateSize')
    const redraw = tileLayers.map((layer) => vi.spyOn(layer, 'redraw'))
    const instance = L.stamp(map)
    // Same container size on restore: no resize event fires in real Safari.
    act(() => {
        fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }))
    })
    act(() => frames.flush())
    expect(invalidate).toHaveBeenCalledWith({ pan: false, animate: false })
    for (const spy of redraw) expect(spy).toHaveBeenCalledTimes(1)
    expect(L.stamp(currentMap)).toBe(instance)
    expect(view.container.querySelector('.leaflet-container')).not.toBeNull()
})

it('invalidates and redraws when a hidden page becomes visible again', () => {
    let width = 375
    let height = 812
    let currentMap: LeafletMap | null = null
    installResizeObserver()
    const frames = installFrames()
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    render(
        <MapSurface
            onMap={(value) => {
                currentMap = value
            }}
        />,
    )
    const map = currentMap as LeafletMap | null
    if (!map) throw new Error('Leaflet has not mounted')
    const tileLayers: L.TileLayer[] = []
    map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) tileLayers.push(layer)
    })
    const invalidate = vi.spyOn(map, 'invalidateSize')
    const redraw = vi.spyOn(tileLayers[0]!, 'redraw')
    const visibility = vi
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('visible' as DocumentVisibilityState)
    act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => frames.flush())
    expect(invalidate).toHaveBeenCalledWith({ pan: false, animate: false })
    expect(redraw).toHaveBeenCalledTimes(1)
    visibility.mockRestore()
})

it('does not redraw tiles on ordinary pan or zoom', () => {
    let width = 390
    let height = 844
    let currentMap: LeafletMap | null = null
    installResizeObserver()
    const frames = installFrames()
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    render(
        <MapSurface
            onMap={(value) => {
                currentMap = value
            }}
        />,
    )
    const map = currentMap as LeafletMap | null
    if (!map) throw new Error('Leaflet has not mounted')
    const tileLayers: L.TileLayer[] = []
    map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) tileLayers.push(layer)
    })
    const redraw = vi.spyOn(tileLayers[0]!, 'redraw')
    act(() => map.setView([31.24, 121.48], 16, { animate: false }))
    act(() => map.setView([31.3, 121.51], 13, { animate: false }))
    act(() => frames.flush())
    expect(redraw).not.toHaveBeenCalled()
})

it('waits for a valid size and restores tiles after a 0x0 container', () => {
    let width = 0
    let height = 0
    let currentMap: LeafletMap | null = null
    const observer = installResizeObserver()
    const frames = installFrames()
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    render(
        <MapSurface
            onMap={(value) => {
                currentMap = value
            }}
        />,
    )
    const map = currentMap as LeafletMap | null
    if (!map) throw new Error('Leaflet has not mounted')
    const tileLayers: L.TileLayer[] = []
    map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) tileLayers.push(layer)
    })
    const invalidate = vi.spyOn(map, 'invalidateSize')
    const redraw = vi.spyOn(tileLayers[0]!, 'redraw')
    // A 0x0 measurement must not invalidate an unsized layout.
    act(() => observer.notify())
    act(() => frames.flush())
    expect(invalidate).not.toHaveBeenCalled()
    expect(redraw).not.toHaveBeenCalled()
    width = 390
    height = 844
    act(() => observer.notify())
    act(() => frames.flush())
    expect(invalidate).toHaveBeenCalledWith({ pan: true, animate: false })
    expect(redraw).toHaveBeenCalledTimes(1)
})

it('cancels a pending restore frame and removes listeners on unmount', () => {
    let width = 390
    let height = 844
    let currentMap: LeafletMap | null = null
    installResizeObserver()
    const frames = installFrames()
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    const view = render(
        <MapSurface
            onMap={(value) => {
                currentMap = value
            }}
        />,
    )
    const map = currentMap as LeafletMap | null
    if (!map) throw new Error('Leaflet has not mounted')
    const tileLayers: L.TileLayer[] = []
    map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) tileLayers.push(layer)
    })
    const redraw = vi.spyOn(tileLayers[0]!, 'redraw')
    act(() => {
        fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }))
    })
    expect(frames.pending()).toBe(1)
    view.unmount()
    expect(frames.cancel).toHaveBeenCalled()
    act(() => frames.flush())
    expect(redraw).not.toHaveBeenCalled()
    // Listeners are gone: a later event must not reach the removed map.
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }))
    expect(frames.pending()).toBe(0)
})

it('keeps an OSM tile layer at zoom 19', () => {
    let currentMap: LeafletMap | null = null
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(390)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(844)
    installResizeObserver()
    installFrames()
    render(
        <MapSurface
            onMap={(value) => {
                currentMap = value
            }}
        />,
    )
    const map = currentMap as LeafletMap | null
    if (!map) throw new Error('Leaflet has not mounted')
    const layers: L.TileLayer[] = []
    map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) layers.push(layer)
    })
    expect(layers).toHaveLength(1)
    expect(layers[0]!.options.maxZoom).toBe(19)
    expect(map.getMaxZoom()).toBe(19)
})
