/**
 * S1 synthetic marker fixture for the dev map spike.
 *
 * IMPORTANT: these are NOT real facilities, users or historical data. They are
 * a fixed, reproducible 200-point grid around Shanghai (31.2304, 121.4737) used
 * only to exercise marker lifecycle in development. Titles are sample zh/en
 * strings, and `id`/`version` are fixed so a re-render can be compared.
 *
 * S2 replaces this with real `/api/markers/viewport` data.
 */

import type { Language } from '@/shared/i18n'

export const SHANGHAI_CENTER = { lat: 31.2304, lng: 121.4737 } as const

export const SYNTHETIC_MARKER_COUNT = 200

/** Synthetic marker with only the display fields the spike needs. */
export type SyntheticMarker = {
    id: number
    version: number
    lat: number
    lng: number
    title: { zh: string; en: string }
    isActive: boolean
}

const GRID_SIDE = 20
/** ~220 m per step at this latitude; keeps all points near the centre. */
const STEP_DEGREES = 0.002
const BASE_VERSION = 1

/**
 * Deterministic grid: no randomness, no time input, so two runs produce the
 * same ids, coordinates, versions and titles.
 */
export function createSyntheticMarkers(count: number = SYNTHETIC_MARKER_COUNT): SyntheticMarker[] {
    const markers: SyntheticMarker[] = []
    for (let index = 0; index < count; index += 1) {
        const row = Math.floor(index / GRID_SIDE)
        const column = index % GRID_SIDE
        // Centre the grid on the Shanghai reference point.
        const offsetRow = row - (GRID_SIDE - 1) / 2
        const offsetColumn = column - (GRID_SIDE - 1) / 2
        markers.push({
            id: index + 1,
            version: BASE_VERSION,
            lat: SHANGHAI_CENTER.lat + offsetRow * STEP_DEGREES,
            lng: SHANGHAI_CENTER.lng + offsetColumn * STEP_DEGREES,
            title: {
                zh: `合成点位 ${index + 1}`,
                en: `Synthetic point ${index + 1}`,
            },
            isActive: index % 2 === 0,
        })
    }
    return markers
}

export function resolveTitle(marker: SyntheticMarker, language: Language): string {
    return marker.title[language]
}

/** The marker shown in the control panel; kept stable across lifecycle toggles. */
export const CONTROL_MARKER_ID = 1

export function findMarker(
    markers: readonly SyntheticMarker[],
    id: number,
): SyntheticMarker | undefined {
    return markers.find((marker) => marker.id === id)
}
