import { splitBounds, type Bounds, type LatLng } from './coords'

export type MapView = { bounds: readonly Bounds[]; center: LatLng; zoom: number }
export type MapPadding = { left: number; bottom: number; top: number; right: number }
export type MapFocus = { point: LatLng; key: string; zoom?: number }
const round = (n: number) => Math.round(n * 1e6) / 1e6
export const wrapLongitude = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180

/** Normalize Leaflet world copies before splitting, using the same precision as query keys. */
export function mapView(
    south: number,
    north: number,
    west: number,
    east: number,
    center: LatLng,
    zoom: number,
): MapView {
    if (![south, north, west, east, center.lat, center.lng, zoom].every(Number.isFinite))
        throw new Error('Invalid map view')
    const latitude = {
        minLat: round(Math.max(-90, Math.min(90, south))),
        maxLat: round(Math.max(-90, Math.min(90, north))),
    }
    const bounds =
        east - west >= 360
            ? [{ ...latitude, minLng: -180, maxLng: 180 }]
            : splitBounds({
                  ...latitude,
                  minLng: round(wrapLongitude(west)),
                  maxLng: round(wrapLongitude(east)),
              }).bounds
    return {
        bounds,
        center: { lat: round(center.lat), lng: round(wrapLongitude(center.lng)) },
        zoom,
    }
}
