import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { LanguageProvider } from '@/shared/i18n'
import { AppErrorBoundary } from './ErrorBoundary'
import { SessionProvider } from '@/features/auth/SessionProvider'
import { AccountFlowProvider } from '@/features/auth/AccountFlow'
import { BookmarksProvider } from '@/features/bookmarks/BookmarksProvider'

/** One query cache and Cookie-session owner for the application. */
export function AppProviders({ children }: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        retry: 1,
                        staleTime: 30_000,
                        refetchOnWindowFocus: false,
                    },
                },
            }),
    )

    return (
        <AppErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <LanguageProvider>
                    <SessionProvider>
                        <AccountFlowProvider>
                            <BookmarksProvider>{children}</BookmarksProvider>
                        </AccountFlowProvider>
                    </SessionProvider>
                </LanguageProvider>
            </QueryClientProvider>
        </AppErrorBoundary>
    )
}
