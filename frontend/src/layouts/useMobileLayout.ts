import { useSyncExternalStore } from 'react'
import { useViewportSnapshot } from './viewport'
const query = '(max-width: 767px)'
function subscribe(callback: () => void) {
    const media = window.matchMedia?.(query)
    media?.addEventListener('change', callback)
    return () => media?.removeEventListener('change', callback)
}
export function useMobileLayout() {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia?.(query).matches ?? window.innerWidth < 768,
        () => false,
    )
}

/**
 * Visible layout height from the shared viewport snapshot. Kept for callers
 * that only need the number; the full snapshot carries the keyboard pan too.
 */
export function useViewportHeight() {
    return useViewportSnapshot().height
}
