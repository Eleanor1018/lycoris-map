import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Marker } from '@/shared/api/markers'
import { ApiError } from '@/shared/api/ApiError'
import {
    parseMarkerId,
    readNearby,
    readPublicPlace,
    readSearch,
    readViewport,
} from '@/shared/api/markerReads'
import { publicKeys, privateKeys, type Language, type MarkerCategory } from '@/shared/query/keys'
import { useSession } from '@/features/auth/SessionProvider'
import { readAccountPlace } from '@/shared/api/privatePlaces'
import type { LatLng } from '@/features/map/coords'
import type { MapFocus, MapView } from '@/features/map/viewport'
import { useLocationFix } from '@/features/map/useLocationFix'

function useDebounced<T>(value: T, delay: number): T {
    const [settled, setSettled] = useState(value)
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delay)
        return () => clearTimeout(timer)
    }, [value, delay])
    return settled
}
const retry = (count: number, error: Error) =>
    count < 1 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500)
const readOptions = {
    retry,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
}
export type PlaceReadState = {
    pending: boolean
    error: string | null
    retry: () => void
    retryable?: boolean
}

export type PlaceReads = Pick<
    typeof import('@/shared/api/markerReads'),
    'readViewport' | 'readNearby' | 'readSearch' | 'readPublicPlace'
>
const defaultReads: PlaceReads = { readViewport, readNearby, readSearch, readPublicPlace }

