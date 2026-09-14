import { BackendStatusPanel } from '@/features/map/BackendStatusPanel'
import { DevRoutePage, resolveDevRoute } from './devRoutes'
import { AppProviders } from './providers'

/**
 * S1 entry: the welcome/status screen plus two development-only pages.
 *
 * `/__dev/map-spike` (map lifecycle) and `/__dev/qa` (browser diagnostics) are
 * S1 tools replaced by the S2 router and S4 account flows. The default route
 * stays the status screen, and this build is an S1 artefact that is not
 * deployable.
 */
export function App() {
    const devRoute = resolveDevRoute(window.location.pathname)
    return (
        <AppProviders>
            {devRoute ? <DevRoutePage route={devRoute} /> : <BackendStatusPanel />}
        </AppProviders>
    )
}
