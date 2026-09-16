import { useUi } from '@/shared/i18n/ui'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '@/shared/ui/design-primitives'
import { distanceLabel, openingHours, publicImageUrl } from './model'
import type { PlaceBrowse } from './usePlaceBrowse'
import { ReadMessage } from './PlaceResults'
import { PlaceActions } from './PlaceActions'
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
    const ui = useUi()
    const { detail: place, detailState } = browse
    const [failedImage, setFailedImage] = useState<string | null>(null)
    const heading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        heading.current?.focus({ preventScroll: true })
    }, [place?.id])
    const image = publicImageUrl(place?.markImage ?? null)
    const distance = place ? distanceLabel(place, browse.location.position) : null
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
                            <span title={ui.text('Straight-line distance from your location')}>
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
                    <PlaceActions place={place} language={browse.language} mobile={mobile}>
                        {mobile && (
                            <BookmarkButton place={place} language={browse.language} mobile />
                        )}
                    </PlaceActions>
                </>
            )}
        </div>
    )
}
