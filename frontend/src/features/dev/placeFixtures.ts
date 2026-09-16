import type { Marker } from '@/shared/api/markers'

/** Synthetic DTOs for local tests and the DEV-only performance page. */
export function syntheticPlace(overrides: Partial<Marker> = {}): Marker {
    return {
        id: 1,
        version: 1,
        lat: 31.2304,
        lng: 121.4737,
        category: 'accessible_toilet',
        title: 'Synthetic place 1',
        description: 'Synthetic description.',
        sourceLanguage: 'en',
        contentLanguage: 'en',
        isPublic: true,
        username: 'synthetic',
        userPublicId: null,
        clientRequestId: null,
        isActive: true,
        openTimeStart: '08:00',
        openTimeEnd: '22:00',
        reviewStatus: 'APPROVED',
        lastEditedBy: null,
        lastEditedByPublicId: null,
        lastEditedByOwner: false,
        markImage: null,
        createdAt: '2026-09-15T00:00:00Z',
        updatedAt: '2026-09-15T00:00:00Z',
        ...overrides,
    }
}
export function syntheticPlaces(count: number): Marker[] {
    const side = Math.ceil(Math.sqrt(count))
    return Array.from({ length: count }, (_, index) =>
        syntheticPlace({
            id: index + 1,
            title: `Synthetic place ${index + 1}`,
            lat: 31.2304 + (Math.floor(index / side) - side / 2) * 0.002,
            lng: 121.4737 + ((index % side) - side / 2) * 0.002,
        }),
    )
}
