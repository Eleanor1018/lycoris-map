import { useCallback, useRef, useState } from 'react'
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
const navigation: { panel: Panel; label: string; icon: FigmaIconName }[] = [
    { panel: 'search', label: 'Search', icon: 'navSearch' },
    { panel: 'bookmarks', label: 'Bookmarks', icon: 'navBookmarks' },
    { panel: 'contribute', label: 'Contribute', icon: 'navContribute' },
    { panel: 'languages', label: 'Languages', icon: 'navLanguages' },
    { panel: 'settings', label: 'Settings', icon: 'navSettings' },
]
export function MapShell({ sample }: { sample?: DesignSample }) {
    const { panel, open, close, location } = usePanelRoute(Boolean(sample))
    const mobile = useMobileLayout()
    const viewportHeight = useViewportHeight()
    const navigate = useNavigate()
    const mobileFixture = Boolean(sample) && location.pathname === '/__design/mobile'
    const params = new URLSearchParams(location.search)
    const snapValue = params.get(mobileFixture ? 'screen' : 'snap')
    const snap: Snap = snapValue === 'half' || snapValue === 'full' ? snapValue : 'collapsed'
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
    const [search, setSearch] = useState('')
    const [bookmarksSearch, setBookmarksSearch] = useState('')
    const [language, setLanguage] = useState<'en' | 'zh'>('en')
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
                <div className="design-map" aria-hidden="true">
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
                <MapSurface onMap={onMap} />
            )}
            {!mobile && (
                <aside className="desktop-nav" aria-label="Main navigation">
                    <div className="desktop-logo">Lycoris Maps</div>
                    <nav>
                        {navigation.map((item) => (
                            <DesignButton
                                key={item.panel}
                                id={`nav-${item.panel}`}
                                className={`nav-row ${panel === item.panel ? 'selected' : ''}`}
                                aria-current={panel === item.panel ? 'page' : undefined}
                                onClick={() => open(item.panel, `nav-${item.panel}`)}
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
                    {sample && (
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
                    search={search}
                    setSearch={setSearch}
                    bookmarksSearch={bookmarksSearch}
                    setBookmarksSearch={setBookmarksSearch}
                    language={language}
                    setLanguage={setLanguage}
                    open={open}
                    close={close}
                />
            )}
            {mobile && (
                <MobileSheet
                    snap={snap}
                    setSnap={setSnap}
                    detail={panel === 'details'}
                    sample={sample}
                    search={search}
                    setSearch={setSearch}
                    openDetails={(focusId) => open('details', focusId)}
                    close={close}
                    dragHeight={dragHeight}
                    setDragHeight={setDragHeight}
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
                    available={false}
                />
            </div>
            {mobile ? (
                <div className="map-tools mobile-tools" inert={sheetTop < 240}>
                    <IconButton icon="radar" size={20} label="Find nearby" available={false} />
                    <IconButton
                        icon="mobileContribute"
                        size={20}
                        label="Contribute"
                        available={false}
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
        </main>
    )
}
