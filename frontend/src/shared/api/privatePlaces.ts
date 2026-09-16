import { request } from './transport'
import { markerIdListSchema, markerListSchema, markerSchema } from './markers'
import { parseMarkerId } from './markerReads'
import type { Language } from '@/shared/query/keys'

export async function readFavorites(signal: AbortSignal) {
    return markerIdListSchema.parse(
        await request('/api/markers/me/favorites', { signal, cache: 'no-store' }),
    )
}
export async function readFavoriteDetails(language: Language, signal: AbortSignal) {
    return markerListSchema.parse(
        await request('/api/markers/me/favorites/details', {
            query: { lang: language },
            signal,
            cache: 'no-store',
        }),
    )
}
export async function readCreatedPlaces(language: Language, signal: AbortSignal) {
    return markerListSchema.parse(
        await request('/api/markers/me/created', {
            query: { lang: language },
            signal,
            cache: 'no-store',
        }),
    )
}
export async function readAccountPlace(id: string, language: Language, signal: AbortSignal) {
    if (!parseMarkerId(id)) throw new Error('Invalid marker ID')
    return markerSchema.parse(
        await request(`/api/markers/${id}`, {
            query: { lang: language },
            signal,
            cache: 'no-store',
        }),
    )
}
export async function setFavorite(id: number, saved: boolean, signal: AbortSignal) {
    if (!parseMarkerId(String(id))) throw new Error('Invalid marker ID')
    await request(`/api/markers/${id}/favorite`, { method: saved ? 'POST' : 'DELETE', signal })
}
