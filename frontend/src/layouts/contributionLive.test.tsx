import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers'
import { MapPage } from '@/app/MapPage'
import { useContributions } from '@/features/contributions/ContributionsProvider'
import { useSessionStore } from '@/features/auth/SessionProvider'
import type { ContributionStore } from '@/features/contributions/ContributionStore'
import * as writes from '@/shared/api/markerWrites'
import { syntheticPlace } from '@/features/dev/placeFixtures'
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})
function mount() {
    let resetSession = () => {}
    let mobile = false,
        store: ContributionStore | null = null
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', () => ({
        get matches() {
            return mobile
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }))
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            return new Response(
                JSON.stringify(
                    url.includes('/api/me')
                        ? {
                              code: 0,
                              message: 'ok',
                              data: {
                                  publicId: 'A',
                                  username: 'Synthetic',
                                  nickname: null,
                                  email: null,
                                  avatarUrl: null,
                                  pronouns: null,
                                  signature: null,
                              },
                          }
                        : [],
                ),
                { headers: { 'Content-Type': 'application/json' } },
            )
        }),
    )
    function Probe() {
        store = useContributions().store
        resetSession = useSessionStore()!.externalChange
        return null
    }
    const view = render(
        <MemoryRouter initialEntries={['/?lang=en']}>
            <AppProviders>
                <MapPage />
                <Probe />
            </AppProviders>
        </MemoryRouter>,
    )
    return {
        ...view,
        getStore: () => store!,
        resetSession: () => act(resetSession),
        phone: () =>
            act(() => {
                mobile = true
                listeners.forEach((fn) => fn())
            }),
    }
}
it('resizing a desktop picker opens a phone draft at the current map center without remounting the map', async () => {
    const view = mount()
    const map = view.container.querySelector('.leaflet-container')
    fireEvent.click(screen.getByRole('button', { name: 'Contribute' }))
    expect(view.getStore().getSnapshot().point).toBeNull()
    view.phone()
    await screen.findByRole('form', { name: 'Contribution draft' })
    await waitFor(() => expect(view.getStore().getSnapshot().point).not.toBeNull())
    expect(view.container.querySelector('.leaflet-container')).toBe(map)
    const point = view.getStore().getSnapshot().point
    fireEvent.click(screen.getByRole('button', { name: 'Close contribution form' }))
    fireEvent.click(screen.getByRole('button', { name: 'Contribute' }))
    expect(view.getStore().getSnapshot().point).toEqual(point)
})
it('reopens the same submitting form from Contribute, without creating another request', async () => {
    const view = mount(),
        store = view.getStore()
    await waitFor(() => expect(store.getSnapshot().owner).not.toBeNull())
    let finish!: (value: ReturnType<typeof syntheticPlace>) => void
    const write = vi.spyOn(writes, 'createMarker').mockImplementation(
        () =>
            new Promise((resolve) => {
                finish = resolve
            }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Contribute' }))
    fireEvent.click(view.container.querySelector('.product-map')!, { clientX: 650, clientY: 350 })
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
        target: { value: 'Synthetic' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Accessible Toilets' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close contribution form' }))
    fireEvent.click(screen.getByRole('button', { name: 'Contribute' }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Synthetic')
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await act(async () => {
        finish(syntheticPlace({ reviewStatus: 'PENDING' }))
    })
    expect(await screen.findByRole('button', { name: 'View place' })).toHaveFocus()
    expect(write).toHaveBeenCalledTimes(1)
})
it('clears a switched account draft while keeping the open phone form able to choose its map center', async () => {
    const view = mount()
    await waitFor(() => expect(view.getStore().getSnapshot().owner).not.toBeNull())
    view.phone()
    fireEvent.click(screen.getByRole('button', { name: 'Contribute' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
        target: { value: 'Old private draft' },
    })
    view.resetSession()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(''))
    expect(view.getStore().getSnapshot().point).not.toBeNull()
    expect(view.getStore().getSnapshot().draft.photo).toBeNull()
})
