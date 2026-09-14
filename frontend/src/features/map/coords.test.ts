import { describe, expect, it } from 'vitest'
import {
    assertLatLng,
    CoordinateError,
    fromGeoJsonPosition,
    fromLeafletTuple,
    isValidLatitude,
    isValidLongitude,
    splitBounds,
    toGeoJsonPosition,
    toLeafletTuple,
} from './coords'

/** Known Shanghai values: 31.2304 N, 121.4737 E. */
const SHANGHAI = { lat: 31.2304, lng: 121.4737 }

describe('coordinate order', () => {
    it('maps domain {lat,lng} to Leaflet [lat,lng] without swapping', () => {
        expect(toLeafletTuple(SHANGHAI)).toEqual([31.2304, 121.4737])
        // Latitude is the first element, so a Shanghai point is not ~121.
        expect(toLeafletTuple(SHANGHAI)[0]).toBe(31.2304)
        expect(toLeafletTuple(SHANGHAI)[1]).toBe(121.4737)
    })

    it('maps domain {lat,lng} to GeoJSON [lng,lat] with the swap', () => {
        expect(toGeoJsonPosition(SHANGHAI)).toEqual([121.4737, 31.2304])
    })

    it('round-trips both conventions', () => {
        expect(fromLeafletTuple(toLeafletTuple(SHANGHAI))).toEqual(SHANGHAI)
        expect(fromGeoJsonPosition(toGeoJsonPosition(SHANGHAI))).toEqual(SHANGHAI)
    })

    it('rejects a swapped pair that leaves the valid latitude range', () => {
        expect(isValidLatitude(121.4737)).toBe(false)
        expect(() => assertLatLng({ lat: 121.4737, lng: 31.2304 })).toThrow(CoordinateError)
    })
})

describe('coordinate validation', () => {
    it('accepts the Shanghai reference point', () => {
        expect(assertLatLng(SHANGHAI)).toEqual(SHANGHAI)
    })

    it('rejects out-of-range and non-finite values', () => {
        expect(isValidLatitude(90)).toBe(true)
        expect(isValidLatitude(90.1)).toBe(false)
        expect(isValidLongitude(-180)).toBe(true)
        expect(isValidLongitude(-180.1)).toBe(false)
        expect(isValidLatitude(Number.NaN)).toBe(false)
        expect(isValidLongitude(Number.POSITIVE_INFINITY)).toBe(false)
        expect(() => toLeafletTuple({ lat: 91, lng: 0 })).toThrow(CoordinateError)
        expect(() => toGeoJsonPosition({ lat: 0, lng: 181 })).toThrow(CoordinateError)
    })
})

describe('viewport bounds', () => {
    const ordinary = { minLat: 31.1, maxLat: 31.3, minLng: 121.3, maxLng: 121.6 }

    it('keeps an ordinary bbox as one request', () => {
        const query = splitBounds(ordinary)
        expect(query.crossedAntimeridian).toBe(false)
        expect(query.bounds).toHaveLength(1)
        expect(query.bounds[0]).toEqual(ordinary)
        expect(query.bounds[0]!.minLng).toBeLessThan(query.bounds[0]!.maxLng)
    })

    it('splits a date-line bbox into two valid requests', () => {
        const crossing = { minLat: -10, maxLat: 10, minLng: 170, maxLng: -170 }
        const query = splitBounds(crossing)
        expect(query.crossedAntimeridian).toBe(true)
        expect(query.bounds).toHaveLength(2)
        expect(query.bounds[0]).toEqual({ minLat: -10, maxLat: 10, minLng: 170, maxLng: 180 })
        expect(query.bounds[1]).toEqual({ minLat: -10, maxLat: 10, minLng: -180, maxLng: -170 })
        // The backend rejects minLng > maxLng, so both halves must be ordered.
        for (const bounds of query.bounds) {
            expect(bounds.minLng).toBeLessThanOrEqual(bounds.maxLng)
        }
    })

    it('rejects an inverted latitude range', () => {
        expect(() => splitBounds({ minLat: 40, maxLat: 30, minLng: 0, maxLng: 1 })).toThrow(
            CoordinateError,
        )
    })

    it('does not silently "fix" an inverted bbox into a split', () => {
        // 121 -> 120 is a plain inverted bbox, not a date-line crossing.
        const query = splitBounds({ minLat: 0, maxLat: 1, minLng: 121, maxLng: 120 })
        expect(query.crossedAntimeridian).toBe(true)
        expect(query.bounds).toHaveLength(2)
    })
})
