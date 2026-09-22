import { QueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/shared/api/session'
import { ApiError } from '@/shared/api/ApiError'
import { privateKeys } from '@/shared/query/keys'
import { SessionStore } from './SessionStore'
import type { User } from '@/shared/api/users'
import { waitFor } from '@testing-library/react'
import { sessionEventKey } from './SessionStore'

vi.mock('@/shared/api/session', () => ({
    fetchMe: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    resetPassword: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
}))
const account = (id: string): User => ({
    publicId: id,
    username: id,
    email: null,
    nickname: null,
    pronouns: null,
    signature: null,
    avatarUrl: null,
})
function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((a, b) => {
        resolve = a
        reject = b
    })
    return { promise, resolve, reject }
}
let server: User | null
beforeEach(() => {
    vi.resetAllMocks()
    server = account('A')
    vi.mocked(api.fetchMe).mockImplementation(async () => server)
    vi.mocked(api.login).mockImplementation(async (input) => {
        server = account(input.username)
        return server
    })
    vi.mocked(api.logout).mockImplementation(async () => {
        server = null
    })
})
it('revalidates storage notifications once and never trusts a broadcast identity', async () => {
    const client = new QueryClient(),
        store = new SessionStore(client),
        stop = store.connect()
    try {
        await waitFor(() => expect(store.getSnapshot().user?.publicId).toBe('A'))
        const scope = store.getSnapshot().scope!
        client.setQueryData(privateKeys.created(scope, 'en'), ['private A'])
        server = account('B')
        const payload = JSON.stringify({
            type: 'session',
            source: 'other-tab',
            id: 'change-1',
            publicId: 'untrusted-C',
        })
        window.dispatchEvent(
            new StorageEvent('storage', { key: sessionEventKey, newValue: payload }),
        )
        await waitFor(() => expect(store.getSnapshot().user?.publicId).toBe('B'))
        expect(client.getQueryData(privateKeys.created(scope, 'en'))).toBeUndefined()
        const calls = vi.mocked(api.fetchMe).mock.calls.length
        window.dispatchEvent(
            new StorageEvent('storage', { key: sessionEventKey, newValue: payload }),
        )
        await Promise.resolve()
        expect(api.fetchMe).toHaveBeenCalledTimes(calls)
        await store.logout()
        const event = JSON.parse(localStorage.getItem(sessionEventKey)!) as Record<string, unknown>
        expect(Object.keys(event).sort()).toEqual(['id', 'source', 'type'])
    } finally {
        stop()
    }
})
it('clears only the old private scope on logout and refuses late private results', async () => {
    const client = new QueryClient(),
        store = new SessionStore(client)
    await store.refresh()
    const scope = store.getSnapshot().scope!
    client.setQueryData(privateKeys.favorites(scope), [1])
    client.setQueryData(['public', 'keep'], [2])
    const response = deferred<number>()
    const started = deferred<void>()
    let signal!: AbortSignal
    const old = store.runPrivate(scope, async (s) => {
        signal = s
        started.resolve()
        return response.promise
    })
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    store.externalChange()
    expect(signal.aborted).toBe(true)
    response.resolve(42)
    await rejected
    await store.logout()
    expect(store.getSnapshot().user).toBeNull()
    expect(client.getQueryData(privateKeys.favorites(scope))).toBeUndefined()
    expect(client.getQueryData(['public', 'keep'])).toEqual([2])
})
it('does not send an A mutation using a Cookie that now belongs to B', async () => {
    const store = new SessionStore(new QueryClient())
    await store.refresh()
    const scope = store.getSnapshot().scope!,
        write = vi.fn()
    server = account('B')
    await expect(store.runPrivate(scope, write)).rejects.toMatchObject({ name: 'AbortError' })
    expect(write).not.toHaveBeenCalled()
    expect(store.getSnapshot().user?.publicId).toBe('B')
})
it('keeps the current server session when logout fails, without claiming success', async () => {
    const store = new SessionStore(new QueryClient())
    await store.refresh()
    vi.mocked(api.logout).mockRejectedValue(new ApiError(503, 'Unavailable'))
    await expect(store.logout()).rejects.toMatchObject({ status: 503 })
    expect(store.getSnapshot().user?.publicId).toBe('A')
    expect(store.getSnapshot().busy).toBe(false)
})
it('rechecks /me when a successful password change clears the Cookie', async () => {
    const store = new SessionStore(new QueryClient())
    await store.refresh()
    vi.mocked(api.changePassword).mockImplementation(async () => {
        server = null
    })
    await store.changePassword({ oldPassword: 'synthetic-old', newPassword: 'synthetic-new' })
    expect(store.getSnapshot().status).toBe('anonymous')
})
it('does not retry a registration whose account was already created', async () => {
    const store = new SessionStore(new QueryClient())
    server = null
    await store.refresh()
    vi.mocked(api.register).mockRejectedValue(new ApiError(503, '账号已创建，请稍后登录'))
    await expect(
        store.register({
            username: 'synthetic',
            email: 'synthetic@example.invalid',
            verificationCode: '123456',
            password: 'synthetic-only',
        }),
    ).rejects.toMatchObject({ message: '账号已创建，请稍后登录' })
    expect(api.register).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().status).toBe('anonymous')
})
it('rejects overlapping Cookie transitions rather than letting Set-Cookie race', async () => {
    const store = new SessionStore(new QueryClient()),
        response = deferred<User | null>()
    vi.mocked(api.login).mockReturnValue(response.promise)
    const login = store.login({ username: 'synthetic', password: 'synthetic-only' })
    await expect(store.logout()).rejects.toThrow('Please wait')
    response.resolve(server)
    await login
    expect(api.logout).not.toHaveBeenCalled()
})
it('a private 403 and a network failure do not log out the account', async () => {
    const store = new SessionStore(new QueryClient())
    await store.refresh()
    const scope = store.getSnapshot().scope!
    for (const status of [403, 503]) {
        await expect(
            store.runPrivate(scope, async () => {
                throw new ApiError(status, 'Unavailable')
            }),
        ).rejects.toMatchObject({ status })
        expect(store.isCurrent(scope)).toBe(true)
    }
})
it('current protected 401 invalidates its scope', async () => {
    const store = new SessionStore(new QueryClient())
    await store.refresh()
    const scope = store.getSnapshot().scope!
    await expect(
        store.runPrivate(scope, async () => {
            throw new ApiError(401, 'Expired')
        }),
    ).rejects.toMatchObject({ status: 401 })
    expect(store.isCurrent(scope)).toBe(false)
    expect(store.getSnapshot().status).toBe('anonymous')
})

