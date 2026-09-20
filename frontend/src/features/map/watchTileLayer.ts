import type L from 'leaflet'
import { createLoadWatchdog } from './loadWatchdog'

/** Watch real requests, including subsequent viewports, without probing extra tiles. */
export function watchTileLayer(layer: L.TileLayer, onError: () => void, onReady: () => void) {
    let successes = 0,
        errors = 0,
        healthy = false,
        disposed = false,
        reported = false
    const fail = () => {
        if (
            disposed ||
            reported ||
            navigator.onLine === false ||
            document.visibilityState === 'hidden'
        )
            return
        reported = true
        onError()
    }
    const watchdog = createLoadWatchdog(() => {
        if (successes === 0) fail()
    })
    const loading = () => {
        successes = errors = 0
        watchdog.start()
    }
    const loaded = () => {
        successes++
        healthy = true
        onReady()
    }
    const error = () => {
        errors++
    }
    const complete = () => {
        // One failed edge tile must not discard a working basemap. A largely
        // failed batch, or no successful initial tile before the deadline, is
        // evidence that this provider is unavailable.
        if (errors >= 3 && errors / (errors + successes) >= 0.75) fail()
        if (successes > 0 || healthy) watchdog.clear()
    }
    const reconnect = () => layer.redraw()
    const handlers = { loading, tileload: loaded, tileerror: error, load: complete }
    layer.on(handlers)
    window.addEventListener('online', reconnect)
    if (layer.isLoading()) loading()
    return () => {
        disposed = true
        watchdog.destroy()
        layer.off(handlers)
        window.removeEventListener('online', reconnect)
    }
}
