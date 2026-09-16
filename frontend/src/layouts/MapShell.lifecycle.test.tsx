import { StrictMode } from 'react'
import L from 'leaflet'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { MapShell } from './MapShell'

function HistoryProbe() {
    const location = useLocation()
    const navigate = useNavigate()
    return (
        <>
            <output data-testid="location">
                {location.pathname}
                {location.search}
                {location.hash}
            </output>
            <button onClick={() => navigate(-1)}>History back</button>
            <button onClick={() => navigate(1)}>History forward</button>
        </>
    )
}

it('preserves the actual Leaflet object and camera across panel history in StrictMode', async () => {
    const removal = vi.spyOn(L.Map.prototype, 'remove')
    const { container, unmount } = render(
        <StrictMode>
            <MemoryRouter initialEntries={['/maps?lang=zh&markerId=123#shared']}>
                <MapShell />
                <HistoryProbe />
            </MemoryRouter>
        </StrictMode>,
    )
    const map = container.querySelector<HTMLElement>('.leaflet-container')!
    await waitFor(() => expect(map.dataset.mapId).toBeTruthy())
    const instance = map.dataset.mapId
    const center = map.dataset.center
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(map.dataset.zoom).toBe('15'))
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }))
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Lycoris Maps' }), {
        target: { value: 'retained draft' },
    })
    expect(screen.getByTestId('location')).toHaveTextContent(
        'lang=zh&markerId=123&panel=search#shared',
    )
    fireEvent.click(screen.getByRole('button', { name: 'History back' }))
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Search' })).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'History forward' }))
    await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Lycoris Maps' })).toHaveValue('retained draft'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Search' })).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }))
    await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Lycoris Maps' })).toHaveValue('retained draft'),
    )
    expect(container.querySelector('.leaflet-container')).toBe(map)
    expect(map.dataset.mapId).toBe(instance)
    expect(map.dataset.center).toBe(center)
    expect(map.dataset.zoom).toBe('15')
    for (const name of ['Bookmarks', 'Languages', 'Settings', 'Contribute']) {
        fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}$`) }))
        expect(container.querySelector('.leaflet-container')).toBe(map)
        expect(map.dataset.mapId).toBe(instance)
        expect(map.dataset.zoom).toBe('15')
    }
    expect(container.querySelectorAll('.leaflet-container')).toHaveLength(1)
    const removedBeforeUnmount = removal.mock.calls.length
    unmount()
    expect(removal).toHaveBeenCalledTimes(removedBeforeUnmount + 1)
    removal.mockRestore()
})

it('closes a direct panel URL within the app and keeps unrelated query and hash', async () => {
    render(
        <MemoryRouter initialEntries={['/maps?panel=search&lang=en#saved']}>
            <MapShell />
            <HistoryProbe />
        </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/maps?lang=en#saved'),
    )
    expect(screen.queryByText('Nora')).not.toBeInTheDocument()
    expect(screen.queryByText('1.1km')).not.toBeInTheDocument()
})
