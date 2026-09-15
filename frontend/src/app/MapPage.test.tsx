import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/shared/i18n'
import { syntheticPlace, syntheticPlaces } from '@/features/dev/placeFixtures'
import { MapPage } from './MapPage'
const clients: QueryClient[] = []
afterEach(() => {
    cleanup()
    clients.splice(0).forEach((client) => client.clear())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})
function Route() {
    const route = useLocation()
    return (
        <output data-testid="route">
            {route.pathname}
            {route.search}
            {route.hash}
        </output>
    )
}
function app(url: string, mobile = false, count = 5) {
    vi.stubGlobal('innerWidth', mobile ? 375 : 1440)
    vi.stubGlobal('matchMedia', () => ({
        matches: mobile,
        addEventListener: () => {},
        removeEventListener: () => {},
    }))
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
        () => [{ width: 100, height: 40 }] as unknown as DOMRectList,
    )
    const fetcher = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input), 'http://localhost')
        const id = /\/api\/markers\/(\d+)$/.exec(url.pathname)?.[1]
        const data = id
            ? syntheticPlace({
                  id: Number(id),
                  title: `Synthetic place ${id}`,
                  markImage: '/uploads/markers/synthetic.webp',
              })
            : syntheticPlaces(count)
        return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
        })
    })
    vi.stubGlobal('fetch', fetcher)
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    clients.push(client)
    const view = render(
        <QueryClientProvider client={client}>
            <LanguageProvider>
                <MemoryRouter initialEntries={[url]}>
                    <MapPage />
                    <Route />
                </MemoryRouter>
            </LanguageProvider>
        </QueryClientProvider>,
    )
    return { ...view, fetcher }
}
it('opens a result and dismisses the desktop second column while retaining the real map', async () => {
    const { container } = app('/search?q=place&lang=en#retained')
    const map = container.querySelector('.leaflet-container')
    const row = await screen.findByRole('button', { name: /^Synthetic place 1\s*08:00/ })
    fireEvent.click(row)
    await screen.findByRole('heading', { name: 'Synthetic place 1' })
    expect(screen.getByTestId('route')).toHaveTextContent('markerId=1#retained')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Details' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('heading', { name: 'Search Results' })).not.toBeInTheDocument()
    expect(container.querySelector('.leaflet-container')).toBe(map)
})
it('preserves the phone input node, focus and IME composition while expanding from collapsed', async () => {
    app('/?lang=en', true)
    const input = screen.getByRole('textbox', { name: 'Search Positions' })
    act(() => input.focus())
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '医' } })
    await waitFor(() =>
        expect(document.getElementById('map-shell')).toHaveAttribute('data-snap', 'full'),
    )
    expect(screen.getByRole('textbox', { name: 'Search Positions' })).toBe(input)
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: '医院' } })
    fireEvent.compositionEnd(input)
    expect(input).toHaveValue('医院')
    expect(input).toHaveFocus()
    expect(document.getElementById('map-shell')).toHaveAttribute('data-panel', 'search')
})
it('returns from phone detail to nearby categories and dismisses a direct search with Escape', async () => {
    app('/maps?markerId=1&lang=en', true)
    await screen.findByRole('heading', { name: 'Synthetic place 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Find nearby' }))
    await screen.findByRole('heading', { name: 'Find Nearby' })
    expect(document.getElementById('map-shell')).toHaveAttribute('data-snap', 'half')
    expect(screen.getByTestId('route')).not.toHaveTextContent('markerId')
    cleanup()
    app('/search?q=place&lang=en', true)
    await screen.findByRole('list', { name: 'Search Results' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search Positions' }), { key: 'Escape' })
    await waitFor(() =>
        expect(document.getElementById('map-shell')).toHaveAttribute('data-snap', 'collapsed'),
    )
})
it('does not activate ignored coordinates when dismissing a mixed legacy marker link', async () => {
    const { container } = app('/maps?markerId=1&lat=0&lng=0&title=Other&lang=en')
    await screen.findByRole('heading', { name: 'Synthetic place 1' })
    const before = (container.querySelector('.product-map') as HTMLElement).dataset.center
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Details' })).not.toBeInTheDocument(),
    )
    expect(container.querySelector('#map-shared-location')).toBeNull()
    expect((container.querySelector('.product-map') as HTMLElement).dataset.center).toBe(before)
})
it('shows legacy phone search results immediately, and restores a virtualized far row after closing detail', async () => {
    app('/search?q=place&lang=en', true, 300)
    const list = await screen.findByRole('list', { name: 'Search Results' })
    expect(document.getElementById('map-shell')).toHaveAttribute('data-snap', 'full')
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
    fireEvent.keyDown(list, { key: 'End' })
    const last = await screen.findByRole('button', { name: /^Synthetic place 300\s*08:00/ })
    await waitFor(() => expect(last).toHaveFocus())
    const offset = list.scrollTop
    fireEvent.click(last)
    await screen.findByRole('heading', { name: 'Synthetic place 300' })
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    const restored = await screen.findByRole('button', { name: /^Synthetic place 300\s*08:00/ })
    await waitFor(() => expect(restored).toHaveFocus())
    expect(screen.getByRole('list', { name: 'Search Results' }).scrollTop).toBe(offset)
    expect(screen.getAllByRole('listitem').length).toBeLessThan(30)
})
it.each(['/maps?markerId=unsafe', '/maps?panel=details'])(
    'handles invalid details %s without an empty panel',
    async (url) => {
        const { fetcher } = app(url)
        expect(await screen.findByText('This place link is invalid.')).toBeInTheDocument()
        expect(
            fetcher.mock.calls.some(
                ([path]) =>
                    /\/api\/markers\/[^/?]+\?/.test(String(path)) &&
                    !String(path).includes('viewport'),
            ),
        ).toBe(false)
    },
)
it('renders a legacy shared coordinate target and gives markerId precedence over coordinates', async () => {
    const { container } = app('/maps?lat=31.2&lng=121.4&title=Meeting%20Point')
    expect(container.querySelector('#map-shared-location')).toHaveAttribute(
        'title',
        'Meeting Point',
    )
    cleanup()
    const second = app('/maps?markerId=1&lat=31.2&lng=121.4&title=Meeting%20Point&lang=zh')
    await screen.findByRole('heading', { name: 'Synthetic place 1' })
    expect(second.container.querySelector('#map-shared-location')).toBeNull()
    expect(second.fetcher).toHaveBeenCalledWith(
        '/api/markers/1?lang=zh',
        expect.objectContaining({ credentials: 'omit' }),
    )
})
it('copies only a public place link, uses a destination-only navigation URL and removes broken photos', async () => {
    app('/maps?markerId=1&lang=en&lat=0&lng=0')
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await screen.findByRole('heading', { name: 'Synthetic place 1' })
    const photo = document.querySelector<HTMLImageElement>('.place-photo')!
    expect(photo).toHaveAttribute('src', '/uploads/markers/synthetic.webp')
    fireEvent.error(photo)
    expect(document.querySelector('.place-photo')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('Link copied.')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/maps?markerId=1&lang=en`)
    expect(screen.getByRole('link', { name: /^Navigate to/ })).toHaveAttribute(
        'href',
        'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=31.2304%2C121.4737',
    )
})
