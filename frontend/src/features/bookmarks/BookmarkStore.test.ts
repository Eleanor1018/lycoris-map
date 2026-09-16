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
