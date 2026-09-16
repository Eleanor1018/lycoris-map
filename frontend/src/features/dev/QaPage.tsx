import { useLanguage } from '@/shared/i18n'
import { useSession } from '@/features/auth/SessionProvider'

const PREVIEWS = [{ labelKey: 'qa.viewport375', width: 375, height: 812 }] as const

/** DEV-only map frames. S4 account operations use the product session owner. */
export function QaPage() {
    const { t } = useLanguage()
    const session = useSession()
    return (
        <main className="flex min-h-dvh flex-col gap-6 p-6" data-testid="qa-page">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl" style={{ fontFamily: 'var(--ui-font-heading)' }}>
                    {t('qa.title')}
                </h1>
                <p className="text-sm opacity-80">{t('qa.notProduction')}</p>
            </header>

            <section className="flex flex-col gap-2">
                <p className="text-xs opacity-80">{t('qa.viewportNote')}</p>
                {PREVIEWS.map((preview) => (
                    <figure key={preview.labelKey} className="flex w-fit flex-col gap-1">
                        <figcaption className="text-xs">
                            {t(preview.labelKey)} · {preview.width}×{preview.height}
                        </figcaption>
                        <iframe
                            title={t(preview.labelKey)}
                            src="/__dev/map-spike"
                            width={preview.width}
                            height={preview.height}
                            data-frame-width={preview.width}
                            data-frame-height={preview.height}
                            style={{ border: '1px solid var(--ui-brand-blush)' }}
                        />
                    </figure>
                ))}
            </section>

            <section className="flex flex-col gap-2">
                <h2 className="text-lg">Account verification</h2>
                <p>The S1 account probe has been replaced by the product account window.</p>
                <a href="/">Open the map to test login, profile, avatar and bookmarks</a>
                <p data-testid="qa-session">{session.user?.username ?? session.status}</p>
                <p data-testid="qa-epoch">{session.epoch}</p>
            </section>
        </main>
    )
}
