import 'leaflet/dist/leaflet.css'
import { useEffect, type RefCallback } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L, { type Map as LeafletMap } from 'leaflet'
const CENTER: [number, number] = [31.2304, 121.4737]
export function MapSurface({ onMap }: { onMap: RefCallback<LeafletMap> }) {
    return (
        <MapContainer
            ref={onMap}
            center={CENTER}
            zoom={14}
            zoomControl={false}
            trackResize={false}
            className="product-map"
            attributionControl
        >
            <TileLayer
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution={
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }
            />
            <MapLifecycle />
        </MapContainer>
    )
}
function MapLifecycle() {
    const map = useMap()
    useEffect(() => {
        const container = map.getContainer()
        // Read-only DOM evidence for development/real-Leaflet regression tests.
        const report = () => {
            if (!import.meta.env.DEV) return
            container.dataset.mapId = String(L.stamp(map))
            container.dataset.zoom = String(map.getZoom())
            container.dataset.center = `${map.getCenter().lat},${map.getCenter().lng}`
        }
        let width = container.clientWidth
        let height = container.clientHeight
        const resize = new ResizeObserver(() => {
            const nextWidth = container.clientWidth
            const nextHeight = container.clientHeight
            if (nextWidth === width && nextHeight === height) return
            width = nextWidth
            height = nextHeight
            // One resize owner; Leaflet's public pan compensation keeps the
            // camera within its half-pixel rounding across odd/even widths.
            map.invalidateSize({ pan: true, animate: false })
        })
        resize.observe(container)
        report()
        map.on('moveend zoomend', report)
        return () => {
            resize.disconnect()
            map.off('moveend zoomend', report)
        }
    }, [map])
    return null
}
