import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
    beginSession,
    currentEpoch,
    endSession,
    initialSessionState,
    isAuthenticated,
    isCurrentEpoch,
    shouldApplySessionResult,
    shouldClearSessionForUnauthorized,
    type SessionState,
} from './authEpoch'
import { privateKeys, privateKeysFor, publicKeys, type PrivateScope } from '@/shared/query/keys'

function scopeOf(state: SessionState): PrivateScope {
    if (state.publicId === null) throw new Error('anonymous state has no private scope')
    return { publicId: state.publicId, authEpoch: currentEpoch(state) }
}

describe('authEpoch', () => {
    it('gives the anonymous state its own unique number, never null', () => {
        expect(initialSessionState.publicId).toBeNull()
        expect(currentEpoch(initialSessionState)).toBe(0)
        expect(isAuthenticated(initialSessionState)).toBe(false)
    })

    it('increments the epoch for every login round', () => {
        const first = beginSession(initialSessionState, 'user-a')
        const second = beginSession(first, 'user-b')
        expect(currentEpoch(first)).toBe(1)
        expect(currentEpoch(second)).toBe(2)
        expect(isAuthenticated(second)).toBe(true)
    })

    it('increments the epoch on logout', () => {
        const loggedIn = beginSession(initialSessionState, 'user-a')
        const loggedOut = endSession(loggedIn)
        expect(currentEpoch(loggedOut)).toBe(2)
        expect(isAuthenticated(loggedOut)).toBe(false)
    })

    it('rejects a stale 401 from a previous epoch', () => {
        const sessionA = beginSession(initialSessionState, 'user-a')
        const sessionB = beginSession(endSession(sessionA), 'user-b')
        const epochA = currentEpoch(sessionA)
        expect(isCurrentEpoch(sessionB, epochA)).toBe(false)
        expect(shouldClearSessionForUnauthorized(sessionB, epochA)).toBe(false)
        expect(sessionB.publicId).toBe('user-b')
    })

    it('accepts a 401 for the current epoch only while authenticated', () => {
        const session = beginSession(initialSessionState, 'user-a')
        expect(shouldClearSessionForUnauthorized(session, currentEpoch(session))).toBe(true)

        const loggedOut = endSession(session)
        expect(shouldClearSessionForUnauthorized(loggedOut, currentEpoch(loggedOut))).toBe(false)
    })

    it('does not let a 401 from an anonymous round clear a fresh session', () => {
        const epochWhileAnonymous = currentEpoch(initialSessionState)
        const session = beginSession(initialSessionState, 'user-a')
        expect(shouldClearSessionForUnauthorized(session, epochWhileAnonymous)).toBe(false)
    })

    /**
     * Full startup race: an old `/api/me` issued while anonymous resolves only
     * after login → logout. It must not restore the logged-out identity.
     */
    it('discards a late /me success from before login and logout', () => {
        const anonymous: SessionState = initialSessionState
        const requestEpoch = currentEpoch(anonymous)

        const loggedIn = beginSession(anonymous, 'user-a')
        const loggedOut = endSession(loggedIn)

        expect(isCurrentEpoch(loggedOut, requestEpoch)).toBe(false)
        expect(shouldApplySessionResult(loggedOut, requestEpoch)).toBe(false)
        // Applying it would have resurrected a user who already logged out.
        expect(loggedOut.publicId).toBeNull()
    })

    it('applies a /me result only for the exact current epoch', () => {
        const anonymous = initialSessionState
        const startupEpoch = currentEpoch(anonymous)
        expect(shouldApplySessionResult(anonymous, startupEpoch)).toBe(true)

        const loggedIn = beginSession(anonymous, 'user-a')
        expect(shouldApplySessionResult(loggedIn, currentEpoch(loggedIn))).toBe(true)
        expect(shouldApplySessionResult(loggedIn, startupEpoch)).toBe(false)
    })

    it('isolates A->B identities and epochs', () => {
        const sessionA = beginSession(initialSessionState, 'uuid-a')
        const sessionB = beginSession(sessionA, 'uuid-b')
        expect(sessionA.publicId).not.toBe(sessionB.publicId)
        expect(currentEpoch(sessionA)).not.toBe(currentEpoch(sessionB))
    })
})

