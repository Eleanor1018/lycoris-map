import { useRef, type PointerEvent } from 'react'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import { PlaceMeta, PlaceSummary, ShareButton } from './DesktopPanel'
import { CategoryBadge, DesignButton, IconButton, NearbyCards, SearchField } from './primitives'
import type { DesignSample, Snap } from './types'

export function MobileSheet({
    snap,
    setSnap,
    detail,
    sample,
    search,
    setSearch,
    openDetails,
    close,
    dragHeight,
    setDragHeight,
}: {
    snap: Snap
    setSnap: (value: Snap) => void
    detail: boolean
    sample: DesignSample | undefined
    search: string
    setSearch: (value: string) => void
    openDetails: (focusId: string) => void
    close: () => void
    dragHeight: number | null
    setDragHeight: (height: number | null) => void
}) {
    const sheet = useRef<HTMLElement>(null)
    const gesture = useRef<{ id: number; y: number; height: number; moved: boolean } | null>(null)
    const suppressClick = useRef(false)
    const cycle = () =>
        detail
            ? close()
            : setSnap(snap === 'collapsed' ? 'half' : snap === 'half' ? 'full' : 'collapsed')
    const begin = (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !sheet.current) return
        gesture.current = {
            id: event.pointerId,
            y: event.clientY,
            height: sheet.current.getBoundingClientRect().height,
            moved: false,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent<HTMLButtonElement>) => {
        const current = gesture.current
        if (!current || current.id !== event.pointerId) return
        const delta = current.y - event.clientY
        if (Math.abs(delta) > 5) current.moved = true
        if (current.moved)
            setDragHeight(
                Math.max(
                    Math.min(158, window.innerHeight - 46),
                    Math.min(window.innerHeight - 54, current.height + delta),
                ),
            )
    }
    const finish = (event: PointerEvent<HTMLButtonElement>) => {
        const current = gesture.current
        if (!current || current.id !== event.pointerId) return
        if (current.moved) {
            suppressClick.current = true
            if (detail) {
                if (event.clientY - current.y > 48) close()
            } else {
                const height = current.height + current.y - event.clientY
                const choices: [Snap, number][] = [
                    ['collapsed', Math.min(158, window.innerHeight - 46)],
                    ['half', Math.min(320, window.innerHeight - 46)],
                    ['full', window.innerHeight - 54],
                ]
                choices.sort((a, b) => Math.abs(a[1] - height) - Math.abs(b[1] - height))
                setSnap(choices[0]?.[0] ?? snap)
            }
        }
        gesture.current = null
        setDragHeight(null)
    }
    return (
        <section
            ref={sheet}
            className={`mobile-sheet ${detail ? 'mobile-detail' : ''}`}
            data-snap={snap}
            aria-label={detail ? 'Details' : 'Search positions'}
            style={dragHeight === null ? undefined : { height: dragHeight }}
        >
            <DesignButton
                id="sheet-handle"
                className="sheet-handle"
                aria-label={detail ? 'Close details' : `Change panel height (${snap})`}
                aria-expanded={detail || snap !== 'collapsed'}
                onPointerDown={begin}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={() => {
                    gesture.current = null
                    setDragHeight(null)
                }}
                onClick={() => {
                    if (suppressClick.current) {
                        suppressClick.current = false
                        return
                    }
                    cycle()
                }}
                onKeyDown={(event) => {
                    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) {
                        event.preventDefault()
                        event.stopPropagation()
                        if (detail) {
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
            <div className="sheet-scroll" key={detail ? 'detail' : snap}>
                {detail ? (
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
                    <div className="mobile-search-content">
                        <div className="mobile-logo">Lycoris Maps</div>
                        <SearchField mobile value={search} onChange={setSearch} />
                        {sample && (
                            <DesignButton
                                className="mobile-avatar"
                                available={false}
                                aria-label="Account"
                            >
                                AA
                            </DesignButton>
                        )}
                        {snap !== 'collapsed' && (
                            <>
                                <h2 className="mobile-nearby-heading">Find Nearby</h2>
                                <NearbyCards mobile half={snap === 'half'} />
                            </>
                        )}
                        {snap === 'full' && (
                            <>
                                <DesignButton
                                    className="mobile-section-heading mobile-bookmarks-heading"
                                    available={false}
                                >
                                    <span>Bookmarks</span>
                                    <FigmaIcon name="mobileChevronDark" />
                                </DesignButton>
                                {sample && (
                                    <div className="mobile-bookmarks">
                                        {[0, 1, 2].map((index) => (
                                            <DesignButton
                                                id={`mobile-place-${index}`}
                                                className="mobile-place-row"
                                                key={index}
                                                onClick={() => openDetails(`mobile-place-${index}`)}
                                            >
                                                <CategoryBadge category="toilet" />
                                                <PlaceSummary place={sample.place} />
                                            </DesignButton>
                                        ))}
                                    </div>
                                )}
                                <DesignButton
                                    className="mobile-section-heading mobile-settings-heading"
                                    available={false}
                                >
                                    <span>Settings</span>
                                    <FigmaIcon name="mobileChevronDark" />
                                </DesignButton>
                                <DesignButton
                                    className="setting-card mobile-language"
                                    available={false}
                                >
                                    <span>Choose Language</span>
                                    <span className="setting-value">English</span>
                                    <span className="chevron-slot">
                                        <FigmaIcon name="mobileChevronBlue" />
                                    </span>
                                </DesignButton>
                                <DesignButton
                                    className="setting-card mobile-about"
                                    available={false}
                                >
                                    <span>About Lycoris Maps</span>
                                    <span className="chevron-slot">
                                        <FigmaIcon name="mobileChevronBlue" />
                                    </span>
                                </DesignButton>
                            </>
                        )}
                    </div>
                )}
            </div>
        </section>
    )
}
