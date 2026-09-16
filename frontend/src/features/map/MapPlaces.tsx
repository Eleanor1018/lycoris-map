import { useEffect, useMemo, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Marker } from '@/shared/api/markers'
import pin from '@/assets/figma/map-place.svg'
import positionPin from '@/assets/figma/map-position.svg'
import { clusterPlaces } from './clusters'
import { mapView, type MapFocus, type MapPadding, type MapView } from './viewport'
import type { LatLng } from './coords'
import './map-places.css'

const placeIcon = L.icon({ iconUrl: pin, iconSize: [27, 43], iconAnchor: [13.5, 39] })
const locationIcon = L.divIcon({
    className: 'map-location-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: (() => {
        const image = document.createElement('img')
        image.src = positionPin
        image.alt = ''
        return image
    })(),
})
const EMPTY: readonly Marker[] = []
const DEFAULT_PADDING: MapPadding = { left: 0, right: 0, top: 0, bottom: 0 }
export type SharedTarget = LatLng & { title: string; showLabel?: boolean }
export type MapPlacesProps = {
    sharedTarget?: SharedTarget | undefined
    markers?: readonly Marker[] | undefined
    selected?: Marker | undefined
    position?: LatLng | null | undefined
    focus?: MapFocus | null | undefined
    padding?: MapPadding | undefined
    onView?: ((view: MapView) => void) | undefined
    onSelect?: ((marker: Marker, focusId: string) => void) | undefined
    onCluster?: ((ids: number[]) => void) | undefined
}

