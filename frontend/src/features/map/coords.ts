/**
 * Coordinate adapter between the domain/API shape and Leaflet / GeoJSON.
 *
 * Domain and API use `{ lat, lng }` (see `MarkerDto`). The two external
 * conventions differ:
 * - Leaflet `LatLngExpression` and its `LatLng` object use `[lat, lng]`.
 * - GeoJSON uses `[longitude, latitude]` (and `[lng, lat]` for bboxes).
 *
 * Conversions are explicit and validated so a swapped pair fails loudly instead
 * of silently rendering a point in the wrong hemisphere.
 */

export type LatLng = { lat: number; lng: number }

export type LeafletTuple = [lat: number, lng: number]
export type GeoJsonPosition = [lng: number, lat: number]

/** Geographic bounding box in domain order. */
export type Bounds = {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
}

export class CoordinateError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CoordinateError'
    }
}

export function isValidLatitude(value: number): boolean {
    return Number.isFinite(value) && value >= -90 && value <= 90
}

export function isValidLongitude(value: number): boolean {
    return Number.isFinite(value) && value >= -180 && value <= 180
}

/** Validate a domain coordinate; throws on a non-finite or out-of-range value. */
export function assertLatLng(value: LatLng): LatLng {
    if (!isValidLatitude(value.lat)) {
        throw new CoordinateError(`invalid latitude: ${String(value.lat)}`)
    }
    if (!isValidLongitude(value.lng)) {
        throw new CoordinateError(`invalid longitude: ${String(value.lng)}`)
    }
    return value
}

/** Domain `{lat,lng}` -> Leaflet `[lat,lng]` (order preserved). */
export function toLeafletTuple(value: LatLng): LeafletTuple {
    assertLatLng(value)
    return [value.lat, value.lng]
}

/** Leaflet `[lat,lng]` -> domain `{lat,lng}`. */
export function fromLeafletTuple(tuple: readonly [number, number]): LatLng {
    const [lat, lng] = tuple
    return assertLatLng({ lat, lng })
}

/** Domain `{lat,lng}` -> GeoJSON `[lng,lat]` (order swapped). */
export function toGeoJsonPosition(value: LatLng): GeoJsonPosition {
    assertLatLng(value)
    return [value.lng, value.lat]
}

/** GeoJSON `[lng,lat]` -> domain `{lat,lng}`. */
export function fromGeoJsonPosition(position: readonly [number, number]): LatLng {
    const [lng, lat] = position
    return assertLatLng({ lat, lng })
}

/**
 * A viewport query split into one or more valid bounds.
 *
 * The backend rejects `minLng > maxLng`, so a bbox crossing the antimeridian is
 * split into two ordinary bounds instead of being sent as one wrapped request.
 */
export type ViewportQuery = {
    bounds: readonly [Bounds] | readonly [Bounds, Bounds]
    crossedAntimeridian: boolean
}

/** Split an east/north-positive bbox when it crosses the date line. */
export function splitBounds(bounds: Bounds): ViewportQuery {
    const { minLat, maxLat, minLng, maxLng } = assertBounds(bounds)
    if (minLng <= maxLng) {
        return { bounds: [{ minLat, maxLat, minLng, maxLng }], crossedAntimeridian: false }
    }
    return {
        bounds: [
            { minLat, maxLat, minLng, maxLng: 180 },
            { minLat, maxLat, minLng: -180, maxLng },
        ],
        crossedAntimeridian: true,
    }
}

export function assertBounds(bounds: Bounds): Bounds {
    if (!isValidLatitude(bounds.minLat) || !isValidLatitude(bounds.maxLat)) {
        throw new CoordinateError('invalid latitude in bounds')
    }
    if (!isValidLongitude(bounds.minLng) || !isValidLongitude(bounds.maxLng)) {
        throw new CoordinateError('invalid longitude in bounds')
    }
    if (bounds.minLat > bounds.maxLat) {
        throw new CoordinateError('minLat must not exceed maxLat')
    }
    return bounds
}
