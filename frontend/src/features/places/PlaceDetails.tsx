import { useEffect, useRef, useState } from 'react'
import { DesignButton, IconButton } from '@/shared/ui/design-primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import { distanceLabel, navigationUrl, openingHours, placeShareUrl, publicImageUrl } from './model'
import type { PlaceBrowse } from './usePlaceBrowse'
import { ReadMessage } from './PlaceResults'
import { BookmarkButton } from '@/features/bookmarks/BookmarkButton'

export function PlaceDetails({
    browse,
    mobile = false,
    onEdit,
}: {
    browse: PlaceBrowse
    mobile?: boolean
    onEdit?: (() => void) | undefined
}) {
    const { detail: place, detailState } = browse
    const [failedImage, setFailedImage] = useState<string | null>(null)
    const [shareState, setShareState] = useState<{ id: number; text: string } | null>(null)
    const heading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        heading.current?.focus({ preventScroll: true })
    }, [place?.id])
    const image = publicImageUrl(place?.markImage ?? null)
    const distance = place ? distanceLabel(place, browse.location.position) : null
    const share = async () => {
        if (!place) return
        const url = placeShareUrl(window.location.origin, place.id, browse.language)
        try {
            if (navigator.share) await navigator.share({ title: place.title, url })
            else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url)
                setShareState({ id: place.id, text: 'Link copied.' })
            } else setShareState({ id: place.id, text: 'Sharing is unavailable in this browser.' })
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError'))
                setShareState({ id: place.id, text: 'Could not share this link. Try again.' })
        }
    }
    return (
        <div
            className={
                mobile
                    ? 'mobile-detail-content live-mobile-detail'
                    : 'desktop-place-detail live-place-detail'
            }
        >
            {!place || detailState.error ? (
                <ReadMessage state={detailState} />
            ) : (
                <>
                    {mobile ? (
                        <h1 ref={heading} tabIndex={-1} lang={place.contentLanguage}>
                            {place.title}
                        </h1>
                    ) : (
                        <h2 ref={heading} tabIndex={-1} lang={place.contentLanguage}>
                            {place.title}
                        </h2>
                    )}
                    {!mobile ? (
                        <BookmarkButton place={place} language={browse.language} />
                    ) : (
                        <IconButton
                            className={mobile ? 'mobile-place-edit' : 'details-bookmark'}
                            id="mobile-place-edit"
                            icon={mobile ? 'mobileEdit' : 'navBookmarks'}
                            size={mobile ? 20 : 24}
                            label={mobile ? 'Edit place' : 'Bookmark place'}
                            available={!!onEdit}
                            onClick={onEdit}
                        />
                    )}
                    <span className="place-meta">
                        {distance && (
                            <span title="Straight-line distance from your location">
                                {distance}
                            </span>
                        )}
                        <span>{openingHours(place, browse.language)}</span>
                    </span>
                    {mobile && place.description && (
                        <p className="mobile-description" lang={place.contentLanguage}>
                            {place.description}
                        </p>
                    )}
                    {image && image !== failedImage && (
                        <img
                            className={mobile ? 'mobile-photo' : 'place-photo'}
                            src={image}
                            alt=""
                            onError={() => setFailedImage(image)}
                        />
                    )}
                    {!mobile && place.description && (
                        <p className="place-description" lang={place.contentLanguage}>
                            {place.description}
                        </p>
                    )}
                    <div className="place-actions">
                        <DesignButton className="share-button" onClick={() => void share()}>
                            <span>Share</span>
                            <FigmaIcon name={mobile ? 'mobileShare' : 'share'} />
                        </DesignButton>
                        <a
                            className="design-button navigate-button"
                            href={navigationUrl(place)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Navigate to ${place.title} in Google Maps`}
                        >
                            <span>Navigate</span>
                            <FigmaIcon name="forward" />
                        </a>
                        {mobile && (
                            <BookmarkButton place={place} language={browse.language} mobile />
                        )}
                    </div>
                    {shareState?.id === place.id && (
                        <p className="place-action-status" role="status">
                            {shareState.text}
                        </p>
                    )}
                </>
            )}
        </div>
    )
}
