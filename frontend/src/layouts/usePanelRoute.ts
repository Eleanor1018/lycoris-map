import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { parsePanel, type Panel } from './types'
import { isSettingsPanel } from '@/features/preferences/Settings'
type ReturnState = { owner: string; focusId: string; replaceClose: boolean }
function readReturnState(value: unknown): ReturnState | null {
    if (!value || typeof value !== 'object' || !('owner' in value) || !('focusId' in value))
        return null
    return typeof value.owner === 'string' && typeof value.focusId === 'string'
        ? {
              owner: value.owner,
              focusId: value.focusId,
              replaceClose: 'replaceClose' in value && value.replaceClose === true,
          }
        : null
}
export function usePanelRoute(
    design: boolean,
    closeBehavior: 'dismiss' | 'back',
    markerLinks = false,
) {
    const location = useLocation()
    const navigate = useNavigate()
    const owner = useRef(crypto.randomUUID())
    const restoreFocus = useRef<string | null>(null)
    const field = design ? 'screen' : 'panel'
    const params = new URLSearchParams(location.search)
    const rawPanel = params.get(field)
    const panel =
        markerLinks && !design && rawPanel === null
            ? params.has('markerId')
                ? 'details'
                : location.pathname === '/search'
                  ? 'search'
                  : 'initial'
            : parsePanel(rawPanel)
    const open = useCallback(
        (
            next: Panel,
            focusId = '',
            replace = false,
            markerId?: string,
            query?: Record<string, string>,
        ) => {
            const params = new URLSearchParams(location.search)
            if (next === panel && (markerId === undefined || markerId === params.get('markerId')))
                return
            if (next === 'initial') params.delete(field)
            else params.set(field, next)
            if (markerId !== undefined) {
                params.set('markerId', markerId)
                for (const field of ['lat', 'lng', 'title']) params.delete(field)
            } else if (markerLinks && panel === 'details' && next !== 'details')
                params.delete('markerId')
            if (next === 'nearby' && markerLinks)
                for (const field of ['markerId', 'lat', 'lng', 'title']) params.delete(field)
            for (const [key, value] of Object.entries(query ?? {})) params.set(key, value)
            const previous = readReturnState(location.state)
            const finishingPicker = panel === 'contribute' && next === 'contribute-form'
            const ownedPicker = previous?.owner === owner.current
            navigate(
                { pathname: location.pathname, search: params.toString(), hash: location.hash },
                {
                    // Picking and composing are one contribution flow in browser history.
                    replace: replace || finishingPicker,
                    state: {
                        owner: owner.current,
                        focusId,
                        replaceClose: finishingPicker && !ownedPicker,
                    },
                },
            )
        },
        [field, location, navigate, panel, markerLinks],
    )
    const close = useCallback(() => {
        const state = readReturnState(location.state)
        if (closeBehavior === 'back' && state?.owner === owner.current && !state.replaceClose) {
            restoreFocus.current = state.focusId
            void navigate(-1)
        } else {
            const params = new URLSearchParams(location.search)
            params.delete(field)
            if (markerLinks && location.pathname === '/search') params.set(field, 'initial')
            if (markerLinks && panel === 'details')
                for (const field of ['markerId', 'lat', 'lng', 'title']) params.delete(field)
            if (
                markerLinks &&
                closeBehavior === 'back' &&
                (panel === 'search' || panel === 'nearby')
            )
                params.set('snap', 'collapsed')
            const desktopPanel =
                panel === 'contribute-form'
                    ? 'contribute'
                    : panel === 'nearby'
                      ? 'search'
                      : panel === 'details'
                        ? state?.focusId === 'desktop-bookmark-place'
                            ? 'bookmarks'
                            : 'search'
                        : isSettingsPanel(panel) && panel !== 'languages'
                          ? 'settings'
                          : panel
            restoreFocus.current =
                closeBehavior === 'dismiss' ? `nav-${desktopPanel}` : 'nav-search'
            void navigate(
                { pathname: location.pathname, search: params.toString(), hash: location.hash },
                { replace: true, state: null },
            )
        }
    }, [closeBehavior, field, location, navigate, panel, markerLinks])
    useEffect(() => {
        if (restoreFocus.current !== null) {
            const target = document.getElementById(restoreFocus.current)
            if (target && target.getClientRects().length > 0) target.focus()
            else document.getElementById('map-shell')?.focus()
            restoreFocus.current = null
        }
    }, [location.key])
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (
                event.defaultPrevented ||
                (event.target instanceof Element && event.target.closest('[data-account-dialog]'))
            )
                return
            if (event.key === 'Escape' && !event.isComposing && panel !== 'initial') {
                event.preventDefault()
                close()
            }
        }
        window.addEventListener('keydown', escape)
        return () => window.removeEventListener('keydown', escape)
    }, [panel, close])
    return { panel, open, close, location }
}
