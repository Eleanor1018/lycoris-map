import { describe, expect, it } from 'vitest'
import {
    CONTROL_MARKER_ID,
    createSyntheticMarkers,
    findMarker,
    resolveTitle,
    SHANGHAI_CENTER,
    SYNTHETIC_MARKER_COUNT,
} from './syntheticMarkers'

describe('synthetic markers', () => {
    it('produces the fixed 200-point sample reproducibly', () => {
        const first = createSyntheticMarkers()
        const second = createSyntheticMarkers()
        expect(first).toHaveLength(SYNTHETIC_MARKER_COUNT)
        expect(first).toEqual(second)
    })

    it('assigns fixed sequential ids and versions', () => {
        const markers = createSyntheticMarkers()
        expect(markers[0]?.id).toBe(1)
        expect(markers.at(-1)?.id).toBe(SYNTHETIC_MARKER_COUNT)
        expect(markers.every((marker) => marker.version === 1)).toBe(true)
    })

    it('lays points out near the Shanghai centre within valid ranges', () => {
        const markers = createSyntheticMarkers()
        for (const marker of markers) {
            expect(Math.abs(marker.lat - SHANGHAI_CENTER.lat)).toBeLessThan(0.03)
            expect(Math.abs(marker.lng - SHANGHAI_CENTER.lng)).toBeLessThan(0.03)
            expect(marker.lat).toBeGreaterThanOrEqual(-90)
            expect(marker.lat).toBeLessThanOrEqual(90)
            expect(marker.lng).toBeGreaterThanOrEqual(-180)
            expect(marker.lng).toBeLessThanOrEqual(180)
        }
    })

    it('provides zh and en titles and never claims to be real data', () => {
        const marker = createSyntheticMarkers()[0]!
        expect(resolveTitle(marker, 'zh')).toBe('合成点位 1')
        expect(resolveTitle(marker, 'en')).toBe('Synthetic point 1')
        expect(resolveTitle(marker, 'zh')).not.toBe(resolveTitle(marker, 'en'))
    })

    it('keeps the control marker id stable and findable', () => {
        const markers = createSyntheticMarkers()
        expect(findMarker(markers, CONTROL_MARKER_ID)?.id).toBe(CONTROL_MARKER_ID)
        expect(findMarker(markers, 9999)).toBeUndefined()
    })
})
