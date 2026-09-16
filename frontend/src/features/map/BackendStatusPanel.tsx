import { useEffect, useState } from 'react'
import { ApiError, fetchLiveness, fetchReadiness, type Readiness } from '@/shared/api'
import { useLanguage } from '@/shared/i18n'
import { Button } from '@/shared/ui'

type Status =
    | { kind: 'checking' }
    | { kind: 'ready'; readiness: Readiness }
    | { kind: 'liveOnly' }
    | { kind: 'unreachable'; message: string }

function describeError(error: unknown, t: ReturnType<typeof useLanguage>['t']): string {
    if (error instanceof ApiError) {
        const status: number = error.status
        return status === 0 ? t('backend.error.network') : t('backend.error.status', { status })
    }
    return t('backend.error.network')
}

/**
 * Backend connectivity for the S1 welcome screen.
 *
 * `/health/ready` is the readiness signal. If it fails but `/health/live`
 * succeeds, the process is up while PostgreSQL/Redis are not, and that
 * difference is shown instead of reporting a healthy backend.
 */
export function BackendStatusPanel() {
    const { language, setPreference, t } = useLanguage()
    const [status, setStatus] = useState<Status>({ kind: 'checking' })
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        let active = true

        const run = async () => {
            setStatus({ kind: 'checking' })
            try {
                const readiness = await fetchReadiness(controller.signal)
                if (active) setStatus({ kind: 'ready', readiness })
                return
            } catch (error) {
                if (!active || controller.signal.aborted) return
                try {
                    const live = await fetchLiveness(controller.signal)
                    if (!active) return
                    if (live) {
                        setStatus({ kind: 'liveOnly' })
                        return
                    }
                    setStatus({ kind: 'unreachable', message: describeError(error, t) })
                } catch {
                    if (active) setStatus({ kind: 'unreachable', message: describeError(error, t) })
                }
            }
        }

        void run()
        return () => {
            active = false
            controller.abort()
        }
    }, [attempt, t])

    return (
        <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-(--ui-gap) p-6">
            <header className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-(--ui-gap)">
                    <h1
                        className="text-4xl leading-tight"
                        style={{ fontFamily: 'var(--ui-font-logo)', fontWeight: 500 }}
                    >
                        {t('app.brand')}
                    </h1>
                    <div
                        role="group"
                        aria-label={t('language.label')}
                        className="flex items-center gap-2"
                    >
                        <Button
                            size="sm"
                            variant={language === 'zh' ? 'default' : 'outline'}
                            onClick={() => setPreference('zh')}
                        >
                            {t('language.zh')}
                        </Button>
                        <Button
                            size="sm"
                            variant={language === 'en' ? 'default' : 'outline'}
                            onClick={() => setPreference('en')}
                        >
                            {t('language.en')}
                        </Button>
                    </div>
                </div>
                <p style={{ fontFamily: 'var(--ui-font-nav)', fontWeight: 500 }}>
                    {t('app.tagline')}
                </p>
            </header>

            <section
                aria-live="polite"
                className="rounded-(--ui-card-radius) p-4"
                style={{ background: 'var(--ui-nav-surface)' }}
            >
                <h2 className="text-lg" style={{ fontFamily: 'var(--ui-font-heading)' }}>
                    {status.kind === 'checking'
                        ? t('backend.checking')
                        : status.kind === 'ready'
                          ? t('backend.ready')
                          : status.kind === 'liveOnly'
                            ? t('backend.liveOnly')
                            : t('backend.unreachable')}
                </h2>

                {status.kind === 'ready' ? (
                    <ul className="mt-2 text-sm">
                        <li>
                            {t('backend.detail.postgres')}: {status.readiness.checks.postgres}
                        </li>
                        <li>
                            {t('backend.detail.redis')}: {status.readiness.checks.redis}
                        </li>
                    </ul>
                ) : null}

                {status.kind === 'liveOnly' ? (
                    <ul className="mt-2 text-sm">
                        <li>
                            {t('backend.detail.postgres')}: {t('backend.detail.unknown')}
                        </li>
                        <li>
                            {t('backend.detail.redis')}: {t('backend.detail.unknown')}
                        </li>
                    </ul>
                ) : null}

                {status.kind === 'unreachable' ? (
                    <p className="mt-2 text-sm">{status.message}</p>
                ) : null}

                {status.kind !== 'checking' ? (
                    <Button className="mt-4" onClick={() => setAttempt((value) => value + 1)}>
                        {t('backend.retry')}
                    </Button>
                ) : null}
            </section>

            <p className="text-sm opacity-80">{t('app.stageNotice')}</p>
        </main>
    )
}
