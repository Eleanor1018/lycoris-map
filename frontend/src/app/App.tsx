import { lazy, Suspense } from 'react'
import { BrowserRouter } from 'react-router'
import { MapShell } from '@/layouts/MapShell'
import { AppProviders } from './providers'
const DevelopmentPage = import.meta.env.DEV ? lazy(() => import('./devRoutes')) : null
export function App() {
    const isDevelopmentPath = /^\/__(dev|design)\//.test(window.location.pathname)
    return (
        <AppProviders>
            <BrowserRouter>
                {DevelopmentPage && isDevelopmentPath ? (
                    <Suspense fallback={null}>
                        <DevelopmentPage />
                    </Suspense>
                ) : (
                    <MapShell />
                )}
            </BrowserRouter>
        </AppProviders>
    )
}
