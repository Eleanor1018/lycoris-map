import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { parsePanel, type Panel } from './types'
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
export function usePanelRoute(design: boolean) {
    const location = useLocation()
    const navigate = useNavigate()
    const owner = useRef(crypto.randomUUID())
    const restoreFocus = useRef<string | null>(null)
    const field = design ? 'screen' : 'panel'
    const panel = parsePanel(new URLSearchParams(location.search).get(field))
    const open = useCallback(
        (next: Panel, focusId = '', replace = false) => {
            if (next === panel) return
            const params = new URLSearchParams(location.search)
            if (next === 'initial') params.delete(field)
            else params.set(field, next)
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
        [field, location, navigate, panel],
    )
    const close = useCallback(() => {
        const state = readReturnState(location.state)
        if (state?.owner === owner.current && !state.replaceClose) {
            restoreFocus.current = state.focusId
            void navigate(-1)
        } else {
            const params = new URLSearchParams(location.search)
            params.delete(field)
            restoreFocus.current = 'nav-search'
            void navigate(
                { pathname: location.pathname, search: params.toString(), hash: location.hash },
                { replace: true, state: null },
            )
        }
    }, [field, location, navigate])
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
