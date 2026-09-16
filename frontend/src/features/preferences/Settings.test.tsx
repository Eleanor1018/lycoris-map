import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { LanguageProvider } from '@/shared/i18n'
import { PreferencesProvider, PREFERENCES_KEY } from './PreferencesProvider'
import { SettingsRows } from './Settings'

afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
})
function Route() {
    const location = useLocation()
    return <output data-testid="route">{location.search}</output>
}
function setup(mobile = false) {
    // jsdom has no layout. Give the trigger a visible rect for Radix's
    // hideWhenDetached behavior; browser QA covers the actual positioning.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
        () => [{ width: 100, height: 40 }] as unknown as DOMRectList,
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(20, 20, 100, 40),
    )
    render(
        <MemoryRouter initialEntries={['/?lang=en&panel=settings&snap=full']}>
            <LanguageProvider override="en">
                <PreferencesProvider>
                    <SettingsRows mobile={mobile} />
                    <button>Map background</button>
                    <div data-testid="sheet" className="mobile-sheet" />
                    <Route />
                </PreferencesProvider>
            </LanguageProvider>
        </MemoryRouter>,
    )
    return userEvent.setup()
}
it.each([false, true])(
    'saves a choice in place, closes the popover and returns focus (mobile=%s)',
    async (mobile) => {
        const user = setup(mobile)
        await user.click(screen.getByRole('button', { name: 'Searching Type Toilet' }))
        const popup = screen.getByRole('dialog', { name: 'Category' })
        expect(within(popup).getByRole('radio', { name: 'Accessible Toilets' })).toHaveFocus()
        await user.click(within(popup).getByRole('radio', { name: 'Nursing Rooms' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Searching Type Nursing Rooms' })).toHaveFocus()
        expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toMatchObject({
            category: 'baby_room',
        })
        expect(screen.getByTestId('route')).toHaveTextContent('?lang=en&panel=settings&snap=full')
    },
)
it('allows keyboard choices and closes only the popover on Escape', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Searching Range 1km' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: '2.5km' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: '2.5km' })).toBeChecked()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Searching Range 2.5km' })).toHaveFocus()
    expect(screen.getByTestId('route')).toHaveTextContent('panel=settings')
})
it('validates custom range in the popover and closes only after a valid save', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Searching Range 1km' }))
    const range = screen.getByRole('spinbutton', { name: 'Range (meters)' })
    fireEvent.change(range, { target: { value: '50001' } })
    fireEvent.submit(range.closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('1 and 50000')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.change(range, { target: { value: '3200' } })
    fireEvent.submit(range.closest('form')!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Searching Range 3.2km' })).toHaveFocus()
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toMatchObject({ radius: 3200 })
})
it('switches between nearby popovers, and clicking outside dismisses the active one', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Choose Language English' }))
    await user.click(screen.getByRole('button', { name: 'Map Source OSM' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Map Source' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Map background' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('closes before a touch drag moves the containing sheet, while popup scrolling stays usable', async () => {
    const user = setup(true)
    await user.click(screen.getByRole('button', { name: 'About Lycoris Maps' }))
    fireEvent.scroll(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.touchStart(screen.getByTestId('sheet'), {
        touches: [{ identifier: 1, clientY: 100 }],
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
