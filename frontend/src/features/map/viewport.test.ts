import { expect, it } from 'vitest'
import { mapView } from './viewport'
it('splits antimeridian views including repeated Leaflet worlds', () => {
    const a = mapView(-10, 10, 170, 190, { lat: 0, lng: 180 }, 3)
    const b = mapView(-10, 10, 530, 550, { lat: 0, lng: 540 }, 3)
    expect(a).toEqual(b)
    expect(a.bounds).toEqual([
        { minLat: -10, maxLat: 10, minLng: 170, maxLng: 180 },
        { minLat: -10, maxLat: 10, minLng: -180, maxLng: -170 },
    ])
})
it('requests the complete world once and clamps polar bounds', () => {
    expect(mapView(-100, 100, -200, 200, { lat: 0, lng: 0 }, 1).bounds).toEqual([
        { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 },
    ])
})
it('uses rounded request snapshots, and refuses non-finite views', () => {
    expect(
        mapView(31.12345678, 32, 121, 122, { lat: 31.5, lng: 121.5 }, 10).bounds[0]?.minLat,
    ).toBe(31.123457)
    expect(() => mapView(0, 1, NaN, 2, { lat: 0, lng: 0 }, 10)).toThrow()
})
