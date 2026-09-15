import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { useNavigate } from 'react-router'
import { MobileSheet } from './MobileSheet'
import { useMobileLayout, useViewportHeight } from './useMobileLayout'
import { MapSurface } from '@/features/map/MapSurface'
import { FigmaIcon, type FigmaIconName } from '@/shared/ui/figma-icon'
import { DesignButton, IconButton } from './primitives'
import { DesktopPanel } from './DesktopPanel'
import { usePanelRoute } from './usePanelRoute'
import type { DesignSample, Panel, Snap } from './types'
import './map-shell.css'
import { emptyContributionDraft, type ContributionDraft } from './ContributionForm'
import type { PlaceBrowse } from '@/features/places/usePlaceBrowse'
import type { SharedTarget } from '@/features/map/MapPlaces'
import type { Marker } from '@/shared/api/markers'
import { AccountEntry } from '@/features/auth/AccountEntry'
import { BookmarksPanel } from '@/features/bookmarks/BookmarksPanel'
import { useAccountFlow } from '@/features/auth/AccountFlow'
const navigation: { panel: Panel; label: string; icon: FigmaIconName }[] = [
    { panel: 'search', label: 'Search', icon: 'navSearch' },
    { panel: 'bookmarks', label: 'Bookmarks', icon: 'navBookmarks' },
    { panel: 'contribute', label: 'Contribute', icon: 'navContribute' },
    { panel: 'languages', label: 'Languages', icon: 'navLanguages' },
    { panel: 'settings', label: 'Settings', icon: 'navSettings' },
]
export function MapShell({
    sample,
    browse,
    sharedTarget,
}: {
    sample?: DesignSample
    browse?: PlaceBrowse
    sharedTarget?: SharedTarget | undefined
}) {
    const mobile = useMobileLayout()
    const accountFlow = useAccountFlow()
    const { panel, open, close, location } = usePanelRoute(
        Boolean(sample),
        mobile ? 'back' : 'dismiss',
        !!browse,
    )
    const contributionOpen = panel === 'contribute-form' || (mobile && panel === 'contribute')
    useEffect(() => {
        if (mobile && panel === 'contribute') open('contribute-form', 'nav-contribute', true)
    }, [mobile, panel, open])
    const viewportHeight = useViewportHeight()
    const navigate = useNavigate()
    const mobileFixture = Boolean(sample) && location.pathname === '/__design/mobile'
    const params = new URLSearchParams(location.search)
    const snapValue = params.get(mobileFixture ? 'screen' : 'snap')
    const snap: Snap =
        contributionOpen || (mobile && panel === 'bookmarks')
            ? 'full'
            : snapValue === 'half' || snapValue === 'full'
              ? snapValue
              : browse && location.pathname === '/search' && params.get('q')?.trim() && !snapValue
                ? 'full'
                : 'collapsed'
    const [dragHeight, setDragHeight] = useState<number | null>(null)
    const sheetHeight =
        dragHeight ??
        (panel === 'details'
            ? Math.min(433, viewportHeight - 46)
            : snap === 'full'
              ? viewportHeight - 54
              : Math.min(snap === 'half' ? 320 : 158, viewportHeight - 46))
    const sheetTop = viewportHeight - sheetHeight - (panel !== 'details' && snap === 'full' ? 8 : 0)
    const setSnap = (next: Snap) => {
        const nextParams = new URLSearchParams(location.search)
        nextParams.set(mobileFixture ? 'screen' : 'snap', next)
        void navigate(
            { pathname: location.pathname, search: nextParams.toString(), hash: location.hash },
            { replace: true, state: location.state },
        )
    }
    const map = useRef<LeafletMap | null>(null)
    const onMap = useCallback((value: LeafletMap | null) => {
        map.current = value
    }, [])
    const showMobileSearch = (nextSnap: Snap) => {
        const next = new URLSearchParams(location.search)
        next.set('panel', 'search')
        next.set('snap', nextSnap)
        for (const field of ['markerId', 'lat', 'lng', 'title']) next.delete(field)
        void navigate(
            { pathname: location.pathname, search: next.toString(), hash: location.hash },
            { replace: true, state: null },
        )
    }
    const [search, setSearch] = useState('')
    const updateSearch = (value: string) => {
        if (browse) {
            browse.setSearch(value)
            if (mobile && (snap !== 'full' || panel !== 'search')) showMobileSearch('full')
        } else setSearch(value)
    }
    const chooseCategory = (category: 'toilet' | 'nursing' | 'medical') => {
        browse?.chooseCategory(
            (
                {
                    toilet: 'accessible_toilet',
                    nursing: 'baby_room',
                    medical: 'friendly_clinic',
                } as const
            )[category],
        )
        if (mobile) showMobileSearch('full')
        else open('search', 'nav-search')
    }
    const selectPlace = useCallback(
        (place: Marker, focusId: string) => {
            open('details', focusId, false, String(place.id))
        },
        [open],
    )
    const [bookmarksSearch, setBookmarksSearch] = useState('')
    const [language, setLanguage] = useState<'en' | 'zh'>('en')
    const [contributionDraft, setContributionDraft] =
        useState<ContributionDraft>(emptyContributionDraft)
    const [contributionPoint, setContributionPoint] = useState<{ lat: number; lng: number } | null>(
        null,
    )
    const picking = panel === 'contribute' && !mobile
    const selectPoint = useCallback(
        (point: { lat: number; lng: number } | null) => {
            setContributionPoint(point)
            open('contribute-form', 'nav-contribute')
        },
        [open],
    )
    const contribution = {
        draft: contributionDraft,
        onChange: setContributionDraft,
        point: contributionPoint,
        close,
    }
    return (
        <main
            lang="en"
            id="map-shell"
            tabIndex={-1}
            className="map-shell"
            data-panel={panel}
            data-mobile={mobile}
            data-snap={snap}
        >
            {sample ? (
                <div
                    className="design-map"
                    aria-hidden={!picking || undefined}
                    role={picking ? 'button' : undefined}
                    tabIndex={picking ? 0 : undefined}
                    aria-label={
                        picking ? 'Choose contribution location in design preview' : undefined
                    }
                    onClick={picking ? () => selectPoint(null) : undefined}
                    onKeyDown={
                        picking
                            ? (event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      selectPoint(null)
                                  }
                              }
                            : undefined
                    }
                >
                    {mobile ? (
                        <div className="mobile-map-crop">
                            <img className="mobile-map-image" src={sample.maps.mobile} alt="" />
                        </div>
                    ) : (
                        <img className="desktop-map-image" src={sample.maps.desktop} alt="" />
                    )}
                    {((!mobile && (panel === 'initial' || panel === 'details')) ||
                        (mobile && snap !== 'full')) && (
                        <img
                            className={mobile ? 'mobile-pin' : 'desktop-pin'}
                            src={mobile ? sample.maps.mobilePin : sample.maps.desktopPin}
                            alt=""
                        />
                    )}
                    {panel === 'details' && (
                        <img
                            className={mobile ? 'mobile-place-pin' : 'desktop-place-pin'}
                            src={mobile ? sample.maps.mobilePlace : sample.maps.desktopPlace}
                            alt=""
                        />
                    )}
                </div>
            ) : (
                <MapSurface
                    onMap={onMap}
                    onPick={picking ? selectPoint : undefined}
                    places={
                        browse
                            ? {
                                  markers: browse.markers,
                                  selected: browse.detail,
                                  sharedTarget,
                                  position: browse.location.position,
                                  focus: browse.focus,
                                  onView: browse.onView,
                                  onSelect: selectPlace,
                                  onCluster: (ids) => {
                                      browse.showCluster(ids)
                                      if (mobile) showMobileSearch('full')
                                      else open('search', 'nav-search')
                                  },
                                  padding: {
                                      left: mobile
                                          ? 16
                                          : panel === 'initial' || panel === 'contribute'
                                            ? 256
                                            : 576,
                                      right: mobile ? 64 : 80,
                                      top: mobile ? 54 : 64,
                                      bottom: mobile ? sheetHeight + 16 : 40,
                                  },
                              }
                            : undefined
                    }
                />
            )}
            {!mobile && (
                <aside className="desktop-nav" aria-label="Main navigation">
                    <div className="desktop-logo">Lycoris Maps</div>
                    <nav>
                        {navigation.map((item) => (
                            <DesignButton
                                key={item.panel}
                                id={`nav-${item.panel}`}
                                className={`nav-row ${panel === item.panel || (panel === 'contribute-form' && item.panel === 'contribute') ? 'selected' : ''}`}
                                aria-current={
                                    panel === item.panel ||
                                    (panel === 'contribute-form' && item.panel === 'contribute')
                                        ? 'page'
                                        : undefined
                                }
                                onClick={() => {
                                    if (item.panel === 'contribute') setContributionPoint(null)
                                    if (item.panel === 'search') browse?.clearResults()
                                    open(item.panel, `nav-${item.panel}`)
                                }}
                            >
                                <FigmaIcon name={item.icon} />
                                <span>
                                    {panel === 'settings' && item.panel === 'bookmarks'
                                        ? 'Bookmarked'
                                        : item.label}
                                </span>
                            </DesignButton>
                        ))}
                    </nav>
                    {!sample ? (
                        <AccountEntry />
                    ) : (
                        <div className="desktop-account">
                            <span className="account-avatar" />
                            <div>
                                <div className="account-name">{sample.account.name}</div>
                                <div className="account-handle">{sample.account.handle}</div>
                            </div>
                            <IconButton
                                className="account-more"
                                icon="accountMore"
                                label="Account menu"
                                available={false}
                            />
                        </div>
                    )}
                </aside>
            )}
            {!mobile && (
                <DesktopPanel
                    panel={panel}
                    sample={sample}
                    search={browse?.search ?? search}
                    setSearch={updateSearch}
                    bookmarksSearch={bookmarksSearch}
                    setBookmarksSearch={setBookmarksSearch}
                    language={language}
                    setLanguage={setLanguage}
                    open={open}
                    close={close}
                    contribution={contribution}
                    browse={browse}
                    selectPlace={selectPlace}
                    chooseCategory={browse ? chooseCategory : undefined}
                />
            )}
            {mobile && (
                <MobileSheet
                    snap={snap}
                    setSnap={setSnap}
                    detail={panel === 'details'}
                    sample={sample}
                    search={browse?.search ?? search}
                    setSearch={updateSearch}
                    openDetails={(focusId) => open('details', focusId)}
                    close={close}
                    dragHeight={dragHeight}
                    setDragHeight={setDragHeight}
                    contribution={contributionOpen ? contribution : undefined}
                    browse={browse}
                    selectPlace={selectPlace}
                    chooseCategory={browse ? chooseCategory : undefined}
                    secondary={
                        panel === 'bookmarks' && browse && !sample ? (
                            <BookmarksPanel browse={browse} onSelect={selectPlace} mobile />
                        ) : undefined
                    }
                    openBookmarks={
                        !sample
                            ? () =>
                                  accountFlow?.requireLogin(() =>
                                      open('bookmarks', 'mobile-account'),
                                  )
                            : undefined
                    }
                />
            )}
            <div className="map-tools top-tools" inert={mobile && sheetTop < 142}>
                <IconButton
                    icon={mobile ? 'mobileMap' : 'map'}
                    size={20}
                    label="Map source"
                    available={false}
                />
                <IconButton
                    icon={mobile ? 'mobileDirection' : 'direction'}
                    size={20}
                    label="Locate me"
                    available={!!browse && !browse.location.pending}
                    aria-busy={browse?.location.pending || undefined}
                    onClick={() => browse?.location.locate()}
                />
            </div>
            {mobile ? (
                <div className="map-tools mobile-tools" inert={sheetTop < 240}>
                    <IconButton
                        icon="radar"
                        size={20}
                        label="Find nearby"
                        available={!!browse}
                        onClick={() => {
                            browse?.clearResults()
                            showMobileSearch('half')
                        }}
                    />
                    <IconButton
                        id="mobile-contribute"
                        icon="mobileContribute"
                        size={20}
                        label="Contribute"
                        onClick={() => {
                            setContributionPoint(null)
                            open('contribute-form', 'mobile-contribute')
                        }}
                    />
                </div>
            ) : (
                <div className="map-tools zoom-tools">
                    <IconButton
                        icon="plus"
                        label="Zoom in"
                        onClick={() => map.current?.zoomIn()}
                        available={!sample}
                    />
                    <IconButton
                        icon="minusButton"
                        size={44}
                        label="Zoom out"
                        onClick={() => map.current?.zoomOut()}
                        available={!sample}
                    />
                </div>
            )}
            {browse && (browse.location.error || browse.location.pending) && (
                <p className="map-location-status" role="status">
                    {browse.location.pending ? 'Finding your location…' : browse.location.error}
                </p>
            )}
            {browse?.mode === 'map' && browse.state.error && (
                <div className="map-read-status" role="status">
                    {browse.state.error}{' '}
                    <DesignButton onClick={browse.state.retry}>Try again</DesignButton>
                </div>
            )}
        </main>
    )
}
