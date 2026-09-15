import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { MapShell } from '@/layouts/MapShell'
import { usePlaceBrowse } from '@/features/places/usePlaceBrowse'
import { useLanguage } from '@/shared/i18n'
import { isValidLatitude, isValidLongitude } from '@/features/map/coords'
import '@/features/places/places.css'

export function MapPage() {
    const route = useLocation()
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
    return <MapShell browse={browse} sharedTarget={sharedTarget} />
}
