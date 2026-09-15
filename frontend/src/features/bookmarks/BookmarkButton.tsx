import { IconButton } from '@/shared/ui/design-primitives'
import type { Marker } from '@/shared/api/markers'
import type { Language } from '@/shared/query/keys'
import { useAccountFlow } from '@/features/auth/AccountFlow'
import { useBookmarks, useBookmarkStore } from './BookmarksProvider'

type Props = { place: Marker; language: Language; mobile?: boolean }
export function BookmarkButton(props: Props) {
    const controller = useBookmarkStore()
    if (!controller)
        return (
            <IconButton
                className={props.mobile ? 'mobile-bookmark' : 'details-bookmark'}
                icon={props.mobile ? 'mobileBookmark' : 'navBookmarks'}
                size={props.mobile ? 28 : 24}
                label="Bookmark place"
                available={false}
            />
        )
    return <ActiveBookmarkButton {...props} />
}
function ActiveBookmarkButton({ place, language, mobile = false }: Props) {
    const bookmarks = useBookmarks(language),
        flow = useAccountFlow()!
    const saved = bookmarks.saved.has(place.id),
        pending = bookmarks.pending.some((p) => p.id === place.id)
    return (
        <>
            <IconButton
                className={mobile ? 'mobile-bookmark' : 'details-bookmark'}
                icon={saved ? 'bookmarkFilled' : mobile ? 'mobileBookmark' : 'navBookmarks'}
                size={mobile ? 28 : 24}
                label={saved ? 'Remove bookmark' : 'Bookmark place'}
                aria-pressed={saved}
                aria-busy={pending}
                available={!pending && !(bookmarks.scope && bookmarks.idsPending)}
                onClick={() => {
                    if (bookmarks.idsError) {
                        bookmarks.retry()
                        return
                    }
                    flow.requireLogin((scope) =>
                        bookmarks.controller.toggle(place, !saved, language, scope),
                    )
                }}
            />
            {bookmarks.error && (
                <p className="bookmark-feedback" role="status">
                    {bookmarks.error}
                </p>
            )}
            {bookmarks.idsError && (
                <p className="bookmark-feedback" role="status">
                    Could not load bookmarks. Click the bookmark to retry.
                </p>
            )}
        </>
    )
}
