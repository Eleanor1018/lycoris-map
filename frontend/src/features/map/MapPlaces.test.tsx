import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Map as LeafletMap } from 'leaflet'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import { MapSurface } from './MapSurface'
import type { MapPlacesProps } from './MapPlaces'
import { mapView } from './viewport'
import { viewportWindow } from './viewportWindow'
afterEach(cleanup)
function fixture() {
    let map: LeafletMap | null = null
    const onMap = (value: LeafletMap | null) => {
        map = value
    }
    const tree = (places: MapPlacesProps) => (
        <StrictMode>
            <MapSurface onMap={onMap} places={places} />
        </StrictMode>
    )
    return {
        tree,
        map: () => {
            if (!map) throw new Error('Map not ready')
            return map
        },
    }
}
it('keeps the real map and point DOM while title/isActive change with the same id/version', () => {
    const f = fixture(),
        place = syntheticPlace(),
        select = vi.fn()
    const view = render(f.tree({ markers: [place], onSelect: select }))
    const map = f.map(),
        pin = view.container.querySelector('#map-place-1')!
    expect(pin).toHaveAttribute('title', place.title)
    const changed = { ...place, title: 'Updated title', isActive: false }
    view.rerender(f.tree({ markers: [changed], onSelect: select }))
    expect(f.map()).toBe(map)
    expect(view.container.querySelector('#map-place-1')).toBe(pin)
    expect(pin).toHaveAttribute('aria-label', 'Updated title')
    fireEvent.click(pin)
    expect(select).toHaveBeenCalledWith(changed, 'map-place-1')
    view.rerender(f.tree({ markers: [] }))
    expect(view.container.querySelector('#map-place-1')).toBeNull()
})
it('updates category colors in place and retains them for selected or detail-only markers', () => {
    const f = fixture()
    const categories = [
        'accessible_toilet',
        'baby_room',
        'friendly_clinic',
        'self_definition',
    ] as const
    const view = render(f.tree({ markers: [syntheticPlace()] }))
    const map = f.map()
    const pin = view.container.querySelector<HTMLImageElement>('#map-place-1')!
    const sources = new Set<string>()
    for (const category of categories) {
        const place = syntheticPlace({ category })
        view.rerender(f.tree({ markers: [place] }))
        const source = pin.src
        sources.add(source)
        view.rerender(f.tree({ markers: [place], selected: place }))
        expect(pin.src).toBe(source)
        view.rerender(f.tree({ selected: place }))
        expect(view.container.querySelector('#map-place-1')).toBe(pin)
        expect(pin.src).toBe(source)
        expect(f.map()).toBe(map)
    }
    expect(sources.size).toBe(categories.length)
})
it('preserves user zoom when layout padding changes, keeping selection in the uncovered area', () => {
    const f = fixture(),
        selected = syntheticPlace()
    const view = render(
        f.tree({ selected, padding: { left: 256, right: 80, top: 64, bottom: 40 } }),
    )
    const map = f.map()
    act(() => {
        map.setZoom(12, { animate: false })
    })
    view.rerender(f.tree({ selected, padding: { left: 576, right: 80, top: 64, bottom: 40 } }))
    expect(f.map()).toBe(map)
    expect(map.getZoom()).toBe(12)
    const point = map.latLngToContainerPoint(selected)
    expect(point.x).toBeCloseTo((800 + 576 - 80) / 2, 0)
})
it('expands a cluster into the visible area and exposes coincident points as a list', () => {
    const f = fixture(),
        cluster = vi.fn()
    const markers = Array.from({ length: 10 }, (_, i) =>
        syntheticPlace({ id: i + 1, lat: 31.2304 + i * 0.00006 }),
    )
    const view = render(
        f.tree({
            markers,
            onCluster: cluster,
            padding: { left: 576, right: 80, top: 64, bottom: 40 },
        }),
    )
    fireEvent.click(view.container.querySelector('.map-cluster-marker')!)
    expect(f.map().latLngToContainerPoint(markers[0]!).x).toBeGreaterThan(576)
    view.rerender(
        f.tree({
            markers: markers.map((p) => ({ ...p, lat: markers[0]!.lat })),
            onCluster: cluster,
        }),
    )
    fireEvent.click(view.container.querySelector('.map-cluster-marker')!)
    expect(cluster.mock.calls[0]?.[0].sort((a: number, b: number) => a - b)).toEqual(
        markers.map((p) => p.id),
    )
})
it('renders an escaped target label for old coordinate links', () => {
    const f = fixture()
    const view = render(
        f.tree({
            sharedTarget: { lat: 31.2304, lng: 121.4737, title: '<img src=x onerror=alert(1)>' },
        }),
    )
    expect(view.container.querySelector('#map-shared-location')).toHaveAttribute(
        'title',
        '<img src=x onerror=alert(1)>',
    )
    expect(view.container.querySelector('.map-shared-label')?.textContent).toBe(
        '<img src=x onerror=alert(1)>',
    )
    expect(view.container.querySelector('.map-shared-label img')).toBeNull()
})
it('reveals the original direction fan only for a compass reading without replacing map pins', () => {
    vi.useFakeTimers()
    const f = fixture(),
        point = { lat: 31.2304, lng: 121.4737 }
    const view = render(f.tree({ markers: [syntheticPlace()], position: point }))
    const pin = view.container.querySelector('#map-place-1')
    const dot = view.container.querySelector('#map-your-location')!
    expect(dot).not.toHaveClass('has-heading')
    act(() => {
        window.dispatchEvent(
            Object.assign(new Event('deviceorientationabsolute'), { alpha: 270, absolute: true }),
        )
        vi.advanceTimersByTime(20)
    })
    expect(dot).toHaveClass('has-heading')
    expect(dot.querySelector('img')!.style.transform).toContain('-73.113')
    expect(view.container.querySelector('#map-place-1')).toBe(pin)
    act(() => vi.advanceTimersByTime(10_020))
    expect(dot).toHaveClass('has-heading')
    view.unmount()
    vi.useRealTimers()
})

it('reuses the fetched window across a real Leaflet 15-to-14 zoom at Dandong latitude', () => {
    const f = fixture()
    render(f.tree({}))
    const map = f.map()
    const snapshot = () => {
        const b = map.getBounds()
        return mapView(
            b.getSouth(),
            b.getNorth(),
            b.getWest(),
            b.getEast(),
            map.getCenter(),
            map.getZoom(),
        )
    }
    act(() => map.setView([40.109309, 124.359705], 15, { animate: false }))
    const first = viewportWindow(null, snapshot())
    act(() => map.setZoom(14, { animate: false }))
    expect(viewportWindow(first, snapshot())).toBe(first)
})
