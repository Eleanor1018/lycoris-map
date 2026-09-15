import {
    createContext,
    useContext,
    useEffect,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SessionStore } from './SessionStore'

const SessionContext = createContext<SessionStore | null>(null)
export function SessionProvider({ children }: { children: ReactNode }) {
    const client = useQueryClient()
    const [store] = useState(() => new SessionStore(client))
    useEffect(() => store.connect(), [store])
    return <SessionContext value={store}>{children}</SessionContext>
}
export function useSessionStore() {
    return useContext(SessionContext)
}
const anonymous = {
    user: null,
    scope: null,
    epoch: 0,
    status: 'anonymous' as const,
    busy: false,
    error: null,
}
const emptySubscribe = () => () => undefined
const emptySnapshot = () => anonymous
export function useSession() {
    const store = useSessionStore()
    const state = useSyncExternalStore(
        store?.subscribe ?? emptySubscribe,
        store?.getSnapshot ?? emptySnapshot,
    )
    return { ...state, store }
}
