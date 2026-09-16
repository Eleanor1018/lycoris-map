import { lazy, Suspense, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { MapShell } from '@/layouts/MapShell'
import { usePlaceBrowse } from '@/features/places/usePlaceBrowse'
import { useLanguage } from '@/shared/i18n'
import { isValidLatitude, isValidLongitude } from '@/features/map/coords'
import '@/features/places/places.css'
import { useSession } from '@/features/auth/SessionProvider'
import { useAccountFlow } from '@/features/auth/AccountFlow'
const AccountDialog = lazy(() =>
    import('@/features/auth/AccountDialog').then((module) => ({ default: module.AccountDialog })),
)

export function MapPage() {
    const route = useLocation()
    const session = useSession(),
        navigate = useNavigate()
    const accountFlow = useAccountFlow()
    const previousScope = useRef(session.scope)
    const params = new URLSearchParams(route.search)
    const { language: preferred } = useLanguage()
    const lang = params.get('lang')
    const language = lang === 'en' || lang === 'zh' ? lang : preferred
    const rawPanel = params.get('panel')
    const rawId = params.get('markerId')
    const legacyQuery = route.pathname === '/search' ? (params.get('q') ?? '') : ''
    const browse = usePlaceBrowse(
        language,
        rawPanel === 'details' ? (rawId ?? '') : !rawPanel ? rawId : null,
        legacyQuery,
    )
    useEffect(() => {
        const previous = previousScope.current
        previousScope.current = session.scope
        if (previous && previous.authEpoch !== session.epoch && rawId) {
            const next = new URLSearchParams(route.search)
            for (const field of ['markerId', 'lat', 'lng', 'title', 'panel']) next.delete(field)
            void navigate(
                { pathname: route.pathname, search: next.toString(), hash: route.hash },
                { replace: true, state: null },
            )
        }
    }, [session.epoch, session.scope, rawId, route, navigate])
    const { focusPoint, setSearch } = browse
    const lat = params.get('lat'),
        lng = params.get('lng')
    useEffect(() => {
        if (!rawId && lat && lng && isValidLatitude(Number(lat)) && isValidLongitude(Number(lng)))
            focusPoint({ lat: Number(lat), lng: Number(lng) })
    }, [rawId, lat, lng, focusPoint])
    useEffect(() => {
        if (route.pathname === '/search') setSearch(legacyQuery)
    }, [route.pathname, legacyQuery])
    const sharedTarget =
        !rawId &&
        lat?.trim() &&
        lng?.trim() &&
        isValidLatitude(Number(lat)) &&
        isValidLongitude(Number(lng))
            ? {
                  lat: Number(lat),
                  lng: Number(lng),
                  title: params.get('title')?.trim() || 'Shared location',
              }
            : undefined
    return (
        <>
            <MapShell browse={browse} sharedTarget={sharedTarget} />
            {accountFlow?.view && (
                <Suspense fallback={null}>
                    <AccountDialog
                        browse={browse}
                        onSelect={(place, focusId) => {
                            accountFlow?.close()
                            const next = new URLSearchParams(route.search)
                            next.set('panel', 'details')
                            next.set('markerId', String(place.id))
                            for (const field of ['lat', 'lng', 'title']) next.delete(field)
                            void navigate(
                                {
                                    pathname: route.pathname,
                                    search: next.toString(),
                                    hash: route.hash,
                                },
                                { state: { focusId } },
                            )
                            browse.focusPoint(place)
                        }}
                    />
                </Suspense>
            )}
        </>
    )
}
