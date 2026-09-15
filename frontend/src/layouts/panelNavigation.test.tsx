import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DesignPage from '@/features/dev/DesignPage'

it('returns from a bookmark detail to the retained search draft', async () => {
    render(
        <MemoryRouter initialEntries={['/__design/desktop?screen=bookmarks']}>
            <DesignPage />
        </MemoryRouter>,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Bookmarks' }), {
        target: { value: 'Wanping' },
    })
    fireEvent.click(screen.getByRole('button', { name: /600, South Wanping Road/ }))
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Search Bookmarks' })).toHaveValue('Wanping'),
    )
})

it('closes the language layer to Settings and keeps the two-option choice in memory', async () => {
    const before = localStorage.getItem('lycoris.language')
    render(
        <MemoryRouter initialEntries={['/__design/desktop?screen=settings']}>
            <DesignPage />
        </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose Language English' }))
    fireEvent.click(screen.getByRole('radio', { name: '简体中文' }))
    expect(screen.getByRole('radio', { name: '简体中文' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose Language English' }))
    expect(screen.getByRole('radio', { name: '简体中文' })).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem('lycoris.language')).toBe(before)
})

it('does not close a panel for IME Escape, but closes for ordinary Escape', async () => {
    render(
        <MemoryRouter initialEntries={['/__design/desktop?screen=search']}>
            <DesignPage />
        </MemoryRouter>,
    )
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Search' })).not.toBeInTheDocument(),
    )
})
