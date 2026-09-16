import { request } from './transport'
import { markerListSchema, markerSchema } from './markers'
import type { Language, NearbyFilters, ViewportFilters } from '@/shared/query/keys'

export function parseMarkerId(value: string | null): string | null {
    if (!value || !/^[1-9]\d*$/.test(value)) return null
    return Number.isSafeInteger(Number(value)) ? value : null
}

/** All S3 reads are public-only, including the OptionalUser detail endpoint. */
export async function readViewport(
    filters: ViewportFilters,
    language: Language,
    signal: AbortSignal,
) {
    return markerListSchema.parse(
        await request('/api/markers/viewport', {
            credentials: 'omit',
            signal,
            query: {
                ...filters,
                categories: filters.categories.join(',') || undefined,
                lang: language,
            },
        }),
    )
}
export async function readNearby(filters: NearbyFilters, language: Language, signal: AbortSignal) {
    return markerListSchema.parse(
        await request('/api/markers/nearby', {
            credentials: 'omit',
            signal,
            query: { ...filters, lang: language },
        }),
    )
}
export async function readSearch(query: string, language: Language, signal: AbortSignal) {
    if (!query.trim()) return []
    return markerListSchema.parse(
        await request('/api/markers/search', {
            credentials: 'omit',
            signal,
            query: { q: query.trim(), lang: language },
        }),
    )
}
export async function readPublicPlace(id: string, language: Language, signal: AbortSignal) {
    if (!parseMarkerId(id)) throw new Error('Invalid marker ID')
    return markerSchema.parse(
        await request(`/api/markers/${id}`, {
            credentials: 'omit',
            signal,
            query: { lang: language },
        }),
    )
}
