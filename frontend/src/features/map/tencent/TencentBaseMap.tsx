import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { loadTencentSdk, type TencentMap } from './sdk'
import { tencentCrs, toTencent } from './coordinates'

const CREDIT = '&copy; <a href="https://map.qq.com/" target="_blank" rel="noopener">腾讯地图</a>'

/** Official Tencent renderer; Leaflet retains the app's controls and WGS84 data. */
export default function TencentBaseMap({ onError }: { onError: () => void }) {
    const map = useMap()
    const failure = useRef(onError)
    failure.current = onError
    useEffect(() => {
        let disposed = false,
            instance: TencentMap | undefined,
            ready = false
        let restoreProjection: (() => void) | undefined
        let sync = () => {}
        const container = document.createElement('div')
        container.className = 'tencent-basemap'
        container.setAttribute('aria-hidden', 'true')
        let watchdog: number | undefined
        const fail = () => {
            if (!disposed) failure.current()
        }
        void loadTencentSdk()
            .then((sdk) => {
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
                    if (instance?.getZoom() !== map.getZoom()) instance?.setZoom(map.getZoom())
                    const previous = instance?.getCenter()
                    if (!previous || previous.lat !== current.lat || previous.lng !== current.lng)
                        instance?.setCenter(new sdk.LatLng(current.lat, current.lng))
                }
                map.on('move zoom resize', sync)
                instance.on('context_lost', fail)
                instance.on('tilesloaded', () => {
                    ready = true
                    window.clearTimeout(watchdog)
                    container.dataset.loaded = 'true'
                })
                watchdog = window.setTimeout(() => {
                    if (!ready) fail()
                }, 20000)
                sync()
            })
            .catch(fail)
        return () => {
            disposed = true
            window.clearTimeout(watchdog)
            map.off('move zoom resize', sync)
            instance?.off('context_lost', fail)
            instance?.destroy()
            container.remove()
            if (map.getPane('mapPane')) restoreProjection?.()
        }
    }, [map])
    return null
}