describe('query keys', () => {
    it('keeps public list keys free of authEpoch', () => {
        const key = publicKeys.nearby('zh', {
            lat: 31.2,
            lng: 121.4,
            radius: 1000,
            category: 'accessible_toilet',
        })
        expect(key[0]).toBe('public')
        expect(JSON.stringify(key)).not.toContain('epoch')
        expect(key).toEqual([
            'public',
            'markers',
            'nearby',
            'zh',
            { lat: 31.2, lng: 121.4, radius: 1000, category: 'accessible_toilet' },
        ])
    })

    it('includes the actual language and filters', () => {
        const zh = publicKeys.search('zh', { query: 'park' })
        const en = publicKeys.search('en', { query: 'park' })
        const other = publicKeys.search('zh', { query: 'pool' })
        expect(zh).not.toEqual(en)
        expect(zh).not.toEqual(other)
    })

    it('sorts categories so viewport keys are stable', () => {
        const base = { minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 } as const
        const a = publicKeys.viewport('zh', {
            ...base,
            categories: ['friendly_clinic', 'baby_room'],
        })
        const b = publicKeys.viewport('zh', {
            ...base,
            categories: ['baby_room', 'friendly_clinic'],
        })
        expect(a).toEqual(b)
    })

    it('has no generic public detail key that could cache owner-private data', () => {
        expect(publicKeys).not.toHaveProperty('detail')
    })

    it('namespaces the anonymous detail separately from the private detail', () => {
        const anonymous = publicKeys.anonymousDetail('zh', '42')
        const privateDetail = privateKeys.detail({ publicId: 'uuid-a', authEpoch: 1 }, 'zh', '42')
        expect(anonymous[0]).toBe('public')
        expect(anonymous).toContain('anonymous')
        expect(privateDetail[0]).toBe('private')
        expect(privateDetail).toContain('uuid-a')
        expect(privateDetail).toContain(1)
        expect(anonymous).not.toEqual(privateDetail)
    })

    it('puts publicId and authEpoch in every private key', () => {
        const scope = { publicId: 'uuid-a', authEpoch: 4 }
        const keys = [
            privateKeys.favorites(scope),
            privateKeys.favoriteDetails(scope, 'zh'),
            privateKeys.created(scope, 'zh'),
            privateKeys.me(scope),
            privateKeys.detail(scope, 'en', '7'),
        ]
        for (const key of keys) {
            expect(key[0]).toBe('private')
            expect(key).toContain('uuid-a')
            expect(key).toContain(4)
        }
    })

    it('carries language for every localized private DTO key', () => {
        const scope = { publicId: 'uuid-a', authEpoch: 1 }
        expect(privateKeys.favoriteDetails(scope, 'zh')).not.toEqual(
            privateKeys.favoriteDetails(scope, 'en'),
        )
        expect(privateKeys.created(scope, 'zh')).not.toEqual(privateKeys.created(scope, 'en'))
        expect(privateKeys.detail(scope, 'zh', '7')).not.toEqual(
            privateKeys.detail(scope, 'en', '7'),
        )
    })

    it('clears the whole account scope with a single prefix', () => {
        const scope = { publicId: 'uuid-a', authEpoch: 1 }
        const keys = privateKeysFor(scope)
        expect(keys).toHaveLength(1)
        expect(keys[0]).toEqual(['private', 'uuid-a', 1])
    })

    it('never returns a public prefix for private cleanup', () => {
        const keys = privateKeysFor({ publicId: 'uuid-a', authEpoch: 1 })
        expect(keys.every((key) => key[0] === 'private')).toBe(true)
    })

    it('separates private keys of two accounts', () => {
        const a = privateKeys.favorites({ publicId: 'uuid-a', authEpoch: 1 })
        const b = privateKeys.favorites({ publicId: 'uuid-b', authEpoch: 2 })
        expect(a).not.toEqual(b)
    })
})