it('a queued logout from A cannot delete the newer B Cookie session', async () => {
    const first = new SessionStore(new QueryClient()),
        second = new SessionStore(new QueryClient())
    await first.refresh()
    await second.refresh()
    const finish = deferred<User | null>(),
        entered = deferred<void>()
    vi.mocked(api.login).mockImplementation(async () => {
        entered.resolve()
        const user = await finish.promise
        server = user
        return user
    })
    const login = first.login({ username: 'B', password: 'synthetic-only' })
    await entered.promise
    const logout = second.logout()
    const rejected = expect(logout).rejects.toMatchObject({ name: 'AbortError' })
    second.externalChange()
    finish.resolve(account('B'))
    await login
    await rejected
    expect(api.logout).not.toHaveBeenCalled()
    expect(server?.publicId).toBe('B')
})
it('does not submit an old password form after the preflight scope changes', async () => {
    const store = new SessionStore(new QueryClient())
    await store.refresh()
    const response = deferred<User | null>(),
        entered = deferred<void>()
    vi.mocked(api.fetchMe).mockImplementationOnce(async () => {
        entered.resolve()
        return response.promise
    })
    const changing = store.changePassword({
        oldPassword: 'synthetic-old',
        newPassword: 'synthetic-new',
    })
    const rejected = expect(changing).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    store.externalChange()
    response.resolve(server)
    await rejected
    expect(api.changePassword).not.toHaveBeenCalled()
})
it('aborts a blocking private request as soon as logout is requested', async () => {
    const store = new SessionStore(new QueryClient())
    await store.refresh()
    const scope = store.getSnapshot().scope!,
        entered = deferred<void>()
    let signal!: AbortSignal
    const read = store.runPrivate(
        scope,
        (s) =>
            new Promise<void>((_, reject) => {
                signal = s
                entered.resolve()
                s.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
            }),
    )
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    const logout = store.logout()
    expect(signal.aborted).toBe(true)
    await rejected
    await logout
    expect(store.getSnapshot().user).toBeNull()
})

it('keeps an acknowledged recovery successful when later session reads are unavailable', async () => {
    const client = new QueryClient(),
        store = new SessionStore(client)
    await store.refresh()
    const scope = store.getSnapshot().scope!
    client.setQueryData(privateKeys.favorites(scope), [1])
    vi.mocked(api.fetchMe).mockRejectedValue(new Error('offline'))
    vi.mocked(api.resetPassword).mockResolvedValue(undefined)
    await store.resetPassword({
        email: 'test@example.test',
        verificationCode: '123456',
        newPassword: 'new-password',
    })
    expect(api.resetPassword).toHaveBeenCalledOnce()
    expect(store.getSnapshot().status).toBe('anonymous')
    expect(store.getSnapshot().busy).toBe(false)
    expect(client.getQueryData(privateKeys.favorites(scope))).toBeUndefined()
})
