import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi, afterEach } from 'vitest'
import { BookmarkStore } from './BookmarkStore'
import { SessionStore } from '@/features/auth/SessionStore'
import * as api from '@/shared/api/session'
import * as places from '@/shared/api/privatePlaces'
import { privateKeys } from '@/shared/query/keys'
import { syntheticPlace } from '@/features/dev/placeFixtures'

afterEach(() => vi.restoreAllMocks())
function deferred() {
    let resolve!: () => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<void>((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}
async function setup() {
    vi.spyOn(api, 'fetchMe').mockResolvedValue({
        publicId: 'A',
        username: 'Synthetic',
        nickname: null,
        email: null,
        avatarUrl: null,
        pronouns: null,
        signature: null,
    })
    const client = new QueryClient(),
        session = new SessionStore(client)
    await session.refresh()
    const scope = session.getSnapshot().scope!
    client.setQueryData(privateKeys.favorites(scope), [3])
    return { client, session, scope, store: new BookmarkStore(client, session) }
}
it('rolls back only the failed place while another bookmark succeeds', async () => {
    const { client, store, scope } = await setup(),
        first = deferred(),
        second = deferred()
    vi.spyOn(places, 'setFavorite').mockImplementation((id) =>
        id === 1 ? first.promise : second.promise,
    )
    const a = store.toggle(syntheticPlace({ id: 1 }), true, 'en', scope),
        b = store.toggle(syntheticPlace({ id: 2 }), true, 'en', scope)
    expect(store.getSnapshot().pending.map((p) => p.id)).toEqual([1, 2])
    first.reject(new Error('Offline'))
    await a
    expect(store.getSnapshot().pending.map((p) => p.id)).toEqual([2])
    second.resolve()
    await b
    expect(client.getQueryData(privateKeys.favorites(scope))).toEqual([3, 2])
    expect(store.getSnapshot().pending).toEqual([])
})
it('deduplicates repeated clicks on the same pending bookmark', async () => {
    const { store, scope } = await setup(),
        response = deferred()
    const write = vi.spyOn(places, 'setFavorite').mockReturnValue(response.promise)
    const a = store.toggle(syntheticPlace({ id: 1 }), true, 'en', scope)
    await store.toggle(syntheticPlace({ id: 1 }), true, 'en', scope)
    response.resolve()
    await a
    expect(write).toHaveBeenCalledTimes(1)
})
it('rolls back a failed write immediately even when the recovery read is offline', async () => {
    const { store, client, scope } = await setup(),
        read = deferred()
    vi.spyOn(places, 'setFavorite').mockRejectedValue(new Error('Offline'))
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(read.promise)
    await store.toggle(syntheticPlace({ id: 1 }), true, 'en', scope)
    expect(store.getSnapshot().pending).toEqual([])
    expect(store.getSnapshot().error).not.toBeNull()
    read.resolve()
})
it('a late result cannot write private caches after the account changes', async () => {
    const { store, scope, session, client } = await setup(),
        response = deferred(),
        entered = deferred()
    vi.spyOn(places, 'setFavorite').mockImplementation(async () => {
        entered.resolve()
        await response.promise
    })
    const a = store.toggle(syntheticPlace({ id: 1 }), true, 'en', scope)
    await entered.promise
    session.externalChange()
    store.clearStale()
    response.resolve()
    await a
    expect(client.getQueryData(privateKeys.favorites(scope))).toBeUndefined()
    expect(store.getSnapshot().pending).toEqual([])
    expect(store.getSnapshot().error).toBeNull()
})

it('applies the first save to an undefined ids cache and immediately invalidates it', async () => {
    const { store, client, scope } = await setup()
    client.removeQueries({ queryKey: privateKeys.favorites(scope) })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    vi.spyOn(places, 'setFavorite').mockResolvedValue(undefined)
    await store.toggle(syntheticPlace({ id: 7 }), true, 'en', scope)
    // Immediate feedback only; the whole scope is invalidated as authoritative
    // so the partial cache is never treated as a fresh complete list.
    expect(client.getQueryData(privateKeys.favorites(scope))).toEqual([7])
    expect(invalidate).toHaveBeenCalledWith({
        queryKey: privateKeys.favorites(scope),
        refetchType: 'all',
    })
    expect(store.getSnapshot().pending).toEqual([])
})

it('does not create a detail list for a language that has none, and adds only in the write language', async () => {
    const { store, client, scope } = await setup()
    vi.spyOn(places, 'setFavorite').mockResolvedValue(undefined)
    await store.toggle(syntheticPlace({ id: 7, title: '中文' }), true, 'zh', scope)
    expect(client.getQueryData(privateKeys.favoriteDetails(scope, 'zh'))).toBeUndefined()
    expect(client.getQueryData(privateKeys.favoriteDetails(scope, 'en'))).toBeUndefined()
    // An existing list for the write language is corrected in place.
    client.setQueryData(privateKeys.favoriteDetails(scope, 'zh'), [])
    await store.toggle(syntheticPlace({ id: 8, title: '中文' }), true, 'zh', scope)
    expect(
        (client.getQueryData<{ id: number }[]>(privateKeys.favoriteDetails(scope, 'zh')) ?? []).map(
            (p) => p.id,
        ),
    ).toEqual([8])
})

it('removes an unsaved place from every language detail cache', async () => {
    const { store, client, scope } = await setup()
    client.setQueryData(privateKeys.favoriteDetails(scope, 'en'), [syntheticPlace({ id: 7 })])
    client.setQueryData(privateKeys.favoriteDetails(scope, 'zh'), [syntheticPlace({ id: 7 })])
    vi.spyOn(places, 'setFavorite').mockResolvedValue(undefined)
    await store.toggle(syntheticPlace({ id: 7 }), false, 'en', scope)
    expect(client.getQueryData(privateKeys.favoriteDetails(scope, 'en'))).toEqual([])
    expect(client.getQueryData(privateKeys.favoriteDetails(scope, 'zh'))).toEqual([])
    expect(client.getQueryData(privateKeys.favorites(scope))).toEqual([3])
})

it('cancels reads at start and after success, and keeps the account isolated', async () => {
    const { store, client, scope, session } = await setup()
    const cancel = vi.spyOn(client, 'cancelQueries')
    vi.spyOn(places, 'setFavorite').mockResolvedValue(undefined)
    await store.toggle(syntheticPlace({ id: 7 }), true, 'en', scope)
    // Favorites-prefix cancellation covers ids + every detail language, twice
    // (start and post-success) so a focus-triggered old read cannot overwrite.
    const calls = cancel.mock.calls.filter(([arg]) => 'queryKey' in (arg as object))
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const [arg] of calls) expect(arg).toEqual({ queryKey: privateKeys.favorites(scope) })
    // Never the whole account scope: `me`, single details and `created` stay.
    for (const [arg] of calls) expect(arg).not.toEqual({ queryKey: privateKeys.scope(scope) })
    const other = { publicId: 'B', authEpoch: scope.authEpoch + 1 }
    expect(privateKeys.favorites(other)).not.toEqual(privateKeys.favorites(scope))
    session.externalChange()
    store.clearStale()
    expect(store.getSnapshot().pending).toEqual([])
})

it('does not filter or cancel non-favorites private caches when unsaving', async () => {
    const { store, client, scope } = await setup()
    // Every other account-scoped cache that shares the scope prefix.
    const me = { publicId: scope.publicId, username: 'A' }
    const created = [syntheticPlace({ id: 91 })]
    const detail = { ...syntheticPlace({ id: 92 }) }
    client.setQueryData(privateKeys.me(scope), me)
    client.setQueryData(privateKeys.created(scope, 'en'), created)
    client.setQueryData(privateKeys.detail(scope, 'en', '92'), detail)
    client.setQueryData(privateKeys.favorites(scope), [3, 7])
    client.setQueryData(privateKeys.favoriteDetails(scope, 'en'), [syntheticPlace({ id: 7 })])
    client.setQueryData(privateKeys.favoriteDetails(scope, 'zh'), [syntheticPlace({ id: 7 })])
    const cancel = vi.spyOn(client, 'cancelQueries')
    vi.spyOn(places, 'setFavorite').mockResolvedValue(undefined)
    await store.toggle(syntheticPlace({ id: 7 }), false, 'en', scope)
    expect(client.getQueryData(privateKeys.favorites(scope))).toEqual([3])
    expect(client.getQueryData(privateKeys.favoriteDetails(scope, 'en'))).toEqual([])
    expect(client.getQueryData(privateKeys.favoriteDetails(scope, 'zh'))).toEqual([])
    // Non-Marker account data is byte-for-byte untouched, and no cancel call
    // reaches outside the favorites prefix.
    expect(client.getQueryData(privateKeys.me(scope))).toEqual(me)
    expect(client.getQueryData(privateKeys.created(scope, 'en'))).toEqual(created)
    expect(client.getQueryData(privateKeys.detail(scope, 'en', '92'))).toEqual(detail)
    for (const [arg] of cancel.mock.calls)
        expect(arg).toEqual({ queryKey: privateKeys.favorites(scope) })
})

it('keeps concurrent writes to different ids from rolling each other back', async () => {
    const { store, client, scope } = await setup()
    const first = deferred(),
        second = deferred()
    vi.spyOn(places, 'setFavorite').mockImplementation((id) =>
        id === 1 ? first.promise : second.promise,
    )
    const a = store.toggle(syntheticPlace({ id: 1 }), true, 'en', scope)
    const b = store.toggle(syntheticPlace({ id: 2 }), true, 'en', scope)
    first.resolve()
    await a
    expect(client.getQueryData(privateKeys.favorites(scope))).toEqual([3, 1])
    second.resolve()
    await b
    expect(client.getQueryData(privateKeys.favorites(scope))).toEqual([3, 1, 2])
    expect(store.getSnapshot().pending).toEqual([])
})
