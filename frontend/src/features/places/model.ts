import type { Marker } from '@/shared/api/markers'
import type { Language, MarkerCategory } from '@/shared/query/keys'
import { assertLatLng, type LatLng } from '@/features/map/coords'

export const categoryBadges = {
    accessible_toilet: 'toilet',
    baby_room: 'nursing',
    friendly_clinic: 'medical',
    self_definition: null,
} as const
export const categoryLabels: Record<MarkerCategory, string> = {
    accessible_toilet: 'Accessible Toilets',
    baby_room: 'Nursing Rooms',
    friendly_clinic: 'Medical Institutions',
    self_definition: 'Places',
}

/** Geodesic distance, never a route length or an inferred user position. */
export function distanceMeters(a: LatLng, b: LatLng): number {
    assertLatLng(a)
    assertLatLng(b)
    const rad = Math.PI / 180
    const sinLat = Math.sin(((b.lat - a.lat) * rad) / 2)
    const sinLng = Math.sin(((b.lng - a.lng) * rad) / 2)
    const h = sinLat ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * sinLng ** 2
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}
export function distanceLabel(place: LatLng, position: LatLng | null): string | null {
    if (!position) return null
    const meters = distanceMeters(position, place)
    return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`
}
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export function openingHours(
    place: Pick<Marker, 'openTimeStart' | 'openTimeEnd'>,
    language: Language,
): string {
    const { openTimeStart: start, openTimeEnd: end } = place
    if (!start || !end || !timePattern.test(start) || !timePattern.test(end))
        return language === 'zh' ? '开放时间未提供' : 'Hours not provided'
    if (start === end) return language === 'zh' ? '全天开放' : 'Open 24 hours'
    return `${start}–${end}`
}
export function publicImageUrl(value: string | null): string | null {
    if (!value || !/^\/uploads\/markers\/[A-Za-z0-9_.-]+$/.test(value)) return null
    if (value.split('/').some((part) => part === '.' || part === '..')) return null
    return value
}
export function placeShareUrl(origin: string, id: number, language: Language): string {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid marker ID')
    const url = new URL('/maps', origin)
    url.searchParams.set('markerId', String(id))
    url.searchParams.set('lang', language)
    return url.href
}
/** The destination is a public place; never include the user's origin location. */
export function navigationUrl(place: LatLng): string {
    assertLatLng(place)
    const url = new URL('https://www.google.com/maps/dir/')
    url.searchParams.set('api', '1')
    url.searchParams.set('travelmode', 'walking')
    url.searchParams.set('destination', `${place.lat},${place.lng}`)
    return url.href
}

export type NavigationApp = 'apple' | 'google' | 'baidu'
export const navigationApps = ['apple', 'google', 'baidu'] as const

/**
 * Destination-only walking links for each navigation app. Latitude precedes
 * longitude in every URL. No function includes the user's precise origin, and
 * Baidu is told explicitly that the coordinates are WGS84. Apple Maps is the
 * first offered option; Google is only ever a deliberate user choice.
 */
export function appleMapsUrl(place: LatLng): string {
    assertLatLng(place)
    const url = new URL('https://maps.apple.com/')
    url.searchParams.set('daddr', `${place.lat},${place.lng}`)
    url.searchParams.set('dirflg', 'w')
    return url.href
}

export function googleMapsUrl(place: LatLng): string {
    return navigationUrl(place)
}

export function baiduMapsUrl(place: LatLng & { title: string }): string {
    assertLatLng(place)
    const url = new URL('https://api.map.baidu.com/direction')
    url.searchParams.set('origin', '我的位置')
    url.searchParams.set('destination', `latlng:${place.lat},${place.lng}|name:${place.title}`)
    url.searchParams.set('mode', 'walking')
    url.searchParams.set('coord_type', 'wgs84')
    url.searchParams.set('output', 'html')
    url.searchParams.set('src', 'webapp.lycoris.maps')
    return url.href
}

export function navigationAppUrl(app: NavigationApp, place: LatLng & { title: string }): string {
    if (app === 'apple') return appleMapsUrl(place)
    if (app === 'baidu') return baiduMapsUrl(place)
    return googleMapsUrl(place)
}
