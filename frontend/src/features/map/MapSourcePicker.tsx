import { useEffect, useId, useState } from 'react'
import { Popover } from 'radix-ui'
import { usePreferences } from '@/features/preferences/PreferencesProvider'
import { useUi } from '@/shared/i18n/ui'
import { DesignButton, IconButton } from '@/shared/ui/design-primitives'
import osmPreview from '@/assets/map-sources/osm.webp'
import tiandituPreview from '@/assets/map-sources/tianditu.webp'
import tencentPreview from '@/assets/map-sources/tencent.png'
import { isMapSourceAvailable, mapSourceNames } from './mapSources'
import './map-source-picker.css'

const sources = [
    { id: 'osm', preview: osmPreview },
    { id: 'tianditu', preview: tiandituPreview },
    { id: 'tencent', preview: tencentPreview },
] as const

export function MapSourceOptions({ onSelect }: { onSelect?: (() => void) | undefined }) {
    const ui = useUi()
    const id = useId()
    const { preferences, update } = usePreferences()
    return (
        <div className="map-source-options">
            <div className="map-source-grid" role="radiogroup" aria-label={ui.text('Map Source')}>
                {sources.map((source) => (
                    <DesignButton
                        key={source.id}
                        className="map-source-card"
                        role="radio"
                        aria-checked={preferences.source === source.id}
                        aria-label={mapSourceNames[source.id]}
                        aria-describedby={
                            !isMapSourceAvailable(source.id)
                                ? `${id}-${source.id}-status`
                                : undefined
                        }
                        disabled={!isMapSourceAvailable(source.id)}
                        onClick={() => {
                            update({ source: source.id })
                            onSelect?.()
                        }}
                    >
                        <span className="map-source-preview">
                            <img src={source.preview} alt="" width={160} height={160} />
                        </span>
                        <span className="map-source-name">{mapSourceNames[source.id]}</span>
                        {!isMapSourceAvailable(source.id) && (
                            <span className="map-source-status" id={`${id}-${source.id}-status`}>
                                {ui.text('Not available yet')}
                            </span>
                        )}
                    </DesignButton>
                ))}
            </div>
            <p className="map-source-credits">
                ©{' '}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                    OpenStreetMap
                </a>
                {' · '}
                <a href="https://map.tianditu.gov.cn/" target="_blank" rel="noreferrer">
                    天地图
                </a>
                {' · '}
                <a href="https://map.qq.com/" target="_blank" rel="noreferrer">
                    腾讯地图
                </a>
            </p>
        </div>
    )
}

export function MapSourcePicker({ mobile, resetKey }: { mobile: boolean; resetKey: string }) {
    const ui = useUi()
    const [open, setOpen] = useState(false)
    useEffect(() => setOpen(false), [resetKey, mobile])
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <IconButton
                    icon={mobile ? 'mobileMap' : 'map'}
                    size={20}
                    id="map-source"
                    label="Map source"
                />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    className="map-source-popover"
                    lang={ui.language}
                    aria-label={ui.text('Map Source')}
                    side="left"
                    align="start"
                    sideOffset={10}
                    collisionPadding={11}
                    sticky="always"
                    hideWhenDetached
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        const content = event.currentTarget as HTMLElement
                        content
                            .querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
                            ?.focus({ preventScroll: true })
                    }}
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                >
                    <h2 className="map-source-title">{ui.text('Map Type')}</h2>
                    <MapSourceOptions onSelect={() => setOpen(false)} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
