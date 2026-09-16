import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers'
import { AccountDialog } from './AccountDialog'
import { AccountEntry } from './AccountEntry'
import { useSession } from './SessionProvider'
import { BookmarkButton } from '@/features/bookmarks/BookmarkButton'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import type { PlaceBrowse } from '@/features/places/usePlaceBrowse'
import type { User } from '@/shared/api/users'
import * as api from '@/shared/api/session'
import * as places from '@/shared/api/privatePlaces'
import { ApiError } from '@/shared/api/ApiError'

const account = (id: string): User => ({
    publicId: id,
    username: id,
    email: 'synthetic@example.test',
    nickname: null,
    avatarUrl: null,
    pronouns: null,
    signature: null,
})
let server: User | null
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
        resolve = r
    })
    return { promise, resolve }
}
beforeEach(() => {
    server = null
    vi.spyOn(api, 'fetchMe').mockImplementation(async () => server)
    vi.spyOn(api, 'login').mockImplementation(async () => (server = account('A')))
    vi.spyOn(api, 'register').mockImplementation(async () => (server = account('A')))
    vi.spyOn(places, 'readFavorites').mockResolvedValue([])
    vi.spyOn(places, 'setFavorite').mockResolvedValue(undefined)
    vi.spyOn(places, 'readCreatedPlaces').mockResolvedValue([
        syntheticPlace({
            isPublic: false,
            reviewStatus: 'PENDING',
            title: 'Synthetic private place',
        }),
    ])
})
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})
it('releases the avatar object URL when the confirmed account changes', async () => {
    const created = vi.fn(() => 'blob:synthetic-avatar'),
        revoked = vi.fn()
    class TestURL extends URL {
        static override createObjectURL = created
        static override revokeObjectURL = revoked
    }
    vi.stubGlobal('URL', TestURL)
    vi.spyOn(api, 'fetchMyAvatar').mockResolvedValue(new Blob(['synthetic'], { type: 'image/png' }))
    server = { ...account('A'), avatarUrl: '/uploads/synthetic-avatar.png' }
    setup()
    await waitFor(() => expect(created).toHaveBeenCalled())
    server = account('B')
    fireEvent.click(screen.getByText('Recheck session'))
    await waitFor(() => expect(revoked).toHaveBeenCalledWith('blob:synthetic-avatar'))
    expect(document.querySelector('.account-avatar-image')).not.toBeInTheDocument()
})
it('loads the account avatar after a Cookie login finishes', async () => {
    class TestURL extends URL {
        static override createObjectURL = vi.fn(() => 'blob:login-avatar')
        static override revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', TestURL)
    vi.mocked(api.login).mockImplementation(
        async () => (server = { ...account('A'), avatarUrl: '/uploads/synthetic-avatar.png' }),
    )
    vi.spyOn(api, 'fetchMyAvatar').mockResolvedValue(new Blob(['synthetic'], { type: 'image/png' }))
    setup()
    await openAccount()
    login()
    await waitFor(() =>
        expect(document.querySelector('.account-avatar-image')).toHaveAttribute(
            'src',
            'blob:login-avatar',
        ),
    )
    expect(api.fetchMyAvatar).toHaveBeenCalledTimes(1)
})
function Harness() {
    const session = useSession()
    return (
        <>
            <div data-testid="persistent-map" />
            <AccountEntry />
            <BookmarkButton place={syntheticPlace()} language="en" />
            <button onClick={() => void session.store?.refresh()}>Recheck session</button>
            <AccountDialog
                browse={{ language: 'en', location: { position: null } } as PlaceBrowse}
                onSelect={() => undefined}
            />
        </>
    )
}
function setup() {
    render(
        <StrictMode>
            <AppProviders>
                <Harness />
            </AppProviders>
        </StrictMode>,
    )
}
async function openAccount() {
    await waitFor(() =>
        expect(screen.getByRole('button', { name: server ? 'Account' : 'Login' })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: server ? 'Account' : 'Login' }))
}
function login() {
    fireEvent.change(screen.getByLabelText('Email or Username'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
        target: { value: 'synthetic-password' },
    })
    fireEvent.submit(screen.getByLabelText('Password', { exact: true }).closest('form')!)
}

