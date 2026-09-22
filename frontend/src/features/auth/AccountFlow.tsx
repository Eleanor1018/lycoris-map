import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import type { PrivateScope } from '@/shared/query/keys'
import { useSession } from './SessionProvider'

export type AccountView = 'login' | 'register' | 'reset' | 'profile' | 'password' | 'created'
type Resume = (scope: PrivateScope) => void | Promise<void>
type AccountFlow = {
    view: AccountView | null
    message: string | null
    round: number
    isCurrent: (round: number) => boolean
    open: (view?: AccountView) => void
    close: () => void
    setView: (view: AccountView) => void
    requireLogin: (resume?: Resume, onCancel?: () => void) => void
    authenticated: (round: number) => Promise<void>
    notify: (message: string | null) => void
    restoreFocus: () => void
}
const Context = createContext<AccountFlow | null>(null)
export function AccountFlowProvider({ children }: { children: ReactNode }) {
    const { store } = useSession()
    const [view, updateView] = useState<AccountView | null>(null)
    const [round, updateRound] = useState(0)
    const currentRound = useRef(0)
    const setView = (next: AccountView | null) => {
        currentRound.current += 1
        updateRound(currentRound.current)
        updateView(next)
    }
    const isCurrent = (value: number) => value === currentRound.current
    const [message, notify] = useState<string | null>(null)
    const pending = useRef<Resume | undefined>(undefined)
    const cancelPending = useRef<(() => void) | undefined>(undefined)
    const trigger = useRef<HTMLElement | null>(null)
    const remember = () => {
        trigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    const close = () => {
        const cancel = cancelPending.current
        cancelPending.current = undefined
        setView(null)
        pending.current = undefined
        notify(null)
        cancel?.()
    }
    const open = (next?: AccountView) => {
        remember()
        pending.current = undefined
        cancelPending.current = undefined
        notify(null)
        setView(next ?? (store?.getSnapshot().user ? 'profile' : 'login'))
    }
    const requireLogin = (resume?: Resume, onCancel?: () => void) => {
        const scope = store?.getSnapshot().scope
        if (scope) {
            void resume?.(scope)
            return
        }
        remember()
        pending.current = resume
        cancelPending.current = onCancel
        notify(null)
        setView('login')
    }
    const authenticated = async (startedRound: number) => {
        if (!isCurrent(startedRound)) return
        const scope = store?.getSnapshot().scope
        if (!scope) throw new Error('Could not confirm your session. Please log in again.')
        const resume = pending.current
        pending.current = undefined
        cancelPending.current = undefined
        setView(null)
        notify(null)
        await resume?.(scope)
    }
    const restoreFocus = () => {
        if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
        else document.getElementById('map-shell')?.focus({ preventScroll: true })
    }
    return (
        <Context
            value={{
                view,
                message,
                round,
                isCurrent,
                open,
                close,
                setView,
                requireLogin,
                authenticated,
                notify,
                restoreFocus,
            }}
        >
            {children}
        </Context>
    )
}
export function useAccountFlow() {
    return useContext(Context)
}
