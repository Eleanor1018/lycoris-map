import { useUi } from '@/shared/i18n/ui'
import type { UiKey } from '@/shared/i18n/ui'
import { useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import type { Marker } from '@/shared/api/markers'
import type { Language } from '@/shared/query/keys'
import { DesignButton } from '@/shared/ui/design-primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import { navigationAppUrl, placeShareUrl, type NavigationApp } from './model'
import './navigation-chooser.css'

const navigationOptions: { app: NavigationApp; label: UiKey }[] = [
    { app: 'apple', label: 'Apple Maps' },
    { app: 'google', label: 'Google Maps' },
    { app: 'baidu', label: 'Baidu Maps' },
]

export function PlaceActions({
    place,
    language,
    children,
    mobile = false,
}: {
    place: Marker
    language: Language
    children?: ReactNode
    mobile?: boolean | undefined
}) {
    const ui = useUi()
    const [status, setStatus] = useState<{ id: number; text: string } | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const share = async () => {
        const url = placeShareUrl(window.location.origin, place.id, language)
        try {
            if (navigator.share) await navigator.share({ title: place.title, url })
            else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url)
                setStatus({ id: place.id, text: 'Link copied.' })
            } else setStatus({ id: place.id, text: 'Sharing is unavailable in this browser.' })
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError'))
                setStatus({ id: place.id, text: 'Could not share this link. Try again.' })
        }
    }
    return (
        <>
            <div className="place-actions">
                <DesignButton className="share-button" onClick={() => void share()}>
                    <span>{ui.text('Share')}</span>
                    <FigmaIcon name={mobile ? 'mobileShare' : 'share'} />
                </DesignButton>
                <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
                    <Popover.Trigger asChild>
                        <DesignButton className="navigate-button">
                            <span>{ui.text('Navigate')}</span>
                            <FigmaIcon name="forward" />
                        </DesignButton>
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content
                            className="navigation-chooser"
                            lang={ui.language}
                            aria-label={ui.text('Choose a navigation app')}
                            sideOffset={8}
                            collisionPadding={11}
                            sticky="always"
                            hideWhenDetached
                            onOpenAutoFocus={(event) => {
                                event.preventDefault()
                                const content = event.currentTarget as HTMLElement
                                content
                                    .querySelector<HTMLElement>('a')
                                    ?.focus({ preventScroll: true })
                            }}
                            onEscapeKeyDown={(event) => event.stopPropagation()}
                        >
                            {navigationOptions.map((option) => (
                                <a
                                    key={option.app}
                                    className="navigation-option"
                                    href={navigationAppUrl(option.app, place)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setMenuOpen(false)}
                                >
                                    {ui.text(option.label)}
                                </a>
                            ))}
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
                {children}
            </div>
            {status?.id === place.id && (
                <p className="place-action-status" role="status">
                    {ui.message(status.text)}
                </p>
            )}
        </>
    )
}
