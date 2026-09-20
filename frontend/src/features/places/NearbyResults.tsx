import { PlaceHours } from '@/features/places/PlaceHours'
import { useUi } from '@/shared/i18n/ui'
import type { Marker } from '@/shared/api/markers'
import { DesignButton } from '@/shared/ui/design-primitives'
import type { PlaceBrowse } from './usePlaceBrowse'
import { categoryLabels, distanceLabel, publicImageUrl } from './model'
import { PlaceActions } from './PlaceActions'
import { ReadMessage } from './PlaceResults'
import { NearbyWindow } from './NearbyWindow'
import { PlacePhoto } from './PlacePhoto'
import { rangeLabel } from '@/features/preferences/PreferencesProvider'
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
    const ui = useUi()
    const { nearby, results, state } = browse
    const heading = ui.text('{category} in {range}', {
        category: ui.message(categoryLabels[nearby?.category ?? 'accessible_toilet']) ?? '',
        range: rangeLabel(nearby?.radius ?? 1000),
    })
    return (
        <div className={`nearby-results ${mobile ? 'mobile-nearby-results' : ''}`}>
            {mobile && <h1 className="nearby-title">{ui.text('Nearby')}</h1>}
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
    const ui = useUi()
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
                        title={ui.text(
                            browse.nearby?.located
                                ? 'Straight-line distance from your location'
                                : 'Straight-line distance from the map center',
                        )}
                    >
                        {distance}
                    </span>
                )}
                <PlaceHours place={place} language={browse.language} />
            </span>
            {image && (
                <PlacePhoto className="place-photo" src={image} loading="lazy" variant="thumb" />
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
