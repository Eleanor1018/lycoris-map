import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { LanguageProvider } from '@/shared/i18n'
import { AppErrorBoundary } from './ErrorBoundary'
import { SessionProvider } from '@/features/auth/SessionProvider'
import { AccountFlowProvider } from '@/features/auth/AccountFlow'
import { BookmarksProvider } from '@/features/bookmarks/BookmarksProvider'
import { PreferencesProvider } from '@/features/preferences/PreferencesProvider'
import type { Language } from '@/shared/i18n'
import { ContributionsProvider } from '@/features/contributions/ContributionsProvider'

/** One query cache and Cookie-session owner for the application. */
export function AppProviders({
    children,
    languageOverride,
}: {
    children: ReactNode
    languageOverride?: Language | undefined
}) {
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
                <LanguageProvider override={languageOverride}>
                    <PreferencesProvider>
                        <SessionProvider>
                            <AccountFlowProvider>
                                <BookmarksProvider>
                                    <ContributionsProvider>{children}</ContributionsProvider>
                                </BookmarksProvider>
                            </AccountFlowProvider>
                        </SessionProvider>
                    </PreferencesProvider>
                </LanguageProvider>
            </QueryClientProvider>
        </AppErrorBoundary>
    )
}
