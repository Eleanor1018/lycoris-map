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

/** Per-place overrides roll back independently; no whole-list snapshots. */
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
    toggle = async (place: Marker, saved: boolean, language: Language, scope: PrivateScope) => {
        if (
            !this.session.isCurrent(scope) ||
            this.snapshot.pending.some((p) => p.id === place.id && this.session.isCurrent(p.scope))
        )
            return
        const pending: Pending = { id: place.id, saved, place, language, scope, token: Symbol() }
        this.publish({ pending: [...this.snapshot.pending, pending], error: null })
        try {
            await this.session.runPrivate(scope, (signal) => setFavorite(place.id, saved, signal))
            if (!this.session.isCurrent(scope)) return
            this.client.setQueryData<number[]>(privateKeys.favorites(scope), (old) =>
                old
                    ? saved
                        ? [...new Set([...old, place.id])]
                        : old.filter((id) => id !== place.id)
                    : old,
            )
            this.client.setQueryData<Marker[]>(
                privateKeys.favoriteDetails(scope, language),
                (old) =>
                    old
                        ? saved
                            ? [...old.filter((p) => p.id !== place.id), place]
                            : old.filter((p) => p.id !== place.id)
                        : old,
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
            // Release the button and roll back immediately even if a follow-up
            // read is offline. Successful writes already updated the cache.
            this.publish({
                pending: this.snapshot.pending.filter((p) => p.token !== pending.token),
            })
            if (
                this.session.isCurrent(scope) &&
                this.snapshot.pending.filter((p) => this.session.isCurrent(p.scope)).length === 0
            )
                void this.client.invalidateQueries({ queryKey: privateKeys.favorites(scope) })
        }
    }
}
