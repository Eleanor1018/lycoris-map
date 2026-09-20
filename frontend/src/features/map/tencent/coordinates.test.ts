import L from 'leaflet'
import { fromTencent, inMainland, tencentCrs, toTencent } from './coordinates'

it('converts mainland landmarks and returns them to the original WGS84 coordinates', () => {
    const shanghai = toTencent({ lat: 31.2304, lng: 121.4737 })
    expect(shanghai.lat).toBeCloseTo(31.2284577376, 8)
    expect(shanghai.lng).toBeCloseTo(121.4782230593, 8)
    for (const point of [
        { lat: 31.2304, lng: 121.4737 },
        { lat: 40.1243, lng: 124.383 },
        { lat: 39.9042, lng: 116.4074 },
        { lat: 22.5431, lng: 114.0579 },
    ]) {
        expect(inMainland(point)).toBe(true)
        const roundTrip = fromTencent(toTencent(point))
        expect(roundTrip.lat).toBeCloseTo(point.lat, 8)
        expect(roundTrip.lng).toBeCloseTo(point.lng, 8)
    }
})

it('does not shift Hong Kong, Taipei or overseas points inside the broad China bounding box', () => {
    for (const point of [
        { lat: 22.2819, lng: 114.1589 },
        { lat: 25.033, lng: 121.5654 },
        { lat: 37.5665, lng: 126.978 },
        { lat: 21.0278, lng: 105.8342 },
        { lat: 51.5074, lng: -0.1278 },
    ]) {
        expect(inMainland(point)).toBe(false)
        expect(toTencent(point)).toEqual(point)
        expect(fromTencent(point)).toEqual(point)
    }
})

it('projects pins in the same GCJ02 tile plane and unprojects clicks back to WGS84 across zooms and wrapped worlds', () => {
    for (const world of [-360, 0, 360]) {
        const point = L.latLng(31.2304, 121.4737 + world)
        const gcj = toTencent(point.wrap())
        for (const zoom of [3, 14, 19]) {
            const screen = tencentCrs.latLngToPoint(point, zoom)
            const expected = L.CRS.EPSG3857.latLngToPoint(L.latLng(gcj.lat, gcj.lng + world), zoom)
            expect(screen.distanceTo(expected)).toBeLessThan(0.001)
            const picked = tencentCrs.pointToLatLng(screen, zoom)
            expect(picked.lat).toBeCloseTo(point.lat, 8)
            expect(picked.lng).toBeCloseTo(point.lng, 8)
        }
    }
})