export function MapPlaces({
    sharedTarget,
    markers = EMPTY,
    selected,
    position,
    focus,
    padding = DEFAULT_PADDING,
    onView,
    onSelect,
    onCluster,
}: MapPlacesProps) {
    const map = useMap()
    const registry = useRef(new Map<string, L.Marker>())
    const { left, right, top, bottom } = padding
    const camera = useRef(padding)
    camera.current = padding
    const centerTarget = (point: LatLng, zoom: number) => {
        const p = camera.current
        const lng = point.lng + 360 * Math.round((map.getCenter().lng - point.lng) / 360)
        const center = map
            .project([point.lat, lng], zoom)
            .subtract(L.point((p.left - p.right) / 2, (p.top - p.bottom) / 2))
        map.setView(map.unproject(center, zoom), zoom, { animate: false })
    }
    const index = useMemo(() => clusterPlaces(markers), [markers])
    useEffect(() => {
        if (!onView) return
        const report = () => {
            const b = map.getBounds()
            onView(
                mapView(
                    b.getSouth(),
                    b.getNorth(),
                    b.getWest(),
                    b.getEast(),
                    map.getCenter(),
                    map.getZoom(),
                ),
            )
        }
        report()
        map.on('moveend zoomend resize', report)
        return () => {
            map.off('moveend zoomend resize', report)
        }
    }, [map, onView])
    useEffect(() => {
        const entries = registry.current
        return () => {
            entries.forEach((marker) => marker.remove())
            entries.clear()
        }
    }, [map])
    useEffect(() => {
        const render = () => {
            const b = map.getBounds()
            const view = mapView(
                b.getSouth(),
                b.getNorth(),
                b.getWest(),
                b.getEast(),
                map.getCenter(),
                map.getZoom(),
            )
            const features = view.bounds.flatMap((box) =>
                index.getClusters(
                    [box.minLng, box.minLat, box.maxLng, box.maxLat],
                    Math.floor(view.zoom),
                ),
            )
            const desired = new Set<string>()
            const byId = new Map(markers.map((marker) => [marker.id, marker]))
            const worldPoint = (point: LatLng): L.LatLngExpression => [
                point.lat,
                point.lng + 360 * Math.round((map.getCenter().lng - point.lng) / 360),
            ]
            const upsert = (
                key: string,
                point: LatLng,
                icon: L.Icon | L.DivIcon,
                title: string,
                action: (() => void) | null,
                zIndex: number,
            ) => {
                desired.add(key)
                let item = registry.current.get(key)
                if (!item) {
                    item = L.marker(worldPoint(point), {
                        icon,
                        title,
                        alt: title,
                        keyboard: !!action,
                        autoPanOnFocus: false,
                        zIndexOffset: zIndex,
                    }).addTo(map)
                    registry.current.set(key, item)
                } else {
                    item.setLatLng(worldPoint(point))
                    if (item.options.icon !== icon) item.setIcon(icon)
                    item.setZIndexOffset(zIndex)
                }
                const element = item.getElement()
                if (element) {
                    element.id = `map-${key}`
                    element.title = title
                    element.setAttribute('aria-label', title)
                    if (element instanceof HTMLImageElement) element.alt = title
                }
                item.off('click')
                if (action) item.on('click', action)
            }
            for (const feature of features) {
                const point = {
                    lng: feature.geometry.coordinates[0]!,
                    lat: feature.geometry.coordinates[1]!,
                }
                const props = feature.properties
                if ('cluster' in props) {
                    const key = `cluster-${props.cluster_id}`
                    if (desired.has(key)) continue
                    const count = document.createElement('span')
                    count.textContent = String(props.point_count_abbreviated)
                    const icon = L.divIcon({
                        html: count,
                        className: 'map-cluster-marker',
                        iconSize: [36, 36],
                        iconAnchor: [18, 18],
                    })
                    upsert(
                        key,
                        point,
                        icon,
                        `${props.point_count} places`,
                        () => {
                            const zoom = index.getClusterExpansionZoom(props.cluster_id)
                            if (zoom > 18)
                                onCluster?.(
                                    index
                                        .getLeaves(props.cluster_id, Infinity)
                                        .map((p) => p.properties.markerId),
                                )
                            else centerTarget(point, zoom)
                        },
                        0,
                    )
                } else {
                    const marker = byId.get(props.markerId)
                    if (marker && marker.id !== selected?.id)
                        upsert(
                            `place-${marker.id}`,
                            point,
                            placeIcon,
                            marker.title,
                            () => onSelect?.(marker, `map-place-${marker.id}`),
                            0,
                        )
                }
            }
            if (selected)
                upsert(
                    `place-${selected.id}`,
                    selected,
                    placeIcon,
                    selected.title,
                    () => onSelect?.(selected, `map-place-${selected.id}`),
                    1000,
                )
            if (sharedTarget) {
                upsert('shared-location', sharedTarget, placeIcon, sharedTarget.title, null, 1000)
                const item = registry.current.get('shared-location')!
                const label = document.createElement('span')
                label.textContent = sharedTarget.title
                if (sharedTarget.showLabel === false) item.unbindTooltip()
                else if (item.getTooltip()) item.setTooltipContent(label)
                else
                    item.bindTooltip(label, {
                        permanent: true,
                        direction: 'top',
                        offset: [0, -36],
                        className: 'map-shared-label',
                    })
            }
            if (position)
                upsert('your-location', position, locationIcon, 'Your location', null, 1100)
            for (const [key, item] of registry.current)
                if (!desired.has(key)) {
                    item.remove()
                    registry.current.delete(key)
                }
        }
        render()
        map.on('moveend zoomend', render)
        return () => {
            map.off('moveend zoomend', render)
        }
    }, [map, markers, index, selected, position, sharedTarget, onSelect, onCluster])
    const previousSelection = useRef<string | null>(null)
    const placeKey = selected ? `${selected.id}:${selected.lat}:${selected.lng}` : null
    const selection = useRef(selected)
    selection.current = selected
    useEffect(() => {
        const target = selection.current
        const changed = previousSelection.current !== placeKey
        previousSelection.current = placeKey
        if (!target) return
        centerTarget(target, changed ? Math.max(15, map.getZoom()) : map.getZoom())
    }, [map, placeKey, left, right, top, bottom])
    const requestedFocus = useRef(focus)
    requestedFocus.current = focus
    useEffect(() => {
        const target = requestedFocus.current
        if (!target) return
        const zoom = target.zoom ?? Math.max(14, map.getZoom())
        centerTarget(target.point, zoom)
        // The request key makes an explicit focus a one-shot camera action.
        // Padding changes alone are handled for selected places above.
    }, [map, focus?.key])
    return null
}
