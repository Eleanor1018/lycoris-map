import type { QueryClient } from '@tanstack/react-query'
import type { Marker } from '@/shared/api/markers'
import { setFavorite } from '@/shared/api/privatePlaces'
import { privateKeys, type Language, type PrivateScope } from '@/shared/query/keys'
import type { SessionStore } from '@/features/auth/SessionStore'
type Pending = {
    id: number
    saved: boolean
    place: Marker
    language: Language
    scope: PrivateScope
    token: symbol
}
type Snapshot = {
    pending: readonly Pending[]
    error: { scope: PrivateScope; message: string } | null
}

/**
 * Per-place overrides roll back independently; no whole-list snapshots.
 *
 * A successful write applies this write's intent to the ids cache (`old ?? []`)
 * purely as immediate feedback. It is immediately invalidated with
 * `refetchType: 'all'` so a partial cache can never be treated as a fresh,
 * complete list for `staleTime`, and observed queries re-read the server. When
 * no read has produced data yet, the pending entry below stays the honest
 * source of truth instead of a fabricated list or detail array.
 */
export class BookmarkStore {
    private snapshot: Snapshot = { pending: [], error: null }
    private readonly listeners = new Set<() => void>()
    constructor(
        private readonly client: QueryClient,
        private readonly session: SessionStore,
    ) {}
    subscribe = (fn: () => void) => {
        this.listeners.add(fn)
        return () => {
            this.listeners.delete(fn)
        }
    }
    getSnapshot = () => this.snapshot
    private publish(next: Partial<Snapshot>) {
        this.snapshot = { ...this.snapshot, ...next }
        this.listeners.forEach((fn) => fn())
    }
    clearStale = () => {
        this.publish({
            pending: this.snapshot.pending.filter((p) => this.session.isCurrent(p.scope)),
            error:
                this.snapshot.error && this.session.isCurrent(this.snapshot.error.scope)
                    ? this.snapshot.error
                    : null,
        })
    }
    /** Cancel in-flight favorites reads (ids + all detail languages). */
    private cancelReads(scope: PrivateScope) {
        void this.client.cancelQueries({ queryKey: privateKeys.favorites(scope) })
    }
    /**
     * Remove one place from every cached favorite-detail list, whatever its
     * language. Scoped to the `favorites/details` key only: the account scope
     * also holds `me`, single `detail` objects and `created`, which are NOT
     * `Marker[]` and must never be touched by a Marker filter.
     */
    private removeFromDetails(scope: PrivateScope, id: number) {
        this.client.setQueriesData<Marker[]>(
            { queryKey: [...privateKeys.favorites(scope), 'details'] },
            (data) => data?.filter((marker) => marker.id !== id),
        )
    }
    toggle = async (place: Marker, saved: boolean, language: Language, scope: PrivateScope) => {
        if (
            !this.session.isCurrent(scope) ||
            this.snapshot.pending.some((p) => p.id === place.id && this.session.isCurrent(p.scope))
        )
            return
        // Stop any in-flight read so a late response cannot land after the write.
        this.cancelReads(scope)
        const pending: Pending = { id: place.id, saved, place, language, scope, token: Symbol() }
        this.publish({ pending: [...this.snapshot.pending, pending], error: null })
        try {
            await this.session.runPrivate(scope, (signal) => setFavorite(place.id, saved, signal))
            if (!this.session.isCurrent(scope)) return
            // A focus/refetch may have started an old read while the write was
            // in flight; cancel again before publishing the confirmed intent.
            this.cancelReads(scope)
            this.client.setQueryData<number[]>(privateKeys.favorites(scope), (old) => {
                const current = old ?? []
                return saved
                    ? [...new Set([...current, place.id])]
                    : current.filter((id) => id !== place.id)
            })
            // Details are only ever corrected in place: unsaving removes the
            // place from every language's list, saving only adds it to the
            // language the DTO is actually written in.
            if (!saved) this.removeFromDetails(scope, place.id)
            else
                this.client.setQueryData<Marker[]>(
                    privateKeys.favoriteDetails(scope, language),
                    (old) => (old ? [...old.filter((p) => p.id !== place.id), place] : old),
                )
        } catch (error) {
            if (
                this.session.isCurrent(scope) &&
                !(error instanceof DOMException && error.name === 'AbortError')
            )
                this.publish({
                    error: { scope, message: 'Could not update this bookmark. Please try again.' },
                })
        } finally {
            // Release the button immediately even if a follow-up read is
            // offline. Invalidate the ids as authoritative, including
            // unobserved queries, so no partial cache is considered fresh.
            // Refetching while another write for this account is still pending
            // could clobber it with a pre-write server read, so wait.
            this.publish({
                pending: this.snapshot.pending.filter((p) => p.token !== pending.token),
            })
            if (
                this.session.isCurrent(scope) &&
                this.snapshot.pending.filter((p) => this.session.isCurrent(p.scope)).length === 0
            )
                void this.client.invalidateQueries({
                    queryKey: privateKeys.favorites(scope),
                    refetchType: 'all',
                })
        }
    }
}
