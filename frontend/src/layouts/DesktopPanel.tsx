import { FigmaIcon } from '@/shared/ui/figma-icon'
import { CategoryBadge, DesignButton, IconButton, NearbyCards, SearchField } from './primitives'
import type { DesignSample, Panel } from './types'
import { ContributionForm, type ContributionFormProps } from './ContributionForm'
import type { Marker } from '@/shared/api/markers'
import type { PlaceBrowse } from '@/features/places/usePlaceBrowse'
import { PlaceDetails } from '@/features/places/PlaceDetails'
import { PlaceResults } from '@/features/places/PlaceResults'
import { BookmarksPanel } from '@/features/bookmarks/BookmarksPanel'

type Props = {
    panel: Panel
    sample: DesignSample | undefined
    search: string
    bookmarksSearch: string
    language: 'en' | 'zh'
    setSearch: (value: string) => void
    setBookmarksSearch: (value: string) => void
    setLanguage: (value: 'en' | 'zh') => void
    open: (panel: Panel, focusId?: string) => void
    close: () => void
    contribution?: Omit<ContributionFormProps, 'mobile'>
    browse?: PlaceBrowse | undefined
    selectPlace?: ((place: Marker, focusId: string) => void) | undefined
    chooseCategory?: ((category: 'toilet' | 'nursing' | 'medical') => void) | undefined
    editPlace?: (() => void) | undefined
}

