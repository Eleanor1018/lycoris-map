import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { MapCanvas } from './MapCanvas'
import {
    CONTROL_MARKER_ID,
    createSyntheticMarkers,
    findMarker,
    SYNTHETIC_MARKER_COUNT,
    type SyntheticMarker,
} from './syntheticMarkers'
import { useLanguage } from '@/shared/i18n'
import { Button } from '@/shared/ui'

const HALF = Math.floor(SYNTHETIC_MARKER_COUNT / 2)

type MarkerState = {
    markers: readonly SyntheticMarker[]
    /** Monotonic count of applied control-marker updates. */
    updateCount: number
}

type MarkerAction =
    | { type: 'updateFirst' }
    | { type: 'removeHalf' }
    | { type: 'restoreAll'; markers: readonly SyntheticMarker[] }

/**
 * Pure reducer: StrictMode replaying an action cannot double-toggle, because the
 * transition is a function of the previous state only.
 */
function markerReducer(state: MarkerState, action: MarkerAction): MarkerState {
    switch (action.type) {
        case 'updateFirst': {
            const updateCount = state.updateCount + 1
            return {
                updateCount,
                markers: state.markers.map((marker) =>
                    marker.id === CONTROL_MARKER_ID
                        ? {
                              ...marker,
                              // id and version intentionally stay unchanged.
                              title: {
                                  zh: `合成点位 ${marker.id}（已更新 ${updateCount}）`,
                                  en: `Synthetic point ${marker.id} (updated ${updateCount})`,
                              },
                              isActive: !marker.isActive,
                          }
                        : marker,
                ),
            }
        }
        case 'removeHalf':
            return { ...state, markers: state.markers.slice(0, HALF) }
        case 'restoreAll':
            return { markers: action.markers, updateCount: state.updateCount }
        default:
            return state
    }
}

/**
 * S1 development-only map spike (`/__dev/map-spike`).
 *
 * Proves that Leaflet 1.9.4 + React Leaflet 5 + React 19.3 + TS 7 keep a single
 * persistent map while language, panel visibility, marker field updates and
 * marker add/remove happen. It is NOT the S2 Figma map shell and NOT a product
 * screen: no real API data, no login, no favourites/contributions.
 */
export function MapSpikePage() {
    const { language, setPreference, t } = useLanguage()
    const initialMarkers = useMemo(() => createSyntheticMarkers(), [])
    const [state, dispatch] = useReducer(markerReducer, {
        markers: initialMarkers,
        updateCount: 0,
    })
    const [panelVisible, setPanelVisible] = useState(true)
    const [updateDuration, setUpdateDuration] = useState<number | null>(null)
    const rafRef = useRef<number | null>(null)

    // Cancel any pending frame on unmount so no state write outlives the tree.
    useEffect(() => {
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
    }, [])

    const controlMarker = findMarker(state.markers, CONTROL_MARKER_ID)

    const toggleLanguage = useCallback(() => {
        setPreference(language === 'zh' ? 'en' : 'zh')
    }, [language, setPreference])

    /**
     * Update the control marker's display fields while keeping id/version.
     *
     * The duration measures dispatch -> next animation frame only. It is NOT a
     * GPU or full-map-render benchmark; the sample is local and synthetic.
     */
    const updateFirstMarker = useCallback(() => {
        const startedAt = performance.now()
        dispatch({ type: 'updateFirst' })
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            setUpdateDuration(performance.now() - startedAt)
        })
    }, [])

    const removeHalf = useCallback(() => dispatch({ type: 'removeHalf' }), [])

    const restoreAll = useCallback(
        () => dispatch({ type: 'restoreAll', markers: initialMarkers }),
        [initialMarkers],
    )

    const resetView = useCallback(() => {
        window.dispatchEvent(new CustomEvent('lycoris:spike-reset-view'))
    }, [])

    return (
        <div className="relative h-dvh w-full overflow-hidden" data-testid="map-spike">
            <div className="absolute inset-0">
                <MapCanvas markers={state.markers} language={language} />
            </div>

            {panelVisible ? (
                <aside
                    data-testid="spike-panel"
                    // On phone-sized viewports the panel stops ~100px above the
                    // bottom so Leaflet attribution and the map evidence stay
                    // visible and the attribution link stays clickable. It is
                    // still full height on desktop-sized viewports.
                    className="absolute top-0 left-0 z-[1000] flex max-h-[calc(100%-6.25rem)] w-[280px] flex-col gap-3 overflow-y-auto p-4 md:max-h-full"
                    style={{ background: 'var(--ui-nav-surface)' }}
                >
                    <header className="flex flex-col gap-1">
                        <h1 className="text-lg" style={{ fontFamily: 'var(--ui-font-logo)' }}>
                            {t('spike.title')}
                        </h1>
                        <p className="text-xs opacity-80">{t('spike.notProduction')}</p>
                    </header>

                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                        <dt>{t('spike.markerCount')}</dt>
                        <dd data-testid="spike-marker-count">{state.markers.length}</dd>
                        <dt>{t('spike.controlMarker')}</dt>
                        <dd data-testid="spike-control-id">{controlMarker?.id ?? '-'}</dd>
                        <dt>{t('spike.controlTitle')}</dt>
                        <dd data-testid="spike-control-title">
                            {controlMarker ? controlMarker.title[language] : '-'}
                        </dd>
                        <dt>{t('spike.controlActive')}</dt>
                        <dd data-testid="spike-control-active">
                            {controlMarker ? String(controlMarker.isActive) : '-'}
                        </dd>
                        <dt>{t('spike.controlVersion')}</dt>
                        <dd data-testid="spike-control-version">{controlMarker?.version ?? '-'}</dd>
                        <dt>{t('spike.updateCost')}</dt>
                        <dd data-testid="spike-update-cost">
                            {updateDuration === null ? '-' : `${updateDuration.toFixed(1)} ms`}
                        </dd>
                    </dl>

                    {/* The panel already carries the synthetic-data notice, so no
                        extra bottom strip is rendered while it is open. */}
                    <p className="text-xs opacity-80">{t('spike.syntheticNotice')}</p>

                    <div className="flex flex-col gap-2">
                        <Button size="sm" variant="outline" onClick={toggleLanguage}>
                            {t('spike.toggleLanguage')} ({language})
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPanelVisible((visible) => !visible)}
                        >
                            {t('spike.togglePanel')}
                        </Button>
                        <Button size="sm" onClick={updateFirstMarker}>
                            {t('spike.updateFirst')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={removeHalf}>
                            {t('spike.removeHalf')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={restoreAll}>
                            {t('spike.restoreAll')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={resetView}>
                            {t('spike.resetView')}
                        </Button>
                    </div>
                </aside>
            ) : null}

            {!panelVisible ? (
                <div className="absolute top-2 left-2 z-[1000] flex max-w-[min(20rem,calc(100%-1rem))] flex-col items-start gap-2">
                    <Button size="sm" onClick={() => setPanelVisible(true)}>
                        {t('spike.showPanel')}
                    </Button>
                    <p
                        className="rounded-md px-2 py-1 text-xs"
                        style={{ background: 'var(--ui-panel-surface)' }}
                        data-testid="spike-notice"
                    >
                        {t('spike.syntheticNotice')}
                    </p>
                </div>
            ) : null}
        </div>
    )
}