it('resumes an anonymous bookmark exactly once after login without remounting the map', async () => {
    setup()
    const map = screen.getByTestId('persistent-map')
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark place' }))
    login()
    await waitFor(() => expect(places.setFavorite).toHaveBeenCalledTimes(1))
    expect(vi.mocked(places.setFavorite).mock.calls[0]?.slice(0, 2)).toEqual([1, true])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('persistent-map')).toBe(map)
})
it('cancelling login clears the queued bookmark and restores keyboard focus', async () => {
    setup()
    const button = screen.getByRole('button', { name: 'Bookmark place' })
    button.focus()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'Close account window' }))
    await waitFor(() => expect(button).toHaveFocus())
    await openAccount()
    login()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(places.setFavorite).not.toHaveBeenCalled()
})
it('registers with the existing contract and keeps verification disabled', async () => {
    setup()
    await openAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Register Here.' }))
    expect(screen.getByLabelText('Verification Code')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
        target: { value: 'S4@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Username', { exact: true }), {
        target: { value: 'S4' },
    })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
        target: { value: 'synthetic-password' },
    })
    fireEvent.submit(screen.getByLabelText('Password', { exact: true }).closest('form')!)
    await waitFor(() =>
        expect(api.register).toHaveBeenCalledWith({
            username: 'S4',
            email: 's4@example.test',
            password: 'synthetic-password',
        }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
it('does not let a late login close a newly opened registration window', async () => {
    const response = deferred<User | null>()
    vi.mocked(api.login).mockImplementation(async () => {
        await response.promise
        return (server = account('A'))
    })
    setup()
    await openAccount()
    login()
    await waitFor(() => expect(api.login).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Close account window' }))
    await openAccount()
    // Switching is intentionally disabled while a Cookie write runs; the new
    // login window itself still belongs to a separate opening round.
    await act(async () => {
        response.resolve(account('A'))
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument()
    expect(places.setFavorite).not.toHaveBeenCalled()
})
it('clears password fields when /me reports another account', async () => {
    server = account('A')
    setup()
    await openAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'old-A' } })
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'new-A' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'new-A' } })
    server = account('B')
    fireEvent.click(screen.getByText('Recheck session'))
    await waitFor(() => expect(screen.getByLabelText('Current Password')).toHaveValue(''))
    expect(screen.getByLabelText('New Password')).toHaveValue('')
    expect(screen.getByLabelText('Confirm Password')).toHaveValue('')
})
it('does not reopen a password window after the user closes it during submission', async () => {
    const response = deferred<void>()
    vi.spyOn(api, 'changePassword').mockReturnValue(response.promise)
    server = account('A')
    setup()
    await openAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    for (const label of ['Current Password', 'New Password', 'Confirm Password'])
        fireEvent.change(screen.getByLabelText(label), { target: { value: 'synthetic-password' } })
    fireEvent.submit(screen.getByLabelText('Current Password').closest('form')!)
    await waitFor(() => expect(api.changePassword).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Close account window' }))
    await act(async () => {
        response.resolve()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('reports logout failure and retains the confirmed account', async () => {
    vi.spyOn(api, 'logout').mockRejectedValue(new ApiError(503, 'Service unavailable'))
    server = account('A')
    setup()
    await openAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
    expect(screen.getByLabelText('Nickname')).toBeInTheDocument()
})
it('shows own private places without publishing them into the map', async () => {
    server = account('A')
    setup()
    await openAccount()
    fireEvent.click(screen.getByRole('button', { name: 'My Places' }))
    expect(await screen.findByText('Synthetic private place')).toBeInTheDocument()
    expect(screen.getByText(/Private · pending/)).toBeInTheDocument()
    expect(screen.getByTestId('persistent-map')).toBeEmptyDOMElement()
})
