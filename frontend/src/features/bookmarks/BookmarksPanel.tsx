import { useUi } from '@/shared/i18n/ui'
import { useState } from 'react'
import type { Marker } from '@/shared/api/markers'
import { DesignButton, SearchField, CategoryBadge } from '@/shared/ui/design-primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import {
    categoryBadges,
    distanceLabel,
    openingHours,
    distanceMeters,
} from '@/features/places/model'
import type { PlaceBrowse } from '@/features/places/usePlaceBrowse'
import { ReadMessage } from '@/features/places/PlaceResults'
import { useAccountFlow } from '@/features/auth/AccountFlow'
import { useSession } from '@/features/auth/SessionProvider'
import { useBookmarks, useBookmarkStore } from './BookmarksProvider'
import './bookmarks.css'

export function SavedPlaceRow({
    place,
    browse,
    onSelect,
    mobile = false,
    prefix = 'saved',
}: {
    place: Marker
    browse: PlaceBrowse
    onSelect: (place: Marker, focus: string) => void
    mobile?: boolean
    prefix?: string
}) {
    const badge = categoryBadges[place.category],
        distance = distanceLabel(place, browse.location.position),
        id = `${mobile ? 'mobile' : 'desktop'}-${prefix}-${place.id}`
    return (
        <DesignButton
            id={id}
            className={`place-result-row ${mobile ? 'mobile-place-row' : 'category-card'}`}
            onClick={() => onSelect(place, id)}
        >
            {badge ? (
                <CategoryBadge category={badge} />
            ) : (
                <span className="category-badge badge-custom">
                    <FigmaIcon name="map" size={20} />
                </span>
            )}
            <span className="place-summary" lang={place.contentLanguage}>
                <span className="card-title">{place.title}</span>
                <span className="place-meta">
                    {distance && <span>{distance}</span>}
                    <span>{openingHours(place, browse.language)}</span>
                </span>
            </span>
        </DesignButton>
    )
}
type Props = {
    browse: PlaceBrowse
    onSelect: (place: Marker, focus: string) => void
    mobile?: boolean
    preview?: boolean
}
export function BookmarksPanel(props: Props) {
    if (!useBookmarkStore()) return null
    return <ActiveBookmarksPanel {...props} />
}
function ActiveBookmarksPanel({ browse, onSelect, mobile = false, preview = false }: Props) {
    const ui = useUi()
    const bookmarks = useBookmarks(browse.language, true),
        flow = useAccountFlow()!,
        session = useSession()
    const [filter, setFilter] = useState('')
    if (!session.user) {
        if (preview) return null
        return (
            <div className={mobile ? 'mobile-saved-content' : 'saved-auth-notice'}>
                <p role="status">
                    {ui.message(
                        session.status === 'checking'
                            ? 'Checking your session…'
                            : session.status === 'error'
                              ? 'Could not confirm your session.'
                              : 'Log in to view your bookmarks.',
                    )}
                </p>
                <DesignButton
                    className="read-retry"
                    onClick={() =>
                        session.status === 'error'
                            ? void session.store?.refresh()
                            : flow.requireLogin()
                    }
                >
                    {' '}
                    {ui.text(session.status === 'error' ? 'Try again' : 'Login')}
                </DesignButton>
            </div>
        )
    }
    const places = bookmarks.places.filter((p) =>
        p.title.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
    )
    const position = browse.location.position
    if (position) places.sort((a, b) => distanceMeters(a, position) - distanceMeters(b, position))
    if (preview && !bookmarks.listState.pending && !bookmarks.listState.error && !places.length)
        return null
    return (
        <div
            className={
                preview
                    ? 'mobile-bookmarks live-bookmarks'
                    : mobile
                      ? 'mobile-saved-content'
                      : 'saved-content'
            }
        >
            {!preview && (
                <>
                    <h2 className="saved-mobile-title">{ui.text('Bookmarks')}</h2>
                    <SearchField bookmarks mobile={false} value={filter} onChange={setFilter} />
                </>
            )}
            <div
                className={
                    preview
                        ? 'saved-preview-list'
                        : `place-results saved-results ${mobile ? 'mobile-place-results' : ''}`
                }
            >
                {!preview && (
                    <h2 className="results-heading">
                        {ui.text(position ? 'Nearest Locations' : 'Locations')}
                    </h2>
                )}
                <ReadMessage state={bookmarks.listState} empty={!places.length} />
                {!bookmarks.listState.pending && !bookmarks.listState.error && (
                    <div
                        className="saved-place-list"
                        role="list"
                        aria-label={ui.text('Bookmarked places')}
                    >
                        {(preview ? places.slice(0, 2) : places).map((place) => (
                            <div role="listitem" key={place.id}>
                                <SavedPlaceRow
                                    place={place}
                                    browse={browse}
                                    mobile={mobile}
                                    onSelect={onSelect}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
