/** A load deadline counts only while the page is visible and online. */
export function createLoadWatchdog(onTimeout: () => void, timeout = 20000) {
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopTimer = () => {
        clearTimeout(timer)
        timer = undefined
    }
    const resume = () => {
        stopTimer()
        if (!pending || document.visibilityState === 'hidden' || navigator.onLine === false) return
        timer = setTimeout(() => {
            pending = false
            onTimeout()
        }, timeout)
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    window.addEventListener('offline', resume)
    return {
        start() {
            pending = true
            resume()
        },
        clear() {
            pending = false
            stopTimer()
        },
        destroy() {
            pending = false
            stopTimer()
            document.removeEventListener('visibilitychange', resume)
            window.removeEventListener('online', resume)
            window.removeEventListener('offline', resume)
        },
    }
}
