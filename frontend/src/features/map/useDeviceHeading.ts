import { useEffect, useState } from 'react'

type CompassEvent = DeviceOrientationEvent & {
    webkitCompassHeading?: number
    webkitCompassAccuracy?: number
}
type PermissionOrientation = typeof DeviceOrientationEvent & {
    requestPermission?: (absolute?: boolean) => Promise<string>
}
const normalize = (angle: number) => ((angle % 360) + 360) % 360

/** North-referenced readings only: relative alpha is not a compass bearing. */
export function compassHeading(event: CompassEvent, screenAngle = 0): number | null {
    const compass = event.webkitCompassHeading
    if (typeof compass === 'number' && Number.isFinite(compass) && compass >= 0) {
        const accuracy = event.webkitCompassAccuracy
        if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 45))
            return null
        return normalize(compass + screenAngle)
    }
    if (
        (event.absolute || event.type === 'deviceorientationabsolute') &&
        typeof event.alpha === 'number' &&
        Number.isFinite(event.alpha)
    )
        return normalize(360 - event.alpha + screenAngle)
    return null
}

export function requestDeviceHeading() {
    const sensor = globalThis.DeviceOrientationEvent as PermissionOrientation | undefined
    if (!sensor?.requestPermission) return
    // Unsupported/denied sensors simply keep the undirected location dot.
    try {
        void sensor.requestPermission(true).catch(() => {})
    } catch {
        /* unavailable */
    }
}

export function useDeviceHeading(enabled: boolean) {
    const [heading, setHeading] = useState<number | null>(null)
    useEffect(() => {
        setHeading(null)
        if (!enabled) return
        let frame = 0
        let reading: number | null = null
        let latest: CompassEvent | null = null
        let expiry: ReturnType<typeof setTimeout> | undefined
        const publish = () => {
            frame = 0
            setHeading((previous) => {
                if (reading === null || previous === null) return reading
                const delta = ((((reading - previous + 540) % 360) + 360) % 360) - 180
                // Continuous angles avoid a full spin when crossing north.
                return Math.abs(delta) >= 1 ? previous + delta : previous
            })
        }
        const update = () => {
            const angle =
                screen.orientation?.angle ??
                (typeof window.orientation === 'number' ? window.orientation : 0)
            reading = latest ? compassHeading(latest, angle) : null
            if (!frame) frame = requestAnimationFrame(publish)
        }
        const receive = (event: DeviceOrientationEvent) => {
            // Relative events from the same browser must not erase absolute ones.
            if (
                !event.absolute &&
                event.type !== 'deviceorientationabsolute' &&
                !('webkitCompassHeading' in event)
            )
                return
            latest = event
            clearTimeout(expiry)
            expiry = setTimeout(() => {
                latest = null
                update()
            }, 10_000)
            update()
        }
        const visibility = () => {
            if (document.hidden) {
                latest = null
                update()
            }
        }
        window.addEventListener('deviceorientation', receive)
        window.addEventListener('deviceorientationabsolute', receive as EventListener)
        window.addEventListener('orientationchange', update)
        screen.orientation?.addEventListener('change', update)
        document.addEventListener('visibilitychange', visibility)
        return () => {
            cancelAnimationFrame(frame)
            clearTimeout(expiry)
            window.removeEventListener('deviceorientation', receive)
            window.removeEventListener('deviceorientationabsolute', receive as EventListener)
            window.removeEventListener('orientationchange', update)
            screen.orientation?.removeEventListener('change', update)
            document.removeEventListener('visibilitychange', visibility)
        }
    }, [enabled])
    return enabled ? heading : null
}
