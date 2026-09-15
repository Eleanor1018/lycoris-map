import { lazy, Suspense } from 'react'
import { BrowserRouter } from 'react-router'
import { MapPage } from './MapPage'
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
                    <MapPage />
                )}
            </BrowserRouter>
        </AppProviders>
    )
}
