import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router'
const DesignPage = lazy(() => import('@/features/dev/DesignPage'))
const MapSpikePage = lazy(() =>
    import('@/features/map/MapSpikePage').then(({ MapSpikePage }) => ({ default: MapSpikePage })),
)
const QaPage = lazy(() =>
    import('@/features/dev/QaPage').then(({ QaPage }) => ({ default: QaPage })),
)
const StatusPage = lazy(() =>
    import('@/features/map/BackendStatusPanel').then(({ BackendStatusPanel }) => ({
        default: BackendStatusPanel,
    })),
)
export default function DevelopmentPage() {
    const { pathname } = useLocation()
    return (
        <Suspense fallback={null}>
            {pathname.startsWith('/__design/') ? (
                <DesignPage />
            ) : pathname === '/__dev/map-spike' ? (
                <MapSpikePage />
            ) : pathname === '/__dev/qa' ? (
                <QaPage />
            ) : (
                <StatusPage />
            )}
        </Suspense>
    )
}
