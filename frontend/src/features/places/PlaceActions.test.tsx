import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { UiLanguage } from '@/shared/i18n/ui'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import { PlaceActions } from './PlaceActions'

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

/**
 * Radix Popper hides detached content when every rect is 0x0 in jsdom, which
 * would make a `getByRole` miss look like a real close while the menu is still
 * open. Give the popper real measurements so visibility reflects the actual
 * open/closed state.
 */
function measuredLayout() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
    ) {
        return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 220,
            bottom: 160,
            width: 220,
            height: 160,
            toJSON: () => ({}),
        } as DOMRect
    })
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    )
    const original = Element.prototype.getClientRects
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
        () => [{ width: 220, height: 160 }] as unknown as DOMRectList,
    )
    return () => original
}

function renderActions() {
    measuredLayout()
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(
        <UiLanguage language="en">
            <PlaceActions place={syntheticPlace({ title: 'Blue Café' })} language="en" />
        </UiLanguage>,
    )
    return { writeText }
}

it('keeps the Navigate trigger in place and never opens a menu until chosen', () => {
    renderActions()
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Choose a navigation app' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
})

it('opens three app options with Apple first and no visible title heading', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }))
    const chooser = screen.getByRole('dialog', { name: 'Choose a navigation app' })
    expect(within(chooser).queryByRole('heading')).toBeNull()
    const links = within(chooser).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
        'Apple Maps',
        'Google Maps',
        'Baidu Maps',
    ])
    expect(links[0]).toHaveAttribute(
        'href',
        'https://maps.apple.com/?daddr=31.2304%2C121.4737&dirflg=w',
    )
    expect(links[1]).toHaveAttribute(
        'href',
        'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=31.2304%2C121.4737',
    )
    expect(links[2]).toHaveAttribute('href', expect.stringContaining('coord_type=wgs84'))
    for (const link of links) {
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
})

it('closes on an outside click with the trigger truly collapsed', async () => {
    renderActions()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Navigate' })
    await user.click(trigger)
    const chooser = screen.getByRole('dialog', { name: 'Choose a navigation app' })
    expect(within(chooser).getAllByRole('link')[0]).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.click(document.body)
    // A real dismissal, not just Popper hiding a still-open menu.
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    expect(document.querySelector('.navigation-chooser')).toBeNull()
})

it('closes on Escape and returns focus to the trigger', async () => {
    renderActions()
    const trigger = screen.getByRole('button', { name: 'Navigate' })
    fireEvent.click(trigger)
    const chooser = screen.getByRole('dialog', { name: 'Choose a navigation app' })
    fireEvent.keyDown(chooser, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    await waitFor(() => expect(document.querySelector('.navigation-chooser')).toBeNull())
    expect(trigger).toHaveFocus()
})

it('keeps sharing unchanged alongside the navigation chooser', async () => {
    const { writeText } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('Link copied.')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/maps?markerId=1&lang=en`)
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeInTheDocument()
})