describe('private detail survives only inside its scope', () => {
    /**
     * Uses a real TanStack QueryClient so the logout cleanup is verified against
     * the framework's own prefix matching, not a test-local reimplementation.
     */
    it('removes only the account scope on logout and keeps other users and public data', () => {
        const client = new QueryClient()

        const session = beginSession(initialSessionState, 'uuid-a')
        const scopeA = scopeOf(session)
        const scopeB = { publicId: 'uuid-b', authEpoch: 9 }

        const detailA = privateKeys.detail(scopeA, 'zh', '42')
        const favoritesA = privateKeys.favorites(scopeA)
        const createdA = privateKeys.created(scopeA, 'zh')
        const meA = privateKeys.me(scopeA)

        const detailB = privateKeys.detail(scopeB, 'zh', '42')
        const createdB = privateKeys.created(scopeB, 'en')

        const viewport = publicKeys.viewport('zh', {
            minLat: 1,
            maxLat: 2,
            minLng: 3,
            maxLng: 4,
            categories: ['baby_room'],
        })
        const anonymousDetail = publicKeys.anonymousDetail('zh', '7')

        client.setQueryData(detailA, { title: '私有详情 A' })
        client.setQueryData(favoritesA, [42])
        client.setQueryData(createdA, [{ id: 42 }])
        client.setQueryData(meA, { publicId: 'uuid-a' })
        client.setQueryData(detailB, { title: '私有详情 B' })
        client.setQueryData(createdB, [{ id: 43 }])
        client.setQueryData(viewport, [{ id: 1 }])
        client.setQueryData(anonymousDetail, { id: 7 })

        for (const key of privateKeysFor(scopeA)) {
            client.removeQueries({ queryKey: key })
        }

        expect(client.getQueryData(detailA)).toBeUndefined()
        expect(client.getQueryData(favoritesA)).toBeUndefined()
        expect(client.getQueryData(createdA)).toBeUndefined()
        expect(client.getQueryData(meA)).toBeUndefined()

        expect(client.getQueryData(detailB)).toEqual({ title: '私有详情 B' })
        expect(client.getQueryData(createdB)).toEqual([{ id: 43 }])
        expect(client.getQueryData(viewport)).toEqual([{ id: 1 }])
        expect(client.getQueryData(anonymousDetail)).toEqual({ id: 7 })

        client.clear()
        expect(client.getQueryData(detailB)).toBeUndefined()
        expect(client.getQueryData(viewport)).toBeUndefined()
    })

    it('does not leave the removed account key reachable through the cache', () => {
        const client = new QueryClient()
        const scope = { publicId: 'uuid-a', authEpoch: 1 }
        const detailKey = privateKeys.detail(scope, 'zh', '42')
        client.setQueryData(detailKey, { title: '私有详情' })

        const cachePrefixes = privateKeysFor(scope)
        const cachePrefix = cachePrefixes[0]
        if (!cachePrefix) throw new Error('expected an account scope prefix')
        client.removeQueries({ queryKey: cachePrefix })

        expect(client.getQueryCache().find({ queryKey: detailKey })).toBeUndefined()
    })

    it('keeps zh and en detail caches distinct', () => {
        const scope = { publicId: 'uuid-a', authEpoch: 1 }
        expect(privateKeys.detail(scope, 'zh', '42')).not.toEqual(
            privateKeys.detail(scope, 'en', '42'),
        )
        expect(publicKeys.anonymousDetail('zh', '42')).not.toEqual(
            publicKeys.anonymousDetail('en', '42'),
        )
    })
})
