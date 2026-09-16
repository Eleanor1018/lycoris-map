import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Map as LeafletMap } from 'leaflet'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import { MapSurface } from './MapSurface'
import type { MapPlacesProps } from './MapPlaces'
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
    const markers = [syntheticPlace(), syntheticPlace({ id: 2, lat: 31.231 })]
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
        f.tree({ markers: [syntheticPlace(), syntheticPlace({ id: 2 })], onCluster: cluster }),
    )
    fireEvent.click(view.container.querySelector('.map-cluster-marker')!)
    expect(cluster.mock.calls[0]?.[0].sort()).toEqual([1, 2])
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
