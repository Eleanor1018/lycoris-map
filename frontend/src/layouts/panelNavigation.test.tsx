import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DesignPage from '@/features/dev/DesignPage'

it('dismisses desktop bookmark details and retains the draft when Bookmarks is reopened', async () => {
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
        expect(screen.queryByRole('heading', { name: 'Details' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('textbox', { name: 'Search Bookmarks' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Main navigation' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }))
    await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Search Bookmarks' })).toHaveValue('Wanping'),
    )
})

it('selects a language in place, then closes Settings and keeps the choice in memory', async () => {
    const before = localStorage.getItem('lycoris.language')
    render(
        <MemoryRouter initialEntries={['/__design/desktop?screen=settings']}>
            <DesignPage />
        </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose Language English' }))
    fireEvent.click(screen.getByRole('radio', { name: '简体中文' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择语言 简体中文' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: '语言' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('heading', { name: '设置' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '语言' }))
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

it('closes only the setting popover on Escape, then the second column on another Escape', async () => {
    render(
        <MemoryRouter initialEntries={['/__design/desktop?screen=settings']}>
            <DesignPage />
        </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose Language English' }))
    const selected = screen.getByRole('radio', { name: 'English' })
    fireEvent.keyDown(selected, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('dialog', { name: 'Languages' })).toBeInTheDocument()
    fireEvent.keyDown(selected, { key: 'Escape' })
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Languages' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
})