export function usePlaceBrowse(
    language: Language,
    rawMarkerId: string | null,
    initialSearch = '',
    reads: PlaceReads = defaultReads,
) {
    const client = useQueryClient()
    const session = useSession()
    const scope = reads === defaultReads ? session.scope : null
    const [view, setView] = useState<MapView | null>(null)
    const viewport = useDebounced(view, 250)
    const [search, setSearchState] = useState(initialSearch)
    const [nearby, setNearby] = useState<{
        point: LatLng
        category: MarkerCategory
        located: boolean
    } | null>(null)
    const [clusterIds, setClusterIds] = useState<readonly number[] | null>(null)
    const term = search.trim()
    const query = useDebounced(term, 300)
    const [focus, setFocus] = useState<MapFocus | null>(null)
    const focusSequence = useRef(0)
    const focusPoint = useCallback(
        (point: LatLng, zoom = 15) =>
            setFocus({ point, key: `focus-${++focusSequence.current}`, zoom }),
        [],
    )
    const onLocated = useCallback(
        (point: LatLng) => {
            focusPoint(point)
            setNearby((previous) => (previous ? { ...previous, point, located: true } : null))
        },
        [focusPoint],
    )
    const location = useLocationFix(onLocated)
    const listPositions = useRef(
        new Map<
            string,
            { offset: number; active: number; sizes?: Map<number, number>; width?: number }
        >(),
    )
    const onView = useCallback(
        (next: MapView) =>
            setView((previous) =>
                JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
            ),
        [],
    )
    const setSearch = (value: string) => {
        setSearchState(value)
        setNearby(null)
        setClusterIds(null)
    }
    const chooseCategory = (category: MarkerCategory) => {
        const point = location.position ?? view?.center
        if (!point) return
        setSearchState('')
        setClusterIds(null)
        setNearby({ point, category, located: location.position !== null })
    }
    const mapQuery = useQuery({
        ...readOptions,
        queryKey: [...publicKeys.markers(), 'viewport-set', language, viewport?.bounds ?? null],
        enabled: viewport !== null,
        queryFn: async ({ signal }) => {
            const batches = await Promise.all(
                viewport!.bounds.map((bounds) =>
                    reads.readViewport({ ...bounds, categories: [] }, language, signal),
                ),
            )
            return [...new Map(batches.flat().map((marker) => [marker.id, marker])).values()]
        },
    })
    const nearbyFilters = nearby
        ? {
              lat: Math.round(nearby.point.lat * 1e6) / 1e6,
              lng: Math.round(nearby.point.lng * 1e6) / 1e6,
              radius: 1000,
              category: nearby.category,
          }
        : null
    const nearbyQuery = useQuery({
        ...readOptions,
        queryKey: nearbyFilters
            ? publicKeys.nearby(language, nearbyFilters)
            : ['public', 'nearby-idle'],
        enabled: nearbyFilters !== null && !term,
        queryFn: ({ signal }) => reads.readNearby(nearbyFilters!, language, signal),
    })
    const searchQuery = useQuery({
        ...readOptions,
        queryKey: publicKeys.search(language, { query }),
        enabled: !!query && query === term,
        queryFn: ({ signal }) => reads.readSearch(query, language, signal),
    })
    const id = parseMarkerId(rawMarkerId)
    const detailQuery = useQuery({
        ...readOptions,
        queryKey: scope
            ? privateKeys.detail(scope, language, id ?? '')
            : publicKeys.anonymousDetail(language, id ?? ''),
        enabled:
            id !== null && (!session.store || (!session.busy && session.status !== 'checking')),
        queryFn: ({ signal }) =>
            scope && session.store
                ? session.store.runPrivate(scope, (s) => readAccountPlace(id!, language, s), signal)
                : reads.readPublicPlace(id!, language, signal),
    })
    const unavailable = detailQuery.error instanceof ApiError && detailQuery.error.status === 404
    useEffect(() => {
        if (!id || !unavailable) return
        const lists = {
            predicate: (query: { queryKey: readonly unknown[] }) =>
                query.queryKey[0] === 'public' &&
                query.queryKey[1] === 'markers' &&
                query.queryKey[2] !== 'detail',
        }
        // Cancel pre-404 responses, remove the stale item, then allow fresh public
        // reads to restore it if it becomes visible again.
        void client.cancelQueries(lists).then(() => {
            client.setQueriesData<Marker[]>(lists, (data) =>
                data?.filter((marker) => String(marker.id) !== id),
            )
            void client.invalidateQueries(lists)
        })
    }, [client, id, unavailable])
    const activeQuery = term ? searchQuery : nearby ? nearbyQuery : mapQuery
    const debouncing = !!term && term !== query
    const allResults: readonly Marker[] = useMemo(
        () =>
            debouncing
                ? []
                : (activeQuery.data ?? []).filter(
                      (marker) => !(unavailable && String(marker.id) === id),
                  ),
        [debouncing, activeQuery.data, unavailable, id],
    )
    const results = useMemo(() => {
        if (!clusterIds) return allResults
        const ids = new Set(clusterIds)
        return allResults.filter((marker) => ids.has(marker.id))
    }, [allResults, clusterIds])
    const mode = clusterIds ? 'cluster' : term ? 'search' : nearby ? 'nearby' : 'map'
    const errorText = (error: Error | null, detail = false) =>
        error
            ? detail && error instanceof ApiError && error.status === 404
                ? 'This place is unavailable.'
                : 'Could not load places. Try again.'
            : null
    const state: PlaceReadState = {
        pending: debouncing || activeQuery.isPending,
        error: debouncing ? null : errorText(activeQuery.error),
        retry: () => {
            void activeQuery.refetch()
        },
    }
    const detailState: PlaceReadState = {
        retryable: id !== null,
        pending: id !== null && detailQuery.isPending,
        error:
            rawMarkerId !== null && id === null
                ? 'This place link is invalid.'
                : errorText(detailQuery.error, true),
        retry: () => {
            if (id) void detailQuery.refetch()
        },
    }
    return {
        language,
        view,
        onView,
        search,
        setSearch,
        mode,
        nearby,
        chooseCategory,
        results,
        markers: results,
        state,
        detail: unavailable ? undefined : detailQuery.data,
        detailState,
        selectedId: id,
        focus,
        focusPoint,
        location,
        listPositions,
        clusterIds,
        showCluster: (ids: number[] | null) => {
            setClusterIds(ids)
        },
        clearResults: () => {
            setSearchState('')
            setNearby(null)
            setClusterIds(null)
        },
    }
}
export type PlaceBrowse = ReturnType<typeof usePlaceBrowse>
