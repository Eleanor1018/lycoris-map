import { SettingsRows } from '@/features/preferences/Settings'
import { useUi } from '@/shared/i18n/ui'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import { PlaceMeta, PlaceSummary, ShareButton } from './DesktopPanel'
import { CategoryBadge, DesignButton, IconButton, NearbyCards, SearchField } from './primitives'
import type { DesignSample, Snap } from './types'
import { ContributionForm, type ContributionFormProps } from './ContributionForm'
import type { PlaceBrowse } from '@/features/places/usePlaceBrowse'
import type { Marker } from '@/shared/api/markers'
import { PlaceDetails } from '@/features/places/PlaceDetails'
import { PlaceResults } from '@/features/places/PlaceResults'
import { AccountEntry } from '@/features/auth/AccountEntry'
import { BookmarksPanel } from '@/features/bookmarks/BookmarksPanel'
import { useSheetDrag } from './useSheetDrag'

export function MobileSheet({
    snap,
    setSnap,
    detail,
    sample,
    search,
    setSearch,
    openDetails,
    close,
    height,
    onDetailHeight,
    contribution,
    browse,
    selectPlace,
    chooseCategory,
    secondary,
    secondaryLabel = 'Bookmarks',
    openBookmarks,
    showBookmarks,
    editPlace,
}: {
    snap: Snap
    setSnap: (value: Snap) => void
    detail: boolean
    sample: DesignSample | undefined
    search: string
    setSearch: (value: string) => void
    openDetails: (focusId: string) => void
    close: () => void
    height: number
    onDetailHeight: (height: number) => void
    contribution?: Omit<ContributionFormProps, 'mobile'> | undefined
    browse?: PlaceBrowse | undefined
    selectPlace?: ((place: Marker, focusId: string) => void) | undefined
    chooseCategory?: ((category: 'toilet' | 'nursing' | 'medical') => void) | undefined
    secondaryLabel?: string
    secondary?: ReactNode
    openBookmarks?: (() => void) | undefined
    showBookmarks: boolean
    editPlace?: (() => void) | undefined
}) {
    const ui = useUi()
    const hasPlaceResults = browse?.mode === 'search' || browse?.mode === 'cluster'
    const sheet = useRef<HTMLElement>(null)
    const composing = !!contribution
    const liveDetail = detail && !!browse
    useLayoutEffect(() => {
        const content = sheet.current?.querySelector<HTMLElement>('.live-mobile-detail')
        const scroll = content?.parentElement
        if (!liveDetail || !content || !scroll) return
        const measure = () => {
            const natural = content.getBoundingClientRect().height
            if (!natural) return
            const safeArea = parseFloat(getComputedStyle(scroll).paddingBottom) || 0
            onDetailHeight(Math.max(158, Math.ceil(natural + safeArea)))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(content)
        return () => observer.disconnect()
    }, [liveDetail, onDetailHeight])
    useEffect(() => {
        const element = sheet.current,
            viewport = window.visualViewport
        if (!composing || !element || !viewport) return
        let frame = 0
        const resize = () => {
            const normalScale = Math.abs(viewport.scale - 1) < 0.05
            const height = normalScale ? viewport.height : window.innerHeight
            const offset = normalScale
                ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
                : 0
            element.style.setProperty('--contribution-viewport-height', `${height}px`)
            element.style.setProperty('--contribution-keyboard-offset', `${offset}px`)
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                const active = document.activeElement
                if (
                    active instanceof HTMLElement &&
                    element.contains(active) &&
                    active.matches('input, textarea')
                )
                    active.scrollIntoView?.({ block: 'nearest' })
            })
        }
        resize()
        viewport.addEventListener('resize', resize)
        viewport.addEventListener('scroll', resize)
        return () => {
            cancelAnimationFrame(frame)
            viewport.removeEventListener('resize', resize)
            viewport.removeEventListener('scroll', resize)
            element.style.removeProperty('--contribution-viewport-height')
            element.style.removeProperty('--contribution-keyboard-offset')
        }
    }, [composing])
    const expandedPanel = detail || Boolean(contribution) || Boolean(secondary)
    const cycle = () =>
        expandedPanel
            ? close()
            : setSnap(snap === 'collapsed' ? 'half' : snap === 'half' ? 'full' : 'collapsed')
    useSheetDrag({
        sheet,
        snap,
        height,
        expandedPanel,
        close,
        setSnap,
        resetKey: contribution
            ? 'contribution'
            : secondary
              ? secondaryLabel
              : detail
                ? `detail-${browse?.detail?.id ?? 'loading'}`
                : 'search',
    })
    return (
        <section
            ref={sheet}
            className={`mobile-sheet ${detail ? 'mobile-detail' : ''} ${contribution ? 'mobile-contribution' : ''}`}
            data-snap={snap}
            data-expanded-panel={expandedPanel || undefined}
            aria-label={
                ui.message(
                    contribution
                        ? 'Contribute'
                        : secondary
                          ? secondaryLabel
                          : detail
                            ? 'Details'
                            : 'Search positions',
                ) ?? undefined
            }
        >
            <DesignButton
                id="sheet-handle"
                className="sheet-handle"
                aria-label={
                    ui.message(
                        secondary
                            ? `Close ${secondaryLabel.toLowerCase()}`
                            : contribution
                              ? 'Close contribution panel'
                              : detail
                                ? 'Close details'
                                : ui.text('Change panel height ({snap})', { snap }),
                    ) ?? undefined
                }
                aria-expanded={expandedPanel || snap !== 'collapsed'}
                onClick={cycle}
                onKeyDown={(event) => {
                    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) {
                        event.preventDefault()
                        event.stopPropagation()
                        if (expandedPanel) {
                            if (
                                event.key === 'ArrowDown' ||
                                event.key === 'Escape' ||
                                event.key === 'End'
                            )
                                close()
                            return
                        }
                        if (event.key === 'Home') setSnap('full')
                        else if (event.key === 'End' || event.key === 'Escape') setSnap('collapsed')
                        else if (event.key === 'ArrowUp')
                            setSnap(snap === 'collapsed' ? 'half' : 'full')
                        else setSnap(snap === 'full' ? 'half' : 'collapsed')
                    }
                }}
            >
                <span />
            </DesignButton>
            {(secondary || detail) && (
                <IconButton
                    className="mobile-sheet-close"
                    icon="close"
                    label="Close panel"
                    onClick={close}
                />
            )}
            <div
                className="sheet-scroll"
                key={
                    contribution
                        ? 'contribution'
                        : secondary
                          ? secondaryLabel
                          : detail
                            ? 'detail'
                            : 'search'
                }
            >
                {secondary ? (
                    secondary
                ) : contribution ? (
                    <ContributionForm {...contribution} mobile />
                ) : detail && browse ? (
                    <PlaceDetails browse={browse} mobile onEdit={editPlace} />
                ) : detail ? (
                    <div className="mobile-detail-content">
                        {sample && (
                            <>
                                <h1>{sample.place.title}</h1>
                                <IconButton
                                    className="mobile-place-edit"
                                    icon="mobileEdit"
                                    size={20}
                                    label="Edit place"
                                    available={false}
                                />
                                <PlaceMeta place={sample.place} />
                                <p className="mobile-description">
                                    {sample.place.description.replace(
                                        ' waterfront views',
                                        ' waterfront\nviews',
                                    )}
                                </p>
                                <img
                                    className="mobile-photo"
                                    src={sample.place.mobilePhoto}
                                    alt=""
                                />
                            </>
                        )}
                        <ShareButton mobile />
                        <IconButton
                            className="mobile-bookmark"
                            icon="mobileBookmark"
                            size={28}
                            label="Bookmark place"
                            available={false}
                        />
                    </div>
                ) : (
                    <div
                        className={`mobile-search-content ${hasPlaceResults ? 'has-place-results' : ''}`}
                    >
                        <div className="mobile-logo">{ui.text('Lycoris Maps')}</div>
                        <SearchField mobile value={search} onChange={setSearch} />
                        {!sample ? (
                            <AccountEntry mobile />
                        ) : (
                            <DesignButton
                                className="mobile-avatar"
                                available={false}
                                aria-label={ui.text('Account')}
                            >
                                AA
                            </DesignButton>
                        )}
                        {browse && hasPlaceResults && selectPlace ? (
                            <div
                                inert={snap === 'collapsed'}
                                aria-hidden={snap === 'collapsed' || undefined}
                            >
                                <PlaceResults browse={browse} onSelect={selectPlace} mobile />
                            </div>
                        ) : (
                            <div
                                inert={snap === 'collapsed'}
                                aria-hidden={snap === 'collapsed' || undefined}
                            >
                                <h2 className="mobile-nearby-heading">{ui.text('Find Nearby')}</h2>
                                <NearbyCards
                                    mobile
                                    half={snap === 'half'}
                                    onSelect={chooseCategory}
                                />
                            </div>
                        )}
                        {!hasPlaceResults && (
                            <div inert={snap !== 'full'} aria-hidden={snap !== 'full' || undefined}>
                                {showBookmarks && (
                                    <>
                                        <DesignButton
                                            className="mobile-section-heading mobile-bookmarks-heading"
                                            available={!!openBookmarks}
                                            onClick={openBookmarks}
                                        >
                                            <span>{ui.text('Bookmarks')}</span>
                                            <FigmaIcon name="mobileChevronDark" />
                                        </DesignButton>
                                        {!sample && browse && selectPlace && (
                                            <BookmarksPanel
                                                browse={browse}
                                                onSelect={selectPlace}
                                                mobile
                                                preview
                                            />
                                        )}
                                        {sample && (
                                            <div className="mobile-bookmarks">
                                                {[0, 1].map((index) => (
                                                    <DesignButton
                                                        id={`mobile-place-${index}`}
                                                        className="mobile-place-row"
                                                        key={index}
                                                        onClick={() =>
                                                            openDetails(`mobile-place-${index}`)
                                                        }
                                                    >
                                                        <CategoryBadge category="toilet" />
                                                        <PlaceSummary place={sample.place} />
                                                    </DesignButton>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                                <h2 className="mobile-section-heading mobile-settings-heading">
                                    <span>{ui.text('Settings')}</span>
                                </h2>
                                <SettingsRows mobile />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    )
}
