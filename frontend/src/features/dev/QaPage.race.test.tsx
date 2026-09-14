import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api'
import { privateKeys, publicKeys } from '@/shared/query'
import { LanguageProvider } from '@/shared/i18n'
import { QaPage } from './QaPage'

/**
 * Session-race regression for the QA diagnostics page.
 *
 * Only the transport is mocked (`@/shared/api`); the session/authEpoch logic,
 * the real `QueryClient` cache and the React component all run for real, so the
 * assertions are about ownership of results, not about a re-implemented mock.
 */

const api = vi.hoisted(() => ({
    fetchMe: vi.fn(),
    fetchMyAvatar: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    uploadMyAvatar: vi.fn(),
}))

vi.mock('@/shared/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/shared/api')>()
    return { ...actual, ...api }
})

function user(publicId: string) {
    return {
        publicId,
        username: publicId,
        nickname: null,
        email: null,
        avatarUrl: null,
        pronouns: null,
        signature: null,
    }
}

function renderQa() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
        <StrictMode>
            <QueryClientProvider client={client}>
                <LanguageProvider navigatorLanguage="zh-CN">
                    <QaPage />
                </LanguageProvider>
            </QueryClientProvider>
        </StrictMode>,
    )
    return { client, ...view }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
})

describe('QaPage session races', () => {
    it('drops a late startup /me that resolves after a fresh login', async () => {
        const startupMe = deferred<ReturnType<typeof user> | null>()
        // The first /me (startup) hangs; the login resolves first.
        api.fetchMe.mockReturnValueOnce(startupMe.promise)
        api.login.mockResolvedValue(user('aaaa-1111'))

        renderQa()
        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'synthetic-user')
        await userEvent.type(screen.getByLabelText(/密码/), 'synthetic-pass')
        await userEvent.click(screen.getByRole('button', { name: '登录' }))

        await waitFor(() => {
            expect(screen.getByTestId('qa-session').textContent).toContain('aaaa-1111')
        })

        // The stale startup /me now resolves with a different account.
        startupMe.resolve(user('bbbb-2222'))
        await new Promise((resolve) => setTimeout(resolve, 0))

        // It must not overwrite the newer login round.
        expect(screen.getByTestId('qa-session').textContent).toContain('aaaa-1111')
        expect(screen.getByTestId('qa-session').textContent).not.toContain('bbbb-2222')
    })

    it('clears the A avatar and private cache when switching to B', async () => {
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:a-avatar'),
            revokeObjectURL: vi.fn(),
        })
        api.fetchMe.mockResolvedValue(user('aaaa-1111'))
        api.login.mockResolvedValueOnce(user('aaaa-1111')).mockResolvedValueOnce(user('bbbb-2222'))
        api.fetchMyAvatar.mockResolvedValue(new Blob(['a'], { type: 'image/png' }))

        const { client } = renderQa()

        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-a')
        await userEvent.type(screen.getByLabelText(/密码/), 'pass-a')
        await userEvent.click(screen.getByRole('button', { name: '登录' }))
        await waitFor(() =>
            expect(screen.getByTestId('qa-session').textContent).toContain('aaaa-1111'),
        )

        // Use the epoch the page actually holds, not a guessed constant.
        const epochA = Number(screen.getByTestId('qa-epoch').textContent)
        const scopeA = { publicId: 'aaaa-1111', authEpoch: epochA }

        // Populate a real private cache entry for A, plus a public one.
        client.setQueryData(privateKeys.me(scopeA), user('aaaa-1111'))
        client.setQueryData(publicKeys.search('zh', { query: 'park' }), [{ id: 1 }])

        await userEvent.click(screen.getByRole('button', { name: '读取头像 Blob' }))
        await waitFor(() => expect(screen.getByTestId('qa-avatar-preview')).toBeInTheDocument())

        // Switch to B.
        await userEvent.clear(screen.getByLabelText(/用户名或邮箱/))
        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-b')
        await userEvent.type(screen.getByLabelText(/密码/), 'pass-b')
        await userEvent.click(screen.getByRole('button', { name: '登录' }))

        await waitFor(() =>
            expect(screen.getByTestId('qa-session').textContent).toContain('bbbb-2222'),
        )
        // A's avatar is gone; A's private scope is removed; public data survives.
        expect(screen.queryByTestId('qa-avatar-preview')).not.toBeInTheDocument()
        expect(client.getQueryData(privateKeys.me(scopeA))).toBeUndefined()
        expect(client.getQueryData(publicKeys.search('zh', { query: 'park' }))).toEqual([{ id: 1 }])
        expect(epochA).toBeGreaterThan(0)
    })

    it('clears the avatar and private cache on a current 401', async () => {
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:avatar'),
            revokeObjectURL: vi.fn(),
        })
        api.fetchMe
            .mockResolvedValueOnce(user('aaaa-1111'))
            .mockRejectedValueOnce(new ApiError(401, 'Spring Security Error'))
        api.login.mockResolvedValue(user('aaaa-1111'))
        api.fetchMyAvatar.mockResolvedValue(new Blob(['a'], { type: 'image/png' }))

        const { client } = renderQa()

        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-a')
        await userEvent.type(screen.getByLabelText(/密码/), 'pass-a')
        await userEvent.click(screen.getByRole('button', { name: '登录' }))
        await waitFor(() =>
            expect(screen.getByTestId('qa-session').textContent).toContain('aaaa-1111'),
        )

        const epochA = Number(screen.getByTestId('qa-epoch').textContent)
        const scopeA = { publicId: 'aaaa-1111', authEpoch: epochA }
        client.setQueryData(privateKeys.me(scopeA), user('aaaa-1111'))
        await userEvent.click(screen.getByRole('button', { name: '读取头像 Blob' }))
        await waitFor(() => expect(screen.getByTestId('qa-avatar-preview')).toBeInTheDocument())

        await userEvent.click(screen.getByRole('button', { name: '检查 /api/me' }))

        await waitFor(() => {
            expect(screen.getByTestId('qa-session').textContent).toContain('未登录')
        })
        expect(screen.queryByTestId('qa-avatar-preview')).not.toBeInTheDocument()
        expect(client.getQueryData(privateKeys.me(scopeA))).toBeUndefined()
    })

    it('does not add a login epoch when /me confirms the same user', async () => {
        api.fetchMe.mockResolvedValue(user('aaaa-1111'))
        api.login.mockResolvedValue(user('aaaa-1111'))

        renderQa()
        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-a')
        await userEvent.type(screen.getByLabelText(/密码/), 'pass-a')
        await userEvent.click(screen.getByRole('button', { name: '登录' }))
        await waitFor(() =>
            expect(screen.getByTestId('qa-session').textContent).toContain('aaaa-1111'),
        )

        const epochAfterLogin = screen.getByTestId('qa-epoch').textContent
        await userEvent.click(screen.getByRole('button', { name: '检查 /api/me' }))
        await waitFor(() =>
            expect(screen.getByTestId('qa-result').textContent).toContain('aaaa-1111'),
        )

        expect(screen.getByTestId('qa-epoch').textContent).toBe(epochAfterLogin)
    })

    it('disables the file input while a session operation is in flight', async () => {
        const pending = deferred<ReturnType<typeof user> | null>()
        api.login.mockReturnValueOnce(pending.promise)

        renderQa()
        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-a')
        await userEvent.type(screen.getByLabelText(/密码/), 'pass-a')
        await userEvent.click(screen.getByRole('button', { name: '登录' }))

        expect(screen.getByLabelText(/上传合成头像/)).toBeDisabled()

        pending.resolve(user('aaaa-1111'))
        await waitFor(() => expect(screen.getByLabelText(/上传合成头像/)).not.toBeDisabled())
    })

    it('clears the password field immediately after submit', async () => {
        api.login.mockResolvedValue(user('aaaa-1111'))

        renderQa()
        const passwordInput = screen.getByLabelText(/密码/)
        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-a')
        await userEvent.type(passwordInput, 'synthetic-pass')
        expect(passwordInput).toHaveValue('synthetic-pass')

        await userEvent.click(screen.getByRole('button', { name: '登录' }))
        expect(passwordInput).toHaveValue('')
    })

    /**
     * Startup-race regression: the same account logs in twice, creating epoch 1
     * then epoch 2. The old scope and its avatar must be released even though
     * the publicId did not change.
     */
    it('releases the previous scope and avatar when the same account logs in again', async () => {
        const revoke = vi.fn()
        const create = vi
            .fn()
            .mockReturnValueOnce('blob:avatar-epoch-1')
            .mockReturnValueOnce('blob:avatar-epoch-2')
        vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })

        api.login.mockResolvedValue(user('aaaa-1111'))
        api.fetchMyAvatar.mockResolvedValue(new Blob(['a'], { type: 'image/png' }))
        api.logout.mockResolvedValue(undefined)

        const { client } = renderQa()

        const signIn = async () => {
            await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-a')
            await userEvent.type(screen.getByLabelText(/密码/), 'pass-a')
            await userEvent.click(screen.getByRole('button', { name: '登录' }))
            await waitFor(() =>
                expect(screen.getByTestId('qa-session').textContent).toContain('aaaa-1111'),
            )
        }

        await signIn()
        const epochOne = Number(screen.getByTestId('qa-epoch').textContent)
        const scopeOne = { publicId: 'aaaa-1111', authEpoch: epochOne }

        // Real private entry for epoch 1, plus a public entry that must survive.
        client.setQueryData(privateKeys.me(scopeOne), user('aaaa-1111'))
        client.setQueryData(publicKeys.search('zh', { query: 'park' }), [{ id: 1 }])

        await userEvent.click(screen.getByRole('button', { name: '读取头像 Blob' }))
        await waitFor(() => expect(screen.getByTestId('qa-avatar-preview')).toBeInTheDocument())

        await signIn()
        const epochTwo = Number(screen.getByTestId('qa-epoch').textContent)
        expect(epochTwo).toBeGreaterThan(epochOne)

        // Epoch 1's private scope and avatar are gone; public data survives.
        expect(client.getQueryData(privateKeys.me(scopeOne))).toBeUndefined()
        expect(screen.queryByTestId('qa-avatar-preview')).not.toBeInTheDocument()
        expect(revoke).toHaveBeenCalledWith('blob:avatar-epoch-1')
        expect(client.getQueryData(publicKeys.search('zh', { query: 'park' }))).toEqual([{ id: 1 }])

        // Logout still clears the current (epoch 2) round.
        client.setQueryData(
            privateKeys.me({ publicId: 'aaaa-1111', authEpoch: epochTwo }),
            user('aaaa-1111'),
        )
        await userEvent.click(screen.getByRole('button', { name: '退出登录' }))
        await waitFor(() =>
            expect(screen.getByTestId('qa-session').textContent).toContain('未登录'),
        )

        expect(
            client.getQueryData(privateKeys.me({ publicId: 'aaaa-1111', authEpoch: epochTwo })),
        ).toBeUndefined()
        expect(client.getQueryData(publicKeys.search('zh', { query: 'park' }))).toEqual([{ id: 1 }])
    })

    /**
     * Unmount while an avatar request is still in flight: the late response must
     * not create an object URL, and any already-created URL must be revoked.
     */
    it('does not create a late avatar URL after unmount and revokes the existing one', async () => {
        const revoke = vi.fn()
        const create = vi.fn(() => 'blob:avatar')
        vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })

        api.login.mockResolvedValue(user('aaaa-1111'))

        const view = renderQa()
        await userEvent.type(screen.getByLabelText(/用户名或邮箱/), 'user-a')
        await userEvent.type(screen.getByLabelText(/密码/), 'pass-a')
        await userEvent.click(screen.getByRole('button', { name: '登录' }))
        await waitFor(() =>
            expect(screen.getByTestId('qa-session').textContent).toContain('aaaa-1111'),
        )

        // First avatar resolves normally and creates a URL.
        api.fetchMyAvatar.mockResolvedValueOnce(new Blob(['first'], { type: 'image/png' }))
        await userEvent.click(screen.getByRole('button', { name: '读取头像 Blob' }))
        await waitFor(() => expect(screen.getByTestId('qa-avatar-preview')).toBeInTheDocument())
        const createdBefore = create.mock.calls.length

        // Second avatar hangs; unmount while it is pending.
        const pendingAvatar = deferred<Blob>()
        api.fetchMyAvatar.mockReturnValueOnce(pendingAvatar.promise)
        await userEvent.click(screen.getByRole('button', { name: '读取头像 Blob' }))

        view.unmount()
        cleanup()

        // Unmount revokes the URL that already existed.
        expect(revoke).toHaveBeenCalledWith('blob:avatar')

        pendingAvatar.resolve(new Blob(['late'], { type: 'image/png' }))
        await new Promise((resolve) => setTimeout(resolve, 0))

        // The late response created no new URL.
        expect(create.mock.calls.length).toBe(createdBefore)
    })
})
