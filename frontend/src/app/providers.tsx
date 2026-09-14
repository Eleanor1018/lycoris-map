import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { LanguageProvider } from '@/shared/i18n'
import { AppErrorBoundary } from './ErrorBoundary'

/**
 * S1 application root. It sets up the query client and language provider only;
 * routing and the map shell arrive in S2/S3.
 */
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
                <LanguageProvider>{children}</LanguageProvider>
            </QueryClientProvider>
        </AppErrorBoundary>
    )
}
