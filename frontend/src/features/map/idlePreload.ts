type Connection = EventTarget & { saveData?: boolean; effectiveType?: string }

/** Best-effort network quiet + CPU idle, after the visible basemap has loaded. */
export function scheduleIdlePreload(load: () => Promise<unknown>) {
    const connection = (navigator as Navigator & { connection?: Connection }).connection
    let quietSince = performance.now(),
        finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let idle: number | undefined
    const cancel = () => {
        clearTimeout(timer)
        if (idle !== undefined) window.cancelIdleCallback?.(idle)
        idle = undefined
    }
    const permitted = () =>
        document.visibilityState !== 'hidden' &&
        navigator.onLine !== false &&
        !connection?.saveData &&
        !/^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '')
    const execute = () => {
        idle = undefined
        if (!permitted() || performance.now() - quietSince < 3000) return schedule()
        finished = true
        cleanup()
        // Warming failure stays silent; a deliberate selection can retry later.
        void load().catch(() => {})
    }
    const schedule = () => {
        cancel()
        if (finished || !permitted()) return
        timer = setTimeout(() => {
            if (document.readyState !== 'complete') return schedule()
            if (window.requestIdleCallback) idle = window.requestIdleCallback(execute)
            else execute()
        }, 3000)
    }
    const busy = () => {
        quietSince = performance.now()
        schedule()
    }
    let observer: PerformanceObserver | undefined
    if (typeof PerformanceObserver !== 'undefined') {
        try {
            observer = new PerformanceObserver(busy)
            observer.observe({ type: 'resource' })
        } catch {
            /* Older WebKit still gets the load/interaction idle guard. */
        }
    }
    const inputs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchmove'] as const
    const states = ['online', 'offline', 'load'] as const
    for (const event of inputs) window.addEventListener(event, busy, { passive: true })
    for (const event of states) window.addEventListener(event, busy)
    document.addEventListener('visibilitychange', busy)
    connection?.addEventListener('change', busy)
    function cleanup() {
        cancel()
        observer?.disconnect()
        for (const event of inputs) window.removeEventListener(event, busy)
        for (const event of states) window.removeEventListener(event, busy)
        document.removeEventListener('visibilitychange', busy)
        connection?.removeEventListener('change', busy)
    }
    schedule()
    return () => {
        finished = true
        cleanup()
    }
}
