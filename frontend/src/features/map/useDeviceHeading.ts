import { useEffect, useState, useSyncExternalStore } from 'react'

type CompassEvent = DeviceOrientationEvent & {
    webkitCompassHeading?: number
    webkitCompassAccuracy?: number
}
type PermissionOrientation = typeof DeviceOrientationEvent & {
    requestPermission?: (absolute?: boolean) => Promise<string>
}
export type HeadingPermission = 'unsupported' | 'granted' | 'denied' | 'prompt'
type HeadingChoice = 'enabled' | 'denied' | 'dismissed'
const headingChoiceKey = 'lycoris.map.heading-choice.v1'
const normalize = (angle: number) => ((angle % 360) + 360) % 360

/** A UI preference, never proof that the browser still permits the sensor. */
export function hasRememberedHeadingChoice(): boolean {
    try {
        const choice = localStorage.getItem(headingChoiceKey)
        return choice === 'enabled' || choice === 'denied' || choice === 'dismissed'
    } catch {
        return false
    }
}
function rememberHeadingChoice(choice: HeadingChoice) {
    try {
        localStorage.setItem(headingChoiceKey, choice)
    } catch {
        // Blocked storage must not prevent using or dismissing the compass.
    }
}
export function dismissHeadingGuide(): void {
    rememberHeadingChoice('dismissed')
}

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

function permissionSensor(): PermissionOrientation | undefined {
    return globalThis.DeviceOrientationEvent as PermissionOrientation | undefined
}

/**
 * True only on touch devices whose browser gates orientation behind a user
 * gesture (iOS/iPadOS Safari). `maxTouchPoints` includes iPad reporting a
 * desktop UA, so width/UA sniffing is never used. Android Chrome exposes the
 * sensor without `requestPermission`, so it is excluded and keeps reading.
 */
export function headingPermissionRequired(): boolean {
    return (
        typeof permissionSensor()?.requestPermission === 'function' &&
        (navigator.maxTouchPoints ?? 0) > 0
    )
}

/**
 * One shared permission state per document. `requestPermission(true)` must be
 * called directly from a real user activation (a click handler), so the
 * promise is created synchronously by `enable` and in-flight prompts are
 * de-duplicated so a second click cannot open a second dialog.
 */
class HeadingPermissionStore {
    private permission: HeadingPermission = 'unsupported'
    private listeners = new Set<() => void>()
    private pending: Promise<HeadingPermission> | null = null
    constructor() {
        this.permission = headingPermissionRequired() ? 'prompt' : 'unsupported'
    }
    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
    getSnapshot = (): HeadingPermission => this.permission
    private emit(permission: HeadingPermission) {
        if (permission === this.permission) return
        this.permission = permission
        this.listeners.forEach((listener) => listener())
    }
    /** Actual compass events confirm access; a saved preference cannot do so. */
    acceptReading = () => {
        if (!headingPermissionRequired() || this.permission === 'granted') return
        rememberHeadingChoice('enabled')
        this.emit('granted')
    }
    /**
     * Must be invoked synchronously inside a user activation handler.
     * Page loads never invoke this API: WebKit may request fresh consent.
     */
    enable = (): Promise<HeadingPermission> => {
        const sensor = permissionSensor()
        if (!headingPermissionRequired() || !sensor?.requestPermission) {
            this.emit('unsupported')
            return Promise.resolve('unsupported')
        }
        if (this.permission === 'granted') return Promise.resolve('granted')
        if (this.pending) return this.pending
        // requestPermission can throw synchronously on some WebKit builds; a
        // throw here must not escape the click handler. Treat it as retryable.
        let request: Promise<string>
        try {
            request = sensor.requestPermission(true)
        } catch {
            this.emit('prompt')
            return Promise.resolve('prompt')
        }
        this.pending = request.then(
            (result) => {
                this.pending = null
                if (result === 'granted') {
                    rememberHeadingChoice('enabled')
                    this.emit('granted')
                    return 'granted' as const
                }
                rememberHeadingChoice('denied')
                this.emit('denied')
                return 'denied' as const
            },
            () => {
                this.pending = null
                // A rejected activation is not a denial.
                // Keep prompting so the user can retry from the visible button.
                this.emit('prompt')
                return 'prompt' as const
            },
        )
        return this.pending
    }
}
let store: HeadingPermissionStore | null = null
function headingStore(): HeadingPermissionStore {
    return (store ??= new HeadingPermissionStore())
}
/** Test-only: re-evaluate the device and clear the shared permission state. */
export function resetHeadingPermissionForTests(): void {
    store = null
}

/** Synchronous, gesture-safe enable used by the explicit button and Locate. */
export function enableDeviceHeading(): Promise<HeadingPermission> {
    return headingStore().enable()
}
export function useHeadingPermission(): HeadingPermission {
    const current = headingStore()
    const permission = useSyncExternalStore(
        current.subscribe,
        current.getSnapshot,
        current.getSnapshot,
    )
    return permission
}

export function useDeviceHeading(enabled: boolean) {
    const [heading, setHeading] = useState<number | null>(null)
    useEffect(() => {
        setHeading(null)
        let frame = 0
        let reading: number | null = null
        let latest: CompassEvent | null = null
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
            if (document.hidden) return
            // Relative events from the same browser must not erase absolute ones.
            if (
                !event.absolute &&
                event.type !== 'deviceorientationabsolute' &&
                !('webkitCompassHeading' in event)
            )
                return
            latest = event
            if (compassHeading(event) !== null) headingStore().acceptReading()
            // Some devices emit only when their orientation changes. A still
            // phone's valid compass reading must not disappear after 10 seconds.
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
            window.removeEventListener('deviceorientation', receive)
            window.removeEventListener('deviceorientationabsolute', receive as EventListener)
            window.removeEventListener('orientationchange', update)
            screen.orientation?.removeEventListener('change', update)
            document.removeEventListener('visibilitychange', visibility)
        }
    }, [])
    return enabled ? heading : null
}
