import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import * as api from '@/shared/api/session'
import * as places from '@/shared/api/privatePlaces'
import filledIcon from '@/assets/figma/bookmark-filled.svg'
import outlineIcon from '@/assets/figma/nav-bookmarks.svg'
import { BookmarkButton } from './BookmarkButton'

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

const user = {
    publicId: 'A',
    username: 'A',
    email: null,
    nickname: null,
    pronouns: null,
    signature: null,
    avatarUrl: null,
}

/**
 * Drive the real provider/store flow against a mutable server-side favorites
 * set: every read (including the authoritative re-read after a write) returns
 * the current set, so a confirmed write can be observed without faking cache.
 */
function signedIn(initial: number[] = []) {
    const favorites = new Set(initial)
    vi.spyOn(api, 'fetchMe').mockResolvedValue(user)
    const read = vi.spyOn(places, 'readFavorites').mockImplementation(async () => [...favorites])
    const write = vi.spyOn(places, 'setFavorite').mockImplementation(async (id, saved) => {
        if (saved) favorites.add(id)
        else favorites.delete(id)
    })
    return { read, write }
}

function renderButton(place = syntheticPlace()) {
    render(
        <AppProviders>
            <BookmarkButton place={place} language="en" />
        </AppProviders>,
    )
}

function button() {
    return screen.getByRole('button', { name: /bookmark|remove bookmark/i })
}

function iconSrc() {
    const img = button().querySelector('img')
    if (!img) throw new Error('Bookmark icon missing')
    return img.getAttribute('src')
}

/** Wait until the signed-in scope has loaded so a click resumes the save. */
async function readyToSave(read: { mock: { calls: unknown[] } }) {
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(0))
    await waitFor(() => expect(button()).toBeEnabled())
}

it('starts as an outline control with aria-pressed=false before any saved read resolves', async () => {
    signedIn([])
    renderButton()
    expect(button()).toHaveAttribute('aria-pressed', 'false')
    expect(button()).toHaveAttribute('aria-label', 'Bookmark place')
    expect(iconSrc()).toBe(outlineIcon)
})

it('shows the filled icon and aria-pressed=true after a successful save', async () => {
    const { read, write } = signedIn([])
    renderButton()
    await readyToSave(read)
    fireEvent.click(button())
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'true'))
    expect(write).toHaveBeenCalledWith(1, true, expect.anything())
    expect(button()).toHaveAttribute('aria-label', 'Remove bookmark')
    expect(iconSrc()).toBe(filledIcon)
})

it('returns to the outline icon after a successful removal', async () => {
    const { read, write } = signedIn([1])
    renderButton()
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'true'))
    await readyToSave(read)
    expect(iconSrc()).toBe(filledIcon)
    fireEvent.click(button())
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'false'))
    expect(write).toHaveBeenCalledWith(1, false, expect.anything())
    expect(iconSrc()).toBe(outlineIcon)
})

it('never shows a saved state when the write fails', async () => {
    const { read } = signedIn([])
    vi.spyOn(places, 'setFavorite').mockRejectedValue(new Error('offline'))
    renderButton()
    await readyToSave(read)
    fireEvent.click(button())
    expect(
        await screen.findByText('Could not update this bookmark. Please try again.'),
    ).toHaveClass('bookmark-feedback')
    expect(button()).toHaveAttribute('aria-pressed', 'false')
    expect(iconSrc()).toBe(outlineIcon)
})

it('shows an already-saved server place as filled on load', async () => {
    signedIn([1])
    renderButton()
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'true'))
    expect(button()).toHaveAttribute('aria-label', 'Remove bookmark')
    expect(iconSrc()).toBe(filledIcon)
})
