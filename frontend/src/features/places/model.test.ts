import { expect, it } from 'vitest'
import {
    distanceLabel,
    distanceMeters,
    navigationUrl,
    openingHours,
    placeShareUrl,
    publicImageUrl,
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