export function DesktopPanel(props: Props) {
    const { panel, sample, close, open } = props
    if (panel === 'initial') return null
    if (panel === 'contribute-form' && props.contribution)
        return (
            <section className="desktop-panel panel-contribute-form" aria-label="Contribute">
                <ContributionForm {...props.contribution} />
            </section>
        )
    if (panel === 'contribute')
        return (
            <div className="contribution-bar">
                <FigmaIcon name="info" />
                <span>Click on the map to add points.</span>
                <IconButton icon="close" label="Close contribution mode" onClick={close} />
            </div>
        )
    const heading = panel.charAt(0).toUpperCase() + panel.slice(1)
    return (
        <section className={`desktop-panel panel-${panel}`} aria-label={heading}>
            <h1>{heading}</h1>
            <IconButton className="panel-close" icon="close" label="Close panel" onClick={close} />
            {panel === 'search' && (
                <>
                    <SearchField value={props.search} onChange={props.setSearch} />
                    {props.browse && props.browse.mode !== 'map' && props.selectPlace ? (
                        <PlaceResults browse={props.browse} onSelect={props.selectPlace} />
                    ) : (
                        <>
                            <h2 className="nearby-heading">Find Nearby</h2>
                            <NearbyCards onSelect={props.chooseCategory} />
                        </>
                    )}
                </>
            )}
            {panel === 'bookmarks' && !sample && props.browse && props.selectPlace && (
                <BookmarksPanel browse={props.browse} onSelect={props.selectPlace} />
            )}
            {panel === 'bookmarks' && sample && (
                <>
                    <SearchField
                        bookmarks
                        value={props.bookmarksSearch}
                        onChange={props.setBookmarksSearch}
                    />
                    <h2 className="nearby-heading">Nearest Locations</h2>
                    {sample && (
                        <div className="nearby-cards">
                            <DesignButton
                                id="desktop-bookmark-place"
                                className="category-card bookmark-card"
                                onClick={() => open('details', 'desktop-bookmark-place')}
                            >
                                <CategoryBadge category="toilet" />
                                <PlaceSummary place={sample.place} />
                            </DesignButton>
                            <DesignButton className="category-card" available={false}>
                                <CategoryBadge category="nursing" />
                                <span className="card-title">Nursing Rooms</span>
                            </DesignButton>
                            <DesignButton className="category-card" available={false}>
                                <CategoryBadge category="medical" />
                                <span className="card-title">Medical Institutions</span>
                            </DesignButton>
                        </div>
                    )}
                </>
            )}
            {panel === 'languages' && (
                <div className="language-options" role="radiogroup" aria-label="Language">
                    {(['en', 'zh'] as const).map((lang) => (
                        <DesignButton
                            key={lang}
                            role="radio"
                            aria-checked={props.language === lang}
                            tabIndex={props.language === lang ? 0 : -1}
                            onClick={() => props.setLanguage(lang)}
                            onKeyDown={(event) => {
                                if (
                                    ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(
                                        event.key,
                                    )
                                ) {
                                    event.preventDefault()
                                    props.setLanguage(lang === 'en' ? 'zh' : 'en')
                                    const siblings =
                                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                            '[role=radio]',
                                        )
                                    siblings?.[lang === 'en' ? 1 : 0]?.focus()
                                }
                            }}
                        >
                            <span lang={lang === 'en' ? 'en' : 'zh-CN'}>
                                {lang === 'en' ? 'English' : '简体中文'}
                            </span>
                            {props.language === lang && <FigmaIcon name="check" size={20} />}
                        </DesignButton>
                    ))}
                </div>
            )}
            {panel === 'settings' && (
                <div className="settings-cards">
                    {[
                        ['Choose Language', 'English'],
                        ['Searching Range', '1km'],
                        ['Searching Type', 'toilet'],
                        ['Map Source', 'OSM'],
                        ['About Lycoris Maps', ''],
                    ].map(([title, value], index) => (
                        <DesignButton
                            key={title}
                            id={`setting-${index}`}
                            aria-label={`${title}${value ? ` ${value}` : ''}`}
                            className="setting-card"
                            available={index === 0}
                            onClick={() => open('languages', 'setting-0')}
                        >
                            <span>{title}</span>
                            <span className="setting-value">{value}</span>
                            <span className="chevron-slot">
                                <FigmaIcon name="chevron" />
                            </span>
                        </DesignButton>
                    ))}
                </div>
            )}
            {panel === 'details' && (
                <>
                    <IconButton
                        className="details-edit"
                        id="desktop-place-edit"
                        icon="edit"
                        size={20}
                        label="Edit place"
                        available={!!props.editPlace && !!props.browse?.detail}
                        onClick={props.editPlace}
                    />
                    {props.browse ? (
                        <PlaceDetails browse={props.browse} />
                    ) : (
                        sample && (
                            <div className="desktop-place-detail">
                                <h2>{sample.place.title.replace(' Shanghai,', '\nShanghai,')}</h2>
                                <IconButton
                                    className="details-bookmark"
                                    icon="bookmarkFilled"
                                    label="Bookmark place"
                                    available={false}
                                />
                                <PlaceMeta place={sample.place} />
                                <img
                                    className="place-photo"
                                    src={sample.place.desktopPhoto}
                                    alt=""
                                />
                                <p className="place-description">
                                    {sample.place.desktopDescription}
                                </p>
                            </div>
                        )
                    )}
                    {!props.browse && (
                        <>
                            <ShareButton />
                            <DesignButton className="navigate-button" available={false}>
                                <span>Navigate</span>
                                <FigmaIcon name="forward" />
                            </DesignButton>
                        </>
                    )}
                </>
            )}
        </section>
    )
}

export function PlaceMeta({ place }: { place: DesignSample['place'] }) {
    return (
        <span className="place-meta">
            <span>{place.distance}</span>
            <span>{place.hours}</span>
        </span>
    )
}
export function PlaceSummary({ place }: { place: DesignSample['place'] }) {
    return (
        <span className="place-summary">
            <span className="card-title">{place.bookmarkTitle}</span>
            <PlaceMeta place={place} />
        </span>
    )
}
export function ShareButton({ mobile = false }: { mobile?: boolean }) {
    return (
        <DesignButton className="share-button" available={false}>
            <span>Share</span>
            <FigmaIcon name={mobile ? 'mobileShare' : 'share'} />
        </DesignButton>
    )
}
