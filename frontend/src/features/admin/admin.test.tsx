import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { SessionProvider, useSession } from '@/features/auth/SessionProvider'
import { AccountFlowProvider } from '@/features/auth/AccountFlow'
import { LanguageProvider } from '@/shared/i18n'
import * as sessionApi from '@/shared/api/session'
import { ApiError } from '@/shared/api/ApiError'
import type { User } from '@/shared/api/users'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import * as api from './api'
import AdminPage from './AdminPage'
import { deniedAccess } from './useAdminAccess'
const user: User = {
    publicId: 'A',
    username: 'synthetic-admin',
    email: null,
    nickname: null,
    avatarUrl: null,
    pronouns: null,
    signature: null,
}
let owner: User | null
let client: QueryClient
beforeEach(() => {
    owner = user
    vi.spyOn(sessionApi, 'fetchMe').mockImplementation(async () => owner)
    vi.spyOn(api, 'readUsers').mockResolvedValue({
        page: 0,
        size: 10,
        totalPages: 0,
        totalElements: 0,
        items: [],
    })
    vi.spyOn(api, 'readMarkers').mockResolvedValue([
        syntheticPlace({ title: 'Review synthetic', reviewStatus: 'PENDING' }),
    ])
    vi.spyOn(api, 'readEdits').mockResolvedValue([])
    vi.spyOn(api, 'readImages').mockResolvedValue([])
    vi.spyOn(api, 'verify').mockResolvedValue(undefined)
    vi.spyOn(api, 'moderate').mockResolvedValue(undefined)
})
afterEach(() => {
    cleanup()
    client?.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})
function Observer() {
    const session = useSession()
    return (
        <>
            <output data-testid="identity">
                {session.status}:{session.user?.publicId}
            </output>
            <button onClick={() => session.store?.externalChange()}>Recheck identity</button>
        </>
    )
}
function mount(path = '/admin') {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
        <MemoryRouter initialEntries={[path]}>
            <QueryClientProvider client={client}>
                <LanguageProvider initialPreference="en">
                    <SessionProvider>
                        <AccountFlowProvider>
                            <AdminPage />
                            <Observer />
                        </AccountFlowProvider>
                    </SessionProvider>
                </LanguageProvider>
            </QueryClientProvider>
        </MemoryRouter>,
    )
}
it('keeps anonymous visitors outside protected endpoints', async () => {
    owner = null
    mount()
    await screen.findByRole('heading', { name: 'Login' })
    expect(api.readUsers).not.toHaveBeenCalled()
    expect(api.readMarkers).not.toHaveBeenCalled()
})
it('distinguishes ordinary users and unknown 403s without logging either out', async () => {
    vi.mocked(api.readUsers).mockRejectedValue(
        new ApiError(403, 'HTTP 403', { accessDenied: true }),
    )
    mount()
    await screen.findByText('Access denied.')
    expect(screen.getByTestId('identity')).toHaveTextContent('authenticated:A')
    expect(api.readMarkers).not.toHaveBeenCalled()
    vi.mocked(api.readUsers).mockRejectedValue(new ApiError(403, 'Unrecognized response'))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Could not confirm access. Try again.')
    expect(screen.getByTestId('identity')).toHaveTextContent('authenticated:A')
})
it('verifies an admin without trimming the passcode and only then loads queues', async () => {
    vi.mocked(api.readUsers).mockRejectedValue(new ApiError(403, '需要二级密码'))
    mount()
    await screen.findByRole('heading', { name: 'Secondary verification' })
    expect(api.readMarkers).not.toHaveBeenCalled()
    vi.mocked(api.readUsers).mockResolvedValue({
        page: 0,
        size: 1,
        totalPages: 0,
        totalElements: 0,
        items: [],
    })
    fireEvent.change(screen.getByLabelText('Admin passcode'), {
        target: { value: ' synthetic passcode ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await screen.findByRole('heading', { name: 'Review synthetic' })
    expect(api.verify).toHaveBeenCalledWith(' synthetic passcode ', expect.any(AbortSignal))
})
it('clears queues when secondary authorization expires, retaining the ordinary session', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Review synthetic' })
    vi.mocked(api.readMarkers).mockRejectedValue(new ApiError(403, '二级密码已过期，请重新验证'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('heading', { name: 'Secondary verification' })
    expect(screen.queryByText('Review synthetic')).not.toBeInTheDocument()
    expect(screen.getByTestId('identity')).toHaveTextContent('authenticated:A')
    expect(client.getQueriesData({ predicate: (q) => q.queryKey.includes('markers') })).toEqual([])
})
it('refreshes after approval and never automatically replays an uncertain write', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Review synthetic' })
    vi.mocked(api.moderate).mockRejectedValue(ApiError.network('lost response'))
    vi.mocked(api.readMarkers).mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(api.moderate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText(
        'The outcome could not be confirmed. Refresh and inspect the item before trying again.',
    )
    await screen.findByText('No items.')
    expect(api.moderate).toHaveBeenCalledTimes(1)
})
it('does not render a delayed private queue after an account switch', async () => {
    let finish!: (value: ReturnType<typeof syntheticPlace>[]) => void
    vi.mocked(api.readMarkers).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve
            }),
    )
    mount()
    await waitFor(() => expect(api.readMarkers).toHaveBeenCalled())
    owner = { ...user, publicId: 'B' }
    vi.mocked(api.readUsers).mockRejectedValue(
        new ApiError(403, 'HTTP 403', { accessDenied: true }),
    )
    fireEvent.click(screen.getByText('Recheck identity'))
    await act(async () => finish([syntheticPlace({ title: 'Old secret queue' })]))
    await screen.findByText('Access denied.')
    expect(screen.queryByText('Old secret queue')).not.toBeInTheDocument()
    expect(client.getQueriesData({ queryKey: ['private', 'A'] })).toEqual([])
})
it('renders at most one page of a large moderation queue', async () => {
    vi.mocked(api.readMarkers).mockResolvedValue(
        Array.from({ length: 400 }, (_, i) =>
            syntheticPlace({ id: i + 1, title: `Review item ${i}` }),
        ),
    )
    const { container } = mount()
    await screen.findByText('Review item 0')
    expect(container.querySelectorAll('.admin-card')).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Review item 20')
    expect(container.querySelectorAll('.admin-card')).toHaveLength(20)
})
it('does not classify service failure as an ordinary account', () => {
    expect(deniedAccess(new ApiError(503, 'unavailable'))).toBeNull()
    expect(deniedAccess(new ApiError(403, 'unrecognized'))).toBe('unavailable')
})

it('preserves the actual content language when editing fallback text', async () => {
    vi.mocked(api.readMarkers).mockResolvedValue([
        syntheticPlace({ title: '原文', contentLanguage: 'zh' }),
    ])
    const save = vi.spyOn(api, 'editMarker').mockResolvedValue(syntheticPlace())
    mount('/admin/all')
    await screen.findByRole('heading', { name: '原文' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Opening Time'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ title: '原文', language: 'zh', openTimeStart: '10:00' }),
            expect.any(AbortSignal),
        ),
    )
})
it('cancels confirmation with Escape and restores its trigger focus', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Review synthetic' })
    const approve = screen.getByRole('button', { name: 'Approve' })
    act(() => approve.focus())
    fireEvent.click(approve)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(approve).toHaveFocus())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.moderate).not.toHaveBeenCalled()
})
