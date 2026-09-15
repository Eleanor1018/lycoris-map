import { QueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/shared/api/session'
import { ApiError } from '@/shared/api/ApiError'
import { privateKeys } from '@/shared/query/keys'
import { SessionStore } from './SessionStore'
import type { User } from '@/shared/api/users'

vi.mock('@/shared/api/session', () => ({
    fetchMe: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
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
