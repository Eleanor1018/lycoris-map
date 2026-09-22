import type { Bounds } from './coords'
import { mapView, type MapView } from './viewport'

export type ViewportWindow = { bounds: readonly Bounds[]; scale: number }

const projectLatitude = (lat: number) =>
    Math.asinh(Math.tan((Math.max(-89.999999, Math.min(89.999999, lat)) * Math.PI) / 180))
const unprojectLatitude = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI

/** Keep a half-screen buffer (plus pixel-rounding tolerance) on every edge;
 * refetch only after leaving it or changing a two-zoom-level scale band.
 * Clustering still follows every zoom. */
export function viewportWindow(previous: ViewportWindow | null, view: MapView): ViewportWindow {
    const scale = Math.floor(Math.max(0, view.zoom) / 2)
    if (
        previous?.scale === scale &&
        view.bounds.every((visible) =>
            previous.bounds.some(
                (loaded) =>
                    visible.minLat >= loaded.minLat &&
                    visible.maxLat <= loaded.maxLat &&
                    visible.minLng >= loaded.minLng &&
                    visible.maxLng <= loaded.maxLng,
            ),
        )
    )
        return previous

    const first = view.bounds[0]!
    const width = view.bounds.reduce((sum, box) => sum + box.maxLng - box.minLng, 0)
    // Padding is in Web Mercator space, like Leaflet's camera. Padding degrees
    // directly makes zooming out exceed the buffer at non-equatorial latitudes.
    const south = projectLatitude(first.minLat)
    const north = projectLatitude(first.maxLat)
    const padding = (north - south) * 0.55
    return {
        scale,
        bounds: mapView(
            first.minLat <= -90 ? -90 : unprojectLatitude(south - padding),
            first.maxLat >= 90 ? 90 : unprojectLatitude(north + padding),
            first.minLng - width * 0.55,
            first.minLng + width * 1.55,
            view.center,
            view.zoom,
        ).bounds,
    }
}
