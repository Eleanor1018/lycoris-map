import { expect, it } from 'vitest'
import { mapView } from './viewport'
import { viewportWindow } from './viewportWindow'

it('retains coverage when crossing the date line or an equivalent world copy', () => {
    const first = viewportWindow(null, mapView(-10, 10, 170, 190, { lat: 0, lng: 180 }, 4))
    expect(first.bounds).toEqual([
        expect.objectContaining({ minLng: 159, maxLng: 180 }),
        expect.objectContaining({ minLng: -180, maxLng: -159 }),
    ])
    expect(viewportWindow(first, mapView(-10, 10, 535, 555, { lat: 0, lng: 545 }, 4))).toBe(first)
    expect(viewportWindow(first, mapView(-10, 10, -185, -165, { lat: 0, lng: -175 }, 4))).toBe(
        first,
    )
    expect(viewportWindow(first, mapView(-10, 10, 195, 215, { lat: 0, lng: 205 }, 4))).not.toBe(
        first,
    )
})
it('clamps polar buffers and queries a world-spanning view only once', () => {
    const world = viewportWindow(null, mapView(-100, 100, -190, 190, { lat: 0, lng: 0 }, 1))
    expect(world.bounds).toEqual([{ minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 }])
    expect(viewportWindow(world, mapView(-100, 100, 170, 550, { lat: 0, lng: 360 }, 1))).toBe(world)
})
