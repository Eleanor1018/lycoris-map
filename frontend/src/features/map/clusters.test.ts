import { expect, it } from 'vitest'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import { clusterPlaces } from './clusters'

it.each([1, 2, 9])('keeps %i nearby places as individual pins at every zoom', (count) => {
    const points = Array.from({ length: count }, (_, i) => syntheticPlace({ id: i + 1 }))
    const index = clusterPlaces(points)
    for (let zoom = 0; zoom <= 19; zoom++) {
        const features = index.getClusters([-180, -90, 180, 90], zoom)
        expect(features).toHaveLength(count)
        expect(features.every((f) => !('cluster' in f.properties))).toBe(true)
    }
})
it('clusters ten close places, but does not merge a separate group of nine', () => {
    const points = Array.from({ length: 19 }, (_, i) =>
        syntheticPlace({
            id: i + 1,
            lng: i < 10 ? 121.47 : 122.47,
        }),
    )
    const features = clusterPlaces(points).getClusters([-180, -90, 180, 90], 12)
    const clusters = features.filter((f) => 'cluster' in f.properties)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.properties).toMatchObject({ point_count: 10 })
    expect(features).toHaveLength(10)
})
