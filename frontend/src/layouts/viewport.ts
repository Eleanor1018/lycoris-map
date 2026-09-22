import { useSyncExternalStore } from 'react'

/**
 * A single, stable snapshot of the *visual* viewport used by every part of the
 * phone layout: the map shell height, the sheet height and the sheet's own
 * coordinate maths. Keeping one snapshot is what stops the CSS (`100dvh`) and
 * the JS (`innerHeight`) from disagreeing after iOS shrinks the URL bar, pans
 * the page for the keyboard or stops a pinch zoom.
 *
 * `height` is the layout height the browser reports for a normal (unzoomed)
 * zoom, and `offsetTop` is how far the visual window has been panned down
 * inside the layout viewport (non-zero while the keyboard is up). We never
 * treat `offsetTop` as extra safe area: the shell grows by it so its bottom
 * edge stays glued to the visible bottom edge, and the sheet is measured
 * against `height` alone.
 */
export type ViewportSnapshot = {
    /** Visible layout height in CSS pixels, excluding any keyboard pan. */
    height: number
    /** How far the visual window top sits below the layout origin. */
    offsetTop: number
    /** `offsetTop + height`, the visual bottom edge in layout coordinates. */
    bottom: number
    /** Last observed `visualViewport.scale`; size stays stable during pinch zoom. */
    scale: number
}

/** Fallback size for server rendering and the rare pre-`innerHeight` read. */
export const DEFAULT_VIEWPORT_SNAPSHOT: ViewportSnapshot = {
    height: 812,
    offsetTop: 0,
    bottom: 812,
    scale: 1,
}

/** Below this deviation we still treat the page as unzoomed. */
export const NORMAL_SCALE_EPSILON = 0.01

export function isNormalScale(scale: number) {
    return Number.isFinite(scale) && Math.abs(scale - 1) < NORMAL_SCALE_EPSILON
}

type RawViewport = { height: number; offsetTop: number; scale: number; fallbackHeight: number }

/**
 * Read `visualViewport` when it is present and usable, otherwise fall back to
 * `innerHeight`. A missing, zero, negative or non-finite `height`/`offsetTop`
 * is treated as unusable rather than trusted, so a partially implemented
 * `visualViewport` can never collapse the layout to nothing.
 */
function readRawViewport(): RawViewport {
    const fallback =
        typeof window === 'undefined' || !Number.isFinite(window.innerHeight)
            ? DEFAULT_VIEWPORT_SNAPSHOT.height
            : Math.max(1, window.innerHeight)
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!viewport) return { height: fallback, offsetTop: 0, scale: 1, fallbackHeight: fallback }
    const scale = Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : 1
    const height =
        Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : fallback
    const offsetTop =
        Number.isFinite(viewport.offsetTop) && viewport.offsetTop > 0 ? viewport.offsetTop : 0
    return { height, offsetTop, scale, fallbackHeight: fallback }
}

let snapshot: ViewportSnapshot = { ...DEFAULT_VIEWPORT_SNAPSHOT }
let snapshotSource: RawViewport = {
    height: DEFAULT_VIEWPORT_SNAPSHOT.height,
    offsetTop: 0,
    scale: 1,
    fallbackHeight: DEFAULT_VIEWPORT_SNAPSHOT.height,
}
/** True once a normal-scale read has produced a trusted unzoomed layout. */
let established = false
const listeners = new Set<() => void>()
let frame = 0
let attached = false

function commit(next: ViewportSnapshot) {
    if (next === snapshot) return
    const changed =
        next.height !== snapshot.height ||
        next.offsetTop !== snapshot.offsetTop ||
        next.scale !== snapshot.scale
    snapshot = next
    if (changed) for (const listener of listeners) listener()
}

function sameSource(a: RawViewport, b: RawViewport) {
    return a.height === b.height && a.offsetTop === b.offsetTop && a.scale === b.scale
}

/**
 * Recompute from the DOM. While a pinch zoom is active (`scale !== 1`) the last
 * unzoomed layout is kept, so browser and map pinch zoom never shrink the app
 * into the zoomed visual window; the live scale is still tracked so the next
 * read at scale 1 resynchronises.
 *
 * `force` re-commits even when the raw source is unchanged, which is needed
 * when (re)subscribing so a snapshot cached from a previous environment is
 * replaced by the current one.
 *
 * A pinch can be active on the very first read (e.g. reloading while zoomed).
 * In that case there is no trustworthy unzoomed height to keep, so fall back to
 * the valid `innerHeight` rather than adopting a stale/default 812 — the
 * snapshot must never be inherited across page loads.
 */
