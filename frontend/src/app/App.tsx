import { lazy, Suspense } from 'react'
import { BrowserRouter, useLocation } from 'react-router'
import { MapPage } from './MapPage'
import { AppProviders } from './providers'
const DevelopmentPage = import.meta.env.DEV ? lazy(() => import('./devRoutes')) : null
export function App() {
    return (
        <BrowserRouter>
            <Application />
        </BrowserRouter>
    )
}
function Application() {
    const location = useLocation()
    const lang = new URLSearchParams(location.search).get('lang')
    const isDevelopmentPath = /^\/__(dev|design)\//.test(location.pathname)
    return (
        <AppProviders languageOverride={lang === 'en' || lang === 'zh' ? lang : undefined}>
            {DevelopmentPage && isDevelopmentPath ? (
                <Suspense fallback={null}>
                    <DevelopmentPage />
                </Suspense>
            ) : (
                <MapPage />
            )}
        </AppProviders>
    )
}
