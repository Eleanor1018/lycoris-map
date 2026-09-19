import { usePreferences } from '@/features/preferences/PreferencesProvider'
import { isSettingsPanel, settingsTitles, SettingsContent } from '@/features/preferences/Settings'
import { useUi } from '@/shared/i18n/ui'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { useNavigate } from 'react-router'
import { MobileSheet } from './MobileSheet'
import { useMobileLayout, useViewportHeight } from './useMobileLayout'
import { MapSurface } from '@/features/map/MapSurface'
import { HeadingPermission } from '@/features/map/HeadingPermission'
import { MapSourcePicker } from '@/features/map/MapSourcePicker'
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
import { useSession } from '@/features/auth/SessionProvider'
import { NearbyResults } from '@/features/places/NearbyResults'
import type { MarkerCategory } from '@/shared/query/keys'
import { BookmarksPanel } from '@/features/bookmarks/BookmarksPanel'
import { useAccountFlow } from '@/features/auth/AccountFlow'
import { useContributions } from '@/features/contributions/ContributionsProvider'
import { contributionBusy } from '@/features/contributions/ContributionStore'
import { checkPoint, draftText } from '@/features/contributions/draft'
const navigation: { panel: Panel; label: string; icon: FigmaIconName }[] = [
    { panel: 'search', label: 'Search', icon: 'navSearch' },
    { panel: 'bookmarks', label: 'Bookmarks', icon: 'navBookmarks' },
    { panel: 'contribute', label: 'Contribute', icon: 'navContribute' },
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
    const ui = useUi()
    const { preferences } = usePreferences()
    const mobile = useMobileLayout()
    const session = useSession()
    const showBookmarks = Boolean(sample) || session.status === 'authenticated'
    const accountFlow = useAccountFlow()
    const contributions = useContributions()
    const contributor = !sample && browse ? contributions.store : null
    const contributionState = contributor ? contributions.state : null
    const {
        panel: requestedPanel,
        open,
        close,
        location,
    } = usePanelRoute(Boolean(sample), mobile ? 'back' : 'dismiss', !!browse)
    const contributionNeedsLogin =
        !sample &&
        !!accountFlow &&
        (requestedPanel === 'contribute' || requestedPanel === 'contribute-form') &&
        !session.scope
    const panel =
        contributionNeedsLogin || (requestedPanel === 'bookmarks' && !showBookmarks)
            ? 'initial'
            : requestedPanel
    const contributionOpen = panel === 'contribute-form' || (mobile && panel === 'contribute')
    const activeRoute = useRef(location.key)
    activeRoute.current = location.key
    const loginRoute = useRef<string | null>(null)
    useEffect(() => {
        if (!contributionNeedsLogin) {
            loginRoute.current = null
            return
        }
        if (session.status === 'checking' || session.busy || loginRoute.current === location.key)
            return
        loginRoute.current = location.key
        const key = location.key
        // The requested route resumes naturally once the session is confirmed.
        // Keep both the picker and composer hidden until then, including deep links.
        accountFlow?.requireLogin(undefined, () => {
            if (activeRoute.current === key) close()
        })
    }, [contributionNeedsLogin, session.status, session.busy, location.key, accountFlow, close])
    useEffect(() => {
        if (mobile && panel === 'contribute') open('contribute-form', 'nav-contribute', true)
    }, [mobile, panel, open])
    const viewportHeight = useViewportHeight()
    const navigate = useNavigate()
    const mobileFixture = Boolean(sample) && location.pathname === '/__design/mobile'
    const params = new URLSearchParams(location.search)
    const snapValue = params.get(mobileFixture ? 'screen' : 'snap')
    const snap: Snap =
        contributionOpen ||
        (mobile && (panel === 'bookmarks' || panel === 'nearby' || isSettingsPanel(panel)))
            ? 'full'
            : snapValue === 'collapsed' || snapValue === 'half' || snapValue === 'full'
              ? snapValue
              : browse && location.pathname === '/search' && params.get('q')?.trim() && !snapValue
                ? 'full'
                : mobile
                  ? 'half'
                  : 'collapsed'
    const [detailHeight, setDetailHeight] = useState(433)
    const [menuHeight, setMenuHeight] = useState<number | null>(null)
    const [nearbyHeight, setNearbyHeight] = useState(326)
    const mainMenu =
        (panel === 'initial' || panel === 'search') &&
        browse?.mode !== 'search' &&
        browse?.mode !== 'cluster'
    const fullSheetHeight = Math.min(
        viewportHeight - 46,
        mainMenu ? (menuHeight ?? Infinity) : Infinity,
    )
    const halfSheetHeight = Math.min(mainMenu ? nearbyHeight : 320, fullSheetHeight)
    const sheetHeight =
        panel === 'details'
            ? Math.min(detailHeight, viewportHeight - 46)
            : snap === 'full'
              ? fullSheetHeight
              : snap === 'half'
                ? halfSheetHeight
                : Math.min(158, viewportHeight - 46)
    const sheetTop = viewportHeight - sheetHeight
    const setSnap = (next: Snap) => {
        const nextParams = new URLSearchParams(location.search)
        nextParams.set(mobileFixture ? 'screen' : 'snap', next)
        void navigate(
            { pathname: location.pathname, search: nextParams.toString(), hash: location.hash },
            { replace: true, state: location.state },
        )
    }
    const map = useRef<LeafletMap | null>(null)
    const onMap = useCallback(
        (value: LeafletMap | null) => {
            map.current = value
            if (
                value &&
                contributor &&
                mobile &&
                contributionOpen &&
                !contributor.getSnapshot().point
            )
                contributor.setPoint(value.getCenter().wrap())
        },
        [contributor, mobile, contributionOpen],
    )
    useEffect(() => {
        if (
            contributor &&
            mobile &&
            contributionOpen &&
            map.current &&
            contributionState?.phase === 'draft' &&
            !contributionState.base &&
            !contributionState.point
        )
            contributor.setPoint(map.current.getCenter().wrap())
    }, [
        contributor,
        mobile,
        contributionOpen,
        contributionState?.round,
        contributionState?.phase,
        contributionState?.base,
        contributionState?.point,
    ])
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
    const nearbyCategory = params.get('nearbyCategory')
    const requestedCategory =
        nearbyCategory === 'baby_room' || nearbyCategory === 'friendly_clinic'
            ? nearbyCategory
            : nearbyCategory === 'accessible_toilet'
              ? nearbyCategory
              : preferences.category
    useEffect(() => {
        // Also initialize a direct Nearby URL once the map has a real center.
        if (panel !== 'nearby' || !browse) return
        if (browse.nearby?.category !== requestedCategory || browse.mode === 'search')
            browse.chooseCategory(requestedCategory)
        else if (browse.mode === 'cluster') browse.showCluster(null)
    }, [panel, browse, requestedCategory])
    const showNearby = (category: MarkerCategory, focusId: string) => {
        browse?.chooseCategory(category)
        open('nearby', focusId, false, undefined, { nearbyCategory: category })
    }
    const chooseCategory = (category: 'toilet' | 'nursing' | 'medical') => {
        showNearby(
            (
                {
                    toilet: 'accessible_toilet',
                    nursing: 'baby_room',
                    medical: 'friendly_clinic',
                } as const
            )[category],
            `${mobile ? 'mobile' : 'desktop'}-nearby-${category}`,
        )
    }
    const selectPlace = useCallback(
        (place: Marker, focusId: string) => {
            open('details', focusId, false, String(place.id))
        },
        [open],
    )
    const [bookmarksSearch, setBookmarksSearch] = useState('')
    const [contributionDraft, setContributionDraft] =
        useState<ContributionDraft>(emptyContributionDraft)
    const [contributionPoint, setContributionPoint] = useState<{ lat: number; lng: number } | null>(
        null,
    )
    const picking =
        panel === 'contribute' &&
        !mobile &&
        !contributionState?.base &&
        (!contributionState || contributionState.phase === 'draft')
    const selectPoint = useCallback(
        (point: { lat: number; lng: number } | null) => {
            if (contributor && point) contributor.setPoint(point)
            else setContributionPoint(point)
            open('contribute-form', 'nav-contribute')
        },
        [open, contributor],
    )
    const startContribution = (phone: boolean) => {
        if (contributor) {
            if (!contributor.beginCreate(browse?.language ?? 'en')) return
            if (phone && map.current) contributor.setPoint(map.current.getCenter().wrap())
            const current = contributor.getSnapshot()
            open(
                phone || current.phase !== 'draft' ? 'contribute-form' : 'contribute',
                phone ? 'mobile-contribute' : 'nav-contribute',
            )
        } else {
            setContributionPoint(null)
            open(
                phone ? 'contribute-form' : 'contribute',
                phone ? 'mobile-contribute' : 'nav-contribute',
            )
        }
    }
    const editPlace = () => {
        if (!contributor || !browse?.detail || !contributor.beginEdit(browse.detail)) return
        open('contribute-form', mobile ? 'mobile-place-edit' : 'desktop-place-edit')
    }
    const submitContribution = (resendUnconfirmed = false) => {
        if (!contributor || !accountFlow) return
        const current = contributor.getSnapshot(),
            key = location.key
        try {
            if (current.phase === 'draft') {
                draftText(current.draft, current.language)
                if (!current.base) checkPoint(current.point)
            }
        } catch (error) {
            contributor.report(error instanceof Error ? error.message : 'Check the form.')
            return
        }
        accountFlow.requireLogin((scope) => {
            if (key === activeRoute.current && current.round === contributor.getSnapshot().round)
                void contributor.submit(scope, resendUnconfirmed)
        })
    }
    const contribution = {
        draft: contributionState?.draft ?? contributionDraft,
        onChange: contributor?.change ?? setContributionDraft,
        point: contributionState?.point ?? contributionPoint,
        close,
        state: contributionState,
        onSubmit: contributor ? submitContribution : undefined,
        onPhoto: contributor
            ? (file: File | null) => {
                  void contributor.photo(file)
              }
            : undefined,
        onView: () => {
            const saved = contributor?.getSnapshot().saved
            if (saved) {
                selectPlace(saved, 'nav-contribute')
                browse?.focusPoint(saved)
            }
        },
    }
    return (
        <main
            lang={ui.language}
            id="map-shell"
            tabIndex={-1}
            className="map-shell"
            data-panel={panel}
            data-mobile={mobile}
            data-snap={snap}
            style={mobile ? ({ '--sheet-height': `${sheetHeight}px` } as CSSProperties) : undefined}
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
                                  sharedTarget:
                                      contributionOpen && contributionState?.point
                                          ? {
                                                ...contributionState.point,
                                                title: 'Contribution location',
                                                showLabel: false,
                                            }
                                          : sharedTarget,
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
                <aside className="desktop-nav" aria-label={ui.text('Main navigation')}>
                    <div className="desktop-logo">{ui.text('Lycoris Maps')}</div>
                    <nav>
                        {navigation
                            .filter((item) => item.panel !== 'bookmarks' || showBookmarks)
                            .map((item) => (
                                <DesignButton
                                    key={item.panel}
                                    id={`nav-${item.panel}`}
                                    className={`nav-row ${panel === item.panel || (panel === 'nearby' && item.panel === 'search') || (panel === 'contribute-form' && item.panel === 'contribute') ? 'selected' : ''}`}
                                    aria-current={
                                        panel === item.panel ||
                                        (panel === 'nearby' && item.panel === 'search') ||
                                        (panel === 'contribute-form' && item.panel === 'contribute')
                                            ? 'page'
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (item.panel === 'contribute') {
                                            startContribution(false)
                                            return
                                        }
                                        if (item.panel === 'search') browse?.clearResults()
                                        open(item.panel, `nav-${item.panel}`)
                                    }}
                                >
                                    <FigmaIcon name={item.icon} />
                                    <span>
                                        {panel === 'settings' && item.panel === 'bookmarks'
                                            ? ui.text('Bookmarks')
                                            : ui.message(item.label)}
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
                    open={open}
                    close={close}
                    contribution={contribution}
                    browse={browse}
                    selectPlace={selectPlace}
                    chooseCategory={browse ? chooseCategory : undefined}
                    editPlace={
                        contributor && !contributionBusy(contributionState!.phase)
                            ? editPlace
                            : undefined
                    }
                />
            )}
            {mobile && (
                <MobileSheet
                    showBookmarks={showBookmarks}
                    snap={snap}
                    setSnap={setSnap}
                    detail={panel === 'details'}
                    sample={sample}
                    search={browse?.search ?? search}
                    setSearch={updateSearch}
                    openDetails={(focusId) => open('details', focusId)}
                    close={close}
                    height={sheetHeight}
                    halfHeight={halfSheetHeight}
                    fullHeight={fullSheetHeight}
                    onDetailHeight={setDetailHeight}
                    onMenuHeight={setMenuHeight}
                    onNearbyHeight={setNearbyHeight}
                    contribution={contributionOpen ? contribution : undefined}
                    browse={browse}
                    selectPlace={selectPlace}
                    chooseCategory={browse ? chooseCategory : undefined}
                    editPlace={
                        contributor && !contributionBusy(contributionState!.phase)
                            ? editPlace
                            : undefined
                    }
                    secondaryLabel={
                        isSettingsPanel(panel)
                            ? settingsTitles[panel]
                            : panel === 'nearby'
                              ? 'Nearby'
                              : 'Bookmarks'
                    }
                    secondary={
                        isSettingsPanel(panel) ? (
                            <SettingsContent panel={panel} mobile />
                        ) : panel === 'nearby' && browse ? (
                            <NearbyResults browse={browse} onSelect={selectPlace} mobile />
                        ) : panel === 'bookmarks' && browse && !sample ? (
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
                <MapSourcePicker mobile={mobile} resetKey={`${panel}:${snap}`} />
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
                        id="mobile-nearby"
                        icon="radar"
                        size={20}
                        label="Find nearby"
                        available={!!browse}
                        onClick={() => {
                            showNearby(preferences.category, 'mobile-nearby')
                        }}
                    />
                    <IconButton
                        id="mobile-contribute"
                        icon="mobileContribute"
                        size={20}
                        label="Contribute"
                        onClick={() => {
                            startContribution(true)
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
            <div className="map-notices">
                {!sample && <HeadingPermission />}
                {browse && (browse.location.error || browse.location.pending) && (
                    <MapNotice
                        key={browse.location.pending ? 'locating' : browse.location.error}
                        message={
                            browse.location.pending
                                ? 'Finding your location…'
                                : browse.location.error!
                        }
                    />
                )}
                {browse?.mode === 'map' && browse.state.error && (
                    <MapNotice
                        key={`places:${browse.state.error}`}
                        message={browse.state.error}
                        onRetry={browse.state.retry}
                    />
                )}
            </div>
        </main>
    )
}

function MapNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
    const ui = useUi()
    const [dismissed, setDismissed] = useState(false)
    if (dismissed) return null
    return (
        <div className="map-notice" role="status">
            <div className="map-notice-content">
                {ui.message(message)}
                {onRetry && (
                    <DesignButton className="map-notice-retry" onClick={onRetry}>
                        {ui.text('Try again')}
                    </DesignButton>
                )}
            </div>
            <IconButton
                className="map-notice-close"
                icon="close"
                size={16}
                label="Dismiss notification"
                onClick={() => setDismissed(true)}
            />
        </div>
    )
}