function refresh(force = false) {
    const raw = readRawViewport()
    if (!isNormalScale(raw.scale)) {
        const changed = !established || raw.scale !== snapshot.scale || force
        snapshotSource = raw
        if (changed) {
            // Keep a real unzoomed layout when we have one; otherwise seed from
            // the still-valid innerHeight so the UI is usable at any size.
            const height = established ? snapshot.height : Math.max(1, raw.fallbackHeight)
            const offsetTop = established ? snapshot.offsetTop : 0
            commit({ height, offsetTop, bottom: height + offsetTop, scale: raw.scale })
        }
        return
    }
    if (!force && sameSource(raw, snapshotSource) && isNormalScale(snapshot.scale)) return
    snapshotSource = raw
    established = true
    const height = Math.max(1, Math.round(raw.height))
    const offsetTop = Math.max(0, Math.round(raw.offsetTop))
    commit({ height, offsetTop, bottom: height + offsetTop, scale: 1 })
}

/** Coalesce the noisy `visualViewport` scroll/resize stream into one frame. */
function scheduleRefresh() {
    if (frame) return
    const request =
        typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback: FrameRequestCallback) =>
                  setTimeout(() => callback(0), 0) as unknown as number
    frame = request(() => {
        frame = 0
        refresh()
    })
}

function cancelScheduledRefresh() {
    if (!frame) return
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    else clearTimeout(frame as unknown as ReturnType<typeof setTimeout>)
    frame = 0
}

function handleGlobalChange() {
    // Rotation and URL-bar show/hide are low frequency: update in the event so
    // React sees the new size in the same task, then re-read once more next frame
    // because the browser may not have committed the final layout yet. This is a
    // bounded one-frame calibration, never a polling timer.
    refresh()
    scheduleRefresh()
}

function handleVisualChange() {
    scheduleRefresh()
}

function handleVisibility() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    // Returning from the background (or BFCache) can change the URL-bar inset
    // without firing resize, so re-read immediately and once more next frame.
    refresh()
    scheduleRefresh()
}

function attach() {
    if (attached || typeof window === 'undefined') return
    attached = true
    window.addEventListener('resize', handleGlobalChange)
    window.addEventListener('orientationchange', handleGlobalChange)
    window.addEventListener('pageshow', handleGlobalChange)
    if (typeof document !== 'undefined')
        document.addEventListener('visibilitychange', handleVisibility)
    window.visualViewport?.addEventListener('resize', handleVisualChange)
    window.visualViewport?.addEventListener('scroll', handleVisualChange)
}

function detach() {
    if (!attached || typeof window === 'undefined') return
    attached = false
    window.removeEventListener('resize', handleGlobalChange)
    window.removeEventListener('orientationchange', handleGlobalChange)
    window.removeEventListener('pageshow', handleGlobalChange)
    if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', handleVisibility)
    window.visualViewport?.removeEventListener('resize', handleVisualChange)
    window.visualViewport?.removeEventListener('scroll', handleVisualChange)
    cancelScheduledRefresh()
}

function subscribe(listener: () => void) {
    if (listeners.size === 0) {
        // Do not inherit a snapshot from a previous page/route: start from the
        // neutral default and re-read with `force` so the first subscriber sees
        // the current window, or a valid innerHeight fallback while zoomed.
        if (!established) snapshot = { ...DEFAULT_VIEWPORT_SNAPSHOT }
        refresh(true)
        attach()
        // Calibrate once after the first paint in case the initial read ran
        // before the browser settled the URL-bar inset.
        scheduleRefresh()
    }
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
            detach()
            // A later page must not inherit this page's height.
            established = false
        }
    }
}

function getSnapshot() {
    return snapshot
}

/** Server/pre-paint value: the environment is not measurable yet. */
function getServerSnapshot() {
    return DEFAULT_VIEWPORT_SNAPSHOT
}

/** Subscribe to the shared viewport snapshot. */
export function useViewportSnapshot(): ViewportSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Test-only: drop listeners and cached metrics between cases. */
export function resetViewportStore() {
    detach()
    listeners.clear()
    established = false
    snapshot = { ...DEFAULT_VIEWPORT_SNAPSHOT }
    snapshotSource = {
        height: DEFAULT_VIEWPORT_SNAPSHOT.height,
        offsetTop: 0,
        scale: 1,
        fallbackHeight: DEFAULT_VIEWPORT_SNAPSHOT.height,
    }
    frame = 0
}

/** Test-only introspection of the live listener/frame state. */
export function viewportStoreInternals() {
    return { listeners: listeners.size, attached, pendingFrame: frame !== 0 }
}
