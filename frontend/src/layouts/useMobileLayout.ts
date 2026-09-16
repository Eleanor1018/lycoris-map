import { useSyncExternalStore } from 'react'
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

function subscribeHeight(callback: () => void) {
    window.addEventListener('resize', callback)
    return () => window.removeEventListener('resize', callback)
}
export function useViewportHeight() {
    return useSyncExternalStore(
        subscribeHeight,
        () => window.innerHeight,
        () => 812,
    )
}
