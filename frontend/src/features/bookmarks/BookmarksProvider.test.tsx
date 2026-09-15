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
