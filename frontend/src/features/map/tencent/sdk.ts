import { tencentApiKey } from '../mapSources'
import type { LatLng } from '../coords'
import { createLoadWatchdog } from '../loadWatchdog'

export type TencentMap = {
    setCenter(center: LatLng): void
    setZoom(zoom: number): void
    getZoom(): number
    getCenter(): LatLng
    on(event: string, callback: () => void): void
    off(event: string, callback: () => void): void
    destroy(): void
}
export type TencentSdk = {
    Map: new (
        container: HTMLElement,
        options: {
            center: LatLng
            zoom: number
            minZoom: number
            maxZoom: number
            viewMode: '2D'
            showControl: boolean
            draggable: boolean
            scrollable: boolean
            doubleClickZoom: boolean
            touchZoomable: boolean
        },
    ) => TencentMap
    LatLng: new (lat: number, lng: number) => LatLng
}
declare global {
    interface Window {
        TMap?: TencentSdk
        __lycorisTencentReady?: () => void
    }
}
let loading: Promise<TencentSdk> | undefined
let pendingScript: HTMLScriptElement | undefined

export function loadTencentSdk(background = false): Promise<TencentSdk> {
    if (window.TMap) return Promise.resolve(window.TMap)
    if (loading) {
        if (!background && pendingScript) pendingScript.fetchPriority = 'high'
        return loading
    }
    loading = new Promise<TencentSdk>((resolve, reject) => {
        const script = document.createElement('script')
        script.async = true
        script.fetchPriority = background ? 'low' : 'high'
        pendingScript = script
        // Tencent requires its callback parameter for dynamically inserted scripts.
        // The synchronous entry can use document.write and replace an existing page.
        script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(tencentApiKey())}&callback=__lycorisTencentReady`
        const watchdog = createLoadWatchdog(() => finish(new Error('Tencent SDK timed out')))
        const finish = (error?: Error) => {
            pendingScript = undefined
            watchdog.destroy()
            script.onload = null
            script.onerror = null
            delete window.__lycorisTencentReady
            if (error || !window.TMap) {
                script.remove()
                loading = undefined
                reject(error ?? new Error('Tencent SDK unavailable'))
            } else resolve(window.TMap)
        }
        window.__lycorisTencentReady = () => finish()
        script.onerror = () => finish(new Error('Tencent SDK could not load'))
        watchdog.start()
        document.head.append(script)
    })
    return loading
}
