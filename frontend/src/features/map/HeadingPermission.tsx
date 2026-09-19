import { useState } from 'react'
import { useUi } from '@/shared/i18n/ui'
import { DesignButton, IconButton } from '@/shared/ui/design-primitives'
import { enableDeviceHeading, useHeadingPermission } from './useDeviceHeading'

/**
 * iOS Safari only exposes compass readings after a real user activation. This
 * notice appears as soon as the page knows a gesture is required (independent
 * of geolocation) and asks for that activation through an explicit button. The
 * click handler calls `requestPermission(true)` synchronously; no other API is
 * awaited first. On desktop/Android, where no request is needed, it renders
 * nothing.
 */
export function HeadingPermission() {
    const ui = useUi()
    const permission = useHeadingPermission()
    const [dismissed, setDismissed] = useState(false)
    if (dismissed || permission === 'unsupported' || permission === 'granted') return null
    const denied = permission === 'denied'
    return (
        <div className="map-notice" role="status">
            <div className="map-notice-content">
                {ui.text(
                    denied
                        ? 'Compass access is blocked. Allow motion and orientation access in your browser settings to see which way you face.'
                        : 'Allow motion and orientation access to see which way you face while exploring.',
                )}
                {!denied && (
                    <DesignButton
                        className="map-notice-retry"
                        onClick={() => {
                            void enableDeviceHeading()
                        }}
                    >
                        {ui.text('Enable heading')}
                    </DesignButton>
                )}
            </div>
            <IconButton
                className="map-notice-close"
                icon="close"
                size={16}
                label="Dismiss notification"
                onClick={() => setDismissed(true)}
            />
        </div>
    )
}
