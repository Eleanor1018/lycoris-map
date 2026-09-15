import Supercluster from 'supercluster'
import type { Marker } from '@/shared/api/markers'

/** Index fresh DTOs even when version is unchanged: translations/open status can change. */
export function clusterPlaces(markers: readonly Marker[]) {
    return new Supercluster<{ markerId: number }, Record<string, never>>({
        radius: 48,
        maxZoom: 18,
    }).load(
        markers.map((marker) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [marker.lng, marker.lat] },
            properties: { markerId: marker.id },
        })),
    )
}
