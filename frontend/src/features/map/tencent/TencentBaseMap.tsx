import { useEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import type { TencentMap } from './sdk'
import { loadTencentResources } from './resources'
import { createLoadWatchdog } from '../loadWatchdog'

const CREDIT = '&copy; <a href="https://map.qq.com/" target="_blank" rel="noopener">腾讯地图</a>'

/** Official Tencent renderer; Leaflet retains the app's controls and WGS84 data. */
export default function TencentBaseMap({
    onError,
    onReady,
}: {
    onError: () => void
    onReady?: () => void
}) {
    const map = useMap()
    const [connectionVersion, setConnectionVersion] = useState(0)
    useEffect(() => {
        const reconnect = () => setConnectionVersion((value) => value + 1)
        window.addEventListener('online', reconnect)
        return () => window.removeEventListener('online', reconnect)
    }, [])
    const failure = useRef(onError)
    failure.current = onError
    const readyCallback = useRef(onReady)
    readyCallback.current = onReady
    useEffect(() => {
        let disposed = false,
            instance: TencentMap | undefined,
            rendered = false
        let restoreProjection: (() => void) | undefined
        let sync = () => {}
        const container = document.createElement('div')
        container.className = 'tencent-basemap'
        container.setAttribute('aria-hidden', 'true')
        const fail = () => {
            if (!disposed) failure.current()
        }
        const watchdog = createLoadWatchdog(fail)
        void loadTencentResources()
            .then(([sdk, { tencentCrs, toTencent }]) => {
                if (disposed) return
                const crs = map.options.crs,
                    minZoom = map.options.minZoom
                const zoomAnimationThreshold = map.options.zoomAnimationThreshold
                map.stop()
                const center = map.getCenter(),
                    zoom = Math.max(3, map.getZoom())
                map.getContainer().prepend(container)
                const point = toTencent(center.wrap())
                instance = new sdk.Map(container, {
                    center: new sdk.LatLng(point.lat, point.lng),
                    zoom,
                    minZoom: 3,
                    maxZoom: 19,
                    viewMode: '2D',
                    showControl: false,
                    draggable: false,
                    scrollable: false,
                    doubleClickZoom: false,
                    touchZoomable: false,
                })
                // The CRS boundary covers pins, GPS, camera focus, viewport queries and
                // contributed coordinates together, without mutating domain values.
                map.options.crs = tencentCrs
                // CSS zooming a separate WebGL canvas would briefly misalign pins.
                // Pinch zoom and pan still follow Leaflet's continuous move events.
                map.options.zoomAnimationThreshold = 0
                map.setMinZoom(3)
                const reset = { animate: false, reset: true }
                map.setView(center, zoom, reset)
                map.attributionControl.addAttribution(CREDIT)
                restoreProjection = () => {
                    const current = map.getCenter(),
                        currentZoom = map.getZoom()
                    map.options.crs = crs
                    map.options.zoomAnimationThreshold = zoomAnimationThreshold
                    map.setMinZoom(minZoom ?? 0)
                    map.setView(current, currentZoom, reset)
                    map.attributionControl.removeAttribution(CREDIT)
                }
                sync = () => {
                    const current = toTencent(map.getCenter().wrap())
                    const zoomChanged = Math.abs((instance?.getZoom() ?? -1) - map.getZoom()) > 1e-6
                    const previous = instance?.getCenter()
                    const centerChanged =
                        !previous ||
                        Math.abs(previous.lat - current.lat) > 1e-8 ||
                        Math.abs(previous.lng - current.lng) > 1e-8
                    if (zoomChanged || centerChanged) watchdog.start()
                    if (zoomChanged) instance?.setZoom(map.getZoom())
                    if (centerChanged) instance?.setCenter(new sdk.LatLng(current.lat, current.lng))
                }
                map.on('move zoom resize', sync)
                instance.on('context_lost', fail)
                instance.on('tilesloaded', () => {
                    rendered = true
                    watchdog.clear()
                    readyCallback.current?.()
                    container.dataset.loaded = 'true'
                })
                // Cached viewport changes can become idle without fetching any
                // tiles. Do not mistake the absent tilesloaded event for a hang.
                instance.on('idle', () => {
                    if (rendered) watchdog.clear()
                })
                watchdog.start()
                sync()
            })
            .catch(fail)
        return () => {
            disposed = true
            watchdog.destroy()
            map.off('move zoom resize', sync)
            instance?.off('context_lost', fail)
            instance?.destroy()
            container.remove()
            if (map.getPane('mapPane')) restoreProjection?.()
        }
    }, [map, connectionVersion])
    return null
}
