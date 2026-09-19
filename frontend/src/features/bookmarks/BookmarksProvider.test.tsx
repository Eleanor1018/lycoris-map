import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppProviders } from '@/app/providers'
import { useBookmarks } from './BookmarksProvider'
import { syntheticPlace } from '@/features/dev/placeFixtures'
import * as api from '@/shared/api/session'
import * as places from '@/shared/api/privatePlaces'
import type { Language } from '@/shared/query/keys'

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})
it('preserves the target-language title while a bookmark from another language is pending', async () => {
    let resolve!: () => void
    const response = new Promise<void>((r) => {
        resolve = r
    })
    vi.spyOn(api, 'fetchMe').mockResolvedValue({
        publicId: 'A',
        username: 'A',
        email: null,
        nickname: null,
        pronouns: null,
        signature: null,
        avatarUrl: null,
    })
    vi.spyOn(places, 'readFavorites').mockResolvedValue([1])
    vi.spyOn(places, 'readFavoriteDetails').mockImplementation(async (lang) => [
        syntheticPlace({
            title: lang === 'en' ? 'English title' : '中文标题',
            contentLanguage: lang,
        }),
    ])
    vi.spyOn(places, 'setFavorite').mockReturnValue(response)
    function Harness() {
        const [language, setLanguage] = useState<Language>('en')
        const bookmarks = useBookmarks(language, true)
        return (
            <>
                <button
                    disabled={!bookmarks.scope || bookmarks.listState.pending}
                    onClick={() => {
                        void bookmarks.controller.toggle(
                            syntheticPlace({ title: '中文标题', contentLanguage: 'zh' }),
                            true,
                            'zh',
                            bookmarks.scope!,
                        )
                        setLanguage('en')
                    }}
                >
                    Save Chinese place
                </button>
                <p>{bookmarks.places.map((p) => p.title).join(',')}</p>
            </>
        )
    }
    render(
        <AppProviders>
            <Harness />
        </AppProviders>,
    )
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('English title')).toBeInTheDocument()
    expect(screen.queryByText('中文标题')).not.toBeInTheDocument()
    await act(async () => {
        resolve()
    })
})

it('keeps the first-save state when the ids read is still unresolved, and ignores a late stale read', async () => {
    let finishStaleIds!: (ids: number[]) => void
    let calls = 0
    vi.spyOn(api, 'fetchMe').mockResolvedValue({
        publicId: 'A',
        username: 'A',
        email: null,
        nickname: null,
        pronouns: null,
        signature: null,
        avatarUrl: null,
    })
    vi.spyOn(places, 'readFavorites').mockImplementation(() => {
        calls += 1
        // The read in flight when the write starts hangs; the authoritative
        // re-read after invalidation returns the post-write server state.
        return calls === 1
            ? new Promise((resolve) => {
                  finishStaleIds = resolve
              })
            : Promise.resolve([5])
    })
    vi.spyOn(places, 'readFavoriteDetails').mockResolvedValue([])
    vi.spyOn(places, 'setFavorite').mockResolvedValue(undefined)
    let latest: ReturnType<typeof useBookmarks> | undefined
    function Harness() {
        const bookmarks = useBookmarks('en', true)
        latest = bookmarks
        return (
            <button
                disabled={!bookmarks.scope}
                onClick={() => {
                    void bookmarks.controller.toggle(
                        syntheticPlace({ id: 5 }),
                        true,
                        'en',
                        bookmarks.scope!,
                    )
                }}
            >
                Save
            </button>
        )
    }
    render(
        <AppProviders>
            <Harness />
        </AppProviders>,
    )
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(latest?.saved.has(5)).toBe(true))
    // The stale pre-write read resolves with data that never saw the write; it
    // must not erase the confirmed state.
    await act(async () => {
        finishStaleIds([])
    })
    await waitFor(() => expect(latest?.saved.has(5)).toBe(true))
})
