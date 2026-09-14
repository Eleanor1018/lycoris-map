/**
 * Lightweight S1 pathname entry for development-only pages.
 *
 * A real router arrives in S2 (`app/` owns routing then). Until then this
 * switches on `window.location.pathname` only, so the production build still
 * bundles the map code (proving TS7 + Vite compatibility) while the S1 default
 * status screen stays the entry.
 */

import { MapSpikePage } from '@/features/map/MapSpikePage'
import { QaPage } from '@/features/dev/QaPage'

export const DEV_MAP_SPIKE_PATH = '/__dev/map-spike'
export const DEV_QA_PATH = '/__dev/qa'

export type DevRoute = 'map-spike' | 'qa' | null

export function resolveDevRoute(pathname: string): DevRoute {
    if (pathname === DEV_MAP_SPIKE_PATH) return 'map-spike'
    if (pathname === DEV_QA_PATH) return 'qa'
    return null
}

export function DevRoutePage({ route }: { route: Exclude<DevRoute, null> }) {
    return route === 'map-spike' ? <MapSpikePage /> : <QaPage />
}
