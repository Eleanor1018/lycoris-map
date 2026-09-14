import { BackendStatusPanel } from '@/features/map/BackendStatusPanel'
import { AppProviders } from './providers'

/**
 * S1 entry: a welcome/status screen that proves the engineering foundation.
 *
 * It deliberately does NOT pretend to be the final Figma UI, and it never
 * renders a blank page when the local backend is down.
 */
export function App() {
    return (
        <AppProviders>
            <BackendStatusPanel />
        </AppProviders>
    )
}
