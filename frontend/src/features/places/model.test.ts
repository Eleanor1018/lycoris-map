import { expect, it } from 'vitest'
import {
    amapMapsUrl,
    appleMapsUrl,
    distanceLabel,
    distanceMeters,
    googleMapsUrl,
    navigationAppUrl,
    navigationApps,
    navigationUrl,
    openingHours,
    placeShareUrl,
    publicImageUrl,
    tencentMapsUrl,
} from './model'

it('shows hours without inventing current availability or a user position', () => {
    expect(openingHours({ openTimeStart: null, openTimeEnd: '22:00' }, 'en')).toBe(
        'Hours not provided',
    )
    expect(openingHours({ openTimeStart: '25:00', openTimeEnd: '22:00' }, 'zh')).toBe(
        '开放时间未提供',
    )
    expect(openingHours({ openTimeStart: '08:00', openTimeEnd: '08:00' }, 'en')).toBe(
        'Open 24 hours',
    )
    expect(openingHours({ openTimeStart: '22:00', openTimeEnd: '06:00' }, 'en')).toBe('22:00–06:00')
    expect(distanceLabel({ lat: 0, lng: 1 }, null)).toBeNull()
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111195.08, 1)
    expect(distanceLabel({ lat: 0, lng: 0.0001 }, { lat: 0, lng: 0 })).toBe('11m')
})
it('limits images to the public marker-upload route', () => {
    expect(publicImageUrl('/uploads/markers/abc-1.webp')).toBe('/uploads/markers/abc-1.webp')
    for (const path of [
        'https://example.com/a.jpg',
        '//example.com/a',
        '/uploads/../secret',
        '/uploads/markers/../secret',
        '/uploads/avatars/a.png',
        '/uploads/markers/a.png?token=secret',
    ])
        expect(publicImageUrl(path)).toBeNull()
})
it('shares an ID and language, and navigates to the destination without including a user origin', () => {
    expect(placeShareUrl('https://example.test/search?q=secret#local', 7, 'zh')).toBe(
        'https://example.test/maps?markerId=7&lang=zh',
    )
    const target = new URL(navigationUrl({ lat: 31.2, lng: 121.4 }))
    expect([...target.searchParams]).toEqual([
        ['api', '1'],
        ['travelmode', 'walking'],
        ['destination', '31.2,121.4'],
    ])
})

it('builds destination-only links for the four offered apps, without Baidu', () => {
    const place = { lat: 31.2, lng: 121.4, title: 'Blue Café & Restroom' }
    expect(navigationApps).toEqual(['apple', 'google', 'amap', 'tencent'])

    const apple = new URL(appleMapsUrl(place))
    expect(apple.origin).toBe('https://maps.apple.com')
    expect([...apple.searchParams]).toEqual([
        ['daddr', '31.2,121.4'],
        ['dirflg', 'w'],
    ])

    const google = new URL(googleMapsUrl(place))
    expect(google.origin).toBe('https://www.google.com')
    expect([...google.searchParams]).toEqual([
        ['api', '1'],
        ['travelmode', 'walking'],
        ['destination', '31.2,121.4'],
    ])

    // AMap point entry: longitude precedes latitude in `position`, the raw
    // WGS84 destination is declared as wgs84, and the title is URL-encoded.
    const amap = new URL(amapMapsUrl(place))
    expect(amap.origin).toBe('https://uri.amap.com')
    expect(amap.pathname).toBe('/marker')
    expect([...amap.searchParams]).toEqual([
        ['position', '121.4,31.2'],
        ['name', 'Blue Café & Restroom'],
        ['coordinate', 'wgs84'],
        ['src', 'lycoris-map'],
        ['callnative', '1'],
    ])

    // Tencent route plan: `tocoord` is latitude,longitude, `coord_type=1` is
    // GPS, and `to` carries the encoded title.
    const tencent = new URL(tencentMapsUrl(place))
    expect(tencent.origin).toBe('https://apis.map.qq.com')
    expect(tencent.pathname).toBe('/uri/v1/routeplan')
    expect([...tencent.searchParams]).toEqual([
        ['type', 'walk'],
        ['to', 'Blue Café & Restroom'],
        ['tocoord', '31.2,121.4'],
        ['coord_type', '1'],
        ['referer', 'Lycoris Maps'],
    ])

    // Every option is destination-only: no origin, no user coordinates, and
    // no Baidu anywhere.
    for (const url of [apple, google, amap, tencent]) {
        expect(url.searchParams.has('origin')).toBe(false)
        expect(url.searchParams.has('from')).toBe(false)
        expect(url.searchParams.has('fromcoord')).toBe(false)
        expect(url.href).not.toContain('baidu')
    }
    expect(navigationAppUrl('apple', place)).toBe(appleMapsUrl(place))
    expect(navigationAppUrl('google', place)).toBe(googleMapsUrl(place))
    expect(navigationAppUrl('amap', place)).toBe(amapMapsUrl(place))
    expect(navigationAppUrl('tencent', place)).toBe(tencentMapsUrl(place))
})

it('strictly encodes the title so & and commas cannot leak into another field', () => {
    const place = { lat: 31.2, lng: 121.4, title: 'A&B, Café' }
    const amap = new URL(amapMapsUrl(place))
    expect(amap.search).toContain('name=A%26B%2C+Caf%C3%A9')
    expect([...amap.searchParams]).toEqual([
        ['position', '121.4,31.2'],
        ['name', 'A&B, Café'],
        ['coordinate', 'wgs84'],
        ['src', 'lycoris-map'],
        ['callnative', '1'],
    ])
    const tencent = new URL(tencentMapsUrl(place))
    expect([...tencent.searchParams].find(([key]) => key === 'to')?.[1]).toBe('A&B, Café')
})

it('rejects invalid coordinates for every navigation app', () => {
    for (const build of [appleMapsUrl, googleMapsUrl, amapMapsUrl, tencentMapsUrl])
        for (const bad of [
            { lat: 91, lng: 0, title: 'x' },
            { lat: 0, lng: 181, title: 'x' },
            { lat: Number.NaN, lng: 0, title: 'x' },
        ])
            expect(() => build(bad)).toThrow()
})
