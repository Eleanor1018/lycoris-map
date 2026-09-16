import { useUi } from '@/shared/i18n/ui'
import { useState, type ReactNode } from 'react'
import type { Marker } from '@/shared/api/markers'
import type { Language } from '@/shared/query/keys'
import { DesignButton } from '@/shared/ui/design-primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import { navigationUrl, placeShareUrl } from './model'

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
                <a
                    className="design-button navigate-button"
                    href={navigationUrl(place)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={ui.text('Navigate to {title} in Google Maps', {
                        title: place.title,
                    })}
                >
                    <span>{ui.text('Navigate')}</span>
                    <FigmaIcon name="forward" />
                </a>
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
