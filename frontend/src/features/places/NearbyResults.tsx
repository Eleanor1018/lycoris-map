import { useState } from 'react'
import type { Marker } from '@/shared/api/markers'
import { DesignButton } from '@/shared/ui/design-primitives'
import type { PlaceBrowse } from './usePlaceBrowse'
import { categoryLabels, distanceLabel, openingHours, publicImageUrl } from './model'
import { PlaceActions } from './PlaceActions'
import { ReadMessage } from './PlaceResults'
import { NearbyWindow } from './NearbyWindow'
import './nearby.css'

type Props = {
    browse: PlaceBrowse
    onSelect: (place: Marker, focusId: string) => void
    mobile?: boolean
}

export function NearbyResults(props: Props) {
    const listKey = JSON.stringify([
        'nearby',
        props.mobile,
        props.browse.nearby,
        props.browse.language,
    ])
    return <NearbyList key={listKey} {...props} listKey={listKey} />
}

function NearbyList({ browse, onSelect, mobile = false, listKey }: Props & { listKey: string }) {
    const { nearby, results, state } = browse
    const heading = `${categoryLabels[nearby?.category ?? 'accessible_toilet']} in 1km`
    return (
        <div className={`nearby-results ${mobile ? 'mobile-nearby-results' : ''}`}>
            {mobile && <h1 className="nearby-title">Nearby</h1>}
            <h2 className="nearby-category-heading">{heading}</h2>
            <ReadMessage
                state={nearby ? state : { ...state, pending: true, error: null }}
                empty={!results.length}
            />
            {nearby && !state.pending && !state.error && (
                <NearbyWindow browse={browse} listKey={listKey} label={heading} mobile={mobile}>
                    {(place) => (
                        <NearbyPlace
                            place={place}
                            browse={browse}
                            onSelect={onSelect}
                            mobile={mobile}
                        />
                    )}
                </NearbyWindow>
            )}
        </div>
    )
}

function NearbyPlace({ place, browse, onSelect, mobile }: Props & { place: Marker }) {
    const [failedImage, setFailedImage] = useState<string | null>(null)
    const image = publicImageUrl(place.markImage)
    const focusId = `${mobile ? 'mobile' : 'desktop'}-nearby-place-${place.id}`
    const distance = distanceLabel(place, browse.nearby?.point ?? null)
    return (
        <article className="nearby-place" aria-label={place.title}>
            <h3>
                <DesignButton
                    id={focusId}
                    className="nearby-place-title"
                    onClick={() => onSelect(place, focusId)}
                    lang={place.contentLanguage}
                >
                    {place.title}
                </DesignButton>
            </h3>
            <span className="place-meta">
                {distance && (
                    <span
                        title={`Straight-line distance from ${browse.nearby?.located ? 'your location' : 'the map center'}`}
                    >
                        {distance}
                    </span>
                )}
                <span>{openingHours(place, browse.language)}</span>
            </span>
            {image && image !== failedImage && (
                <img
                    className="place-photo"
                    src={image}
                    alt=""
                    loading="lazy"
                    onError={() => setFailedImage(image)}
                />
            )}
            {place.description && (
                <p className="place-description" lang={place.contentLanguage}>
                    {place.description}
                </p>
            )}
            <PlaceActions place={place} language={browse.language} mobile={mobile} />
        </article>
    )
}
