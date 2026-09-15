import {
    createContext,
    useContext,
    useEffect,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession, useSessionStore } from '@/features/auth/SessionProvider'
import { privateKeys, type Language } from '@/shared/query/keys'
import { readFavorites, readFavoriteDetails } from '@/shared/api/privatePlaces'
import { BookmarkStore } from './BookmarkStore'
const Context = createContext<BookmarkStore | null>(null)
export function BookmarksProvider({ children }: { children: ReactNode }) {
    const client = useQueryClient(),
        session = useSessionStore()!
    const [store] = useState(() => new BookmarkStore(client, session))
    useEffect(() => session.subscribe(store.clearStale), [session, store])
    return <Context value={store}>{children}</Context>
}
export function useBookmarkStore() {
    return useContext(Context)
}
export function useBookmarks(language: Language, details = false) {
    const controller = useBookmarkStore()!,
        session = useSession(),
        { scope, store } = session
    const optimistic = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
    const ids = useQuery({
        queryKey: scope ? privateKeys.favorites(scope) : ['private', 'favorites-idle'],
        enabled: !!scope && !session.busy,
        queryFn: ({ signal }) => store!.runPrivate(scope!, readFavorites, signal),
        retry: false,
        staleTime: 30000,
    })
    const list = useQuery({
        queryKey: scope
            ? privateKeys.favoriteDetails(scope, language)
            : ['private', 'favorites-details-idle'],
        enabled: details && !!scope && !session.busy,
        queryFn: ({ signal }) =>
            store!.runPrivate(scope!, (s) => readFavoriteDetails(language, s), signal),
        retry: false,
        staleTime: 30000,
    })
    const pending = optimistic.pending.filter((p) => store?.isCurrent(p.scope))
    const saved = new Set(ids.data ?? []),
        places = new Map((list.data ?? []).map((p) => [p.id, p]))
    for (const p of pending) {
        if (p.saved) {
            saved.add(p.id)
            if (!places.has(p.id) && p.language === language) places.set(p.id, p.place)
        } else {
            saved.delete(p.id)
            places.delete(p.id)
        }
    }
    return {
        controller,
        scope,
        saved,
        places: [...places.values()],
        pending,
        error:
            optimistic.error && store?.isCurrent(optimistic.error.scope)
                ? optimistic.error.message
                : null,
        idsPending: ids.isPending,
        idsError: ids.isError,
        listState: {
            pending: !!scope && list.isPending,
            error: list.isError ? 'Could not load bookmarks. Try again.' : null,
            retry: () => {
                void list.refetch()
                void ids.refetch()
            },
        },
        retry: () => {
            void ids.refetch()
        },
    }
}
