/**
 * Query key conventions (pure module; no query client here).
 *
 * Public and private keys are kept in separate namespaces so that clearing
 * private data on logout can never drop public map data:
 * - `publicKeys.*` carries language + the actual filters (never authEpoch).
 * - `privateKeys.*` always carries the account `publicId` (UUID) AND the
 *   `authEpoch`, so two different logged-in accounts on the same browser cannot
 *   share a cache entry, and a stale response cannot land on a new session.
 *
 * `GET /api/markers/{id}` accepts an `OptionalUser`, so it may return an
 * owner's private/pending marker. There is therefore NO generic public detail
 * key: details are either explicitly anonymous (`anonymousDetail`) or scoped to
 * the current account (`privateDetail`), which also lives under the private
 * prefix so logout can clear it.
 *
 * Every key that caches a localized DTO carries `language`, including the
 * private `favoritesDetails` and `created` keys.
 */

export type Language = 'zh' | 'en'

/** Every category the backend whitelists in `localization::SUPPORTED_CATEGORIES`. */
export const MARKER_CATEGORIES = [
    'accessible_toilet',
    'friendly_clinic',
    'baby_room',
    'self_definition',
] as const

export type MarkerCategory = (typeof MARKER_CATEGORIES)[number]

export type ViewportFilters = {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
    categories: readonly MarkerCategory[]
}

export type NearbyFilters = {
    lat: number
    lng: number
    radius: number
    category: MarkerCategory
}

export type SearchFilters = {
    query: string
}

/** Private cache scope: `publicId` is a UUID and `authEpoch` isolates login rounds. */
export type PrivateScope = {
    publicId: string
    authEpoch: number
}

export const publicKeys = {
    all: ['public'] as const,
    markers: () => [...publicKeys.all, 'markers'] as const,
    viewport: (language: Language, filters: ViewportFilters) =>
        [...publicKeys.markers(), 'viewport', language, normalizeViewport(filters)] as const,
    nearby: (language: Language, filters: NearbyFilters) =>
        [...publicKeys.markers(), 'nearby', language, normalizeNearby(filters)] as const,
    search: (language: Language, filters: SearchFilters) =>
        [...publicKeys.markers(), 'search', language, filters.query] as const,
    /**
     * Detail fetched while anonymous. The backend can still answer 404 for a
     * non-public marker; it never returns owner-private data to anonymous
     * callers, so this key is safe in the public namespace.
     */
    anonymousDetail: (language: Language, id: string) =>
        [...publicKeys.markers(), 'detail', 'anonymous', language, id] as const,
}

export const privateKeys = {
    all: ['private'] as const,
    scope: (scope: PrivateScope) => [...privateKeys.all, scope.publicId, scope.authEpoch] as const,
    favorites: (scope: PrivateScope) => [...privateKeys.scope(scope), 'favorites'] as const,
    favoriteDetails: (scope: PrivateScope, language: Language) =>
        [...privateKeys.scope(scope), 'favorites', 'details', language] as const,
    created: (scope: PrivateScope, language: Language) =>
        [...privateKeys.scope(scope), 'created', language] as const,
    me: (scope: PrivateScope) => [...privateKeys.scope(scope), 'me'] as const,
    /**
     * Detail fetched while authenticated. Even when the marker happens to be
     * public, keeping it under the private prefix means logout clears the
     * account's detail cache instead of leaving a scoped entry behind.
     */
    detail: (scope: PrivateScope, language: Language, id: string) =>
        [...privateKeys.scope(scope), 'detail', language, id] as const,
}

/** Drop float noise so key equality is stable across viewport events. */
function round(value: number): number {
    return Math.round(value * 1e6) / 1e6
}

function normalizeViewport(filters: ViewportFilters): ViewportFilters {
    return {
        minLat: round(filters.minLat),
        maxLat: round(filters.maxLat),
        minLng: round(filters.minLng),
        maxLng: round(filters.maxLng),
        categories: [...filters.categories].sort(),
    }
}

function normalizeNearby(filters: NearbyFilters): NearbyFilters {
    return {
        lat: round(filters.lat),
        lng: round(filters.lng),
        radius: Math.round(filters.radius),
        category: filters.category,
    }
}

/**
 * Keys to remove on logout / account switch; public cache is intentionally kept.
 *
 * The whole account scope prefix is returned, which already covers every child
 * key (`favorites`, `favoriteDetails`, `created`, `me`, `detail`) without the
 * list having to be maintained per sub-key.
 */
export function privateKeysFor(scope: PrivateScope): readonly (readonly unknown[])[] {
    return [privateKeys.scope(scope)]
}

export const ALL_PRIVATE_PREFIX = privateKeys.all
