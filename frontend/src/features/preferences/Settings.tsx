import { useEffect, useState } from 'react'
import { Popover } from 'radix-ui'
import { useLocation, useNavigate } from 'react-router'
import { useOptionalLanguage } from '@/shared/i18n/LanguageProvider'
import { useUi } from '@/shared/i18n/ui'
import { DesignButton } from '@/shared/ui/design-primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import type { Panel } from '@/layouts/types'
import { rangeLabel, searchCategories, usePreferences } from './PreferencesProvider'
import { MapSourceOptions } from '@/features/map/MapSourcePicker'
import { mapSourceNames } from '@/features/map/mapSources'
import { Button } from '@/shared/ui/button'
import { version } from '../../../package.json'
import lycorisMark from '@/assets/lycoris-mark.png'
import './settings.css'

export const settingsTitles = {
    languages: 'Languages',
    range: 'Range',
    category: 'Category',
    source: 'Map Source',
    about: 'About',
    settings: 'Settings',
} as const
export type SettingsPanel = keyof typeof settingsTitles
export function isSettingsPanel(panel: Panel): panel is SettingsPanel {
    return panel in settingsTitles
}
const categoryNames = {
    accessible_toilet: 'Toilet',
    baby_room: 'Nursing Rooms',
    friendly_clinic: 'Medical Institutions',
} as const
export function SettingsRows({ mobile = false }: { mobile?: boolean }) {
    const ui = useUi(),
        { preferences } = usePreferences()
    const [active, setActive] = useState<SettingsPanel | null>(null)
    useEffect(() => {
        if (!active) return
        // A touch drag may never produce a click. Dismiss before the underlying
        // sheet moves so a portalled menu cannot be left floating away from it.
        const touch = (event: TouchEvent) => {
            if (
                !(event.target instanceof Element) ||
                !event.target.closest('.settings-popover, .setting-card')
            )
                setActive(null)
        }
        const scroll = (event: Event) => {
            if (!(event.target instanceof Element) || !event.target.closest('.settings-popover'))
                setActive(null)
        }
        document.addEventListener('touchstart', touch, { passive: true })
        document.addEventListener('scroll', scroll, true)
        return () => {
            document.removeEventListener('touchstart', touch)
            document.removeEventListener('scroll', scroll, true)
        }
    }, [active])
    const row = (panel: Exclude<SettingsPanel, 'settings'>, label: string, value = '') => (
        <Popover.Root
            key={panel}
            open={active === panel}
            onOpenChange={(shown) =>
                setActive((current) => (shown ? panel : current === panel ? null : current))
            }
        >
            <Popover.Trigger asChild>
                <DesignButton
                    id={`${mobile ? 'mobile-' : ''}setting-${panel}`}
                    className="setting-card"
                    aria-label={`${ui.message(label)}${value ? ` ${ui.message(value)}` : ''}`}
                >
                    <span>{ui.message(label)}</span>
                    <span className="setting-value">{ui.message(value)}</span>
                    <span className="chevron-slot">
                        <FigmaIcon name={mobile ? 'mobileChevronBlue' : 'chevron'} />
                    </span>
                </DesignButton>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    className="settings-popover"
                    data-panel={panel}
                    lang={ui.language}
                    aria-label={ui.message(settingsTitles[panel])}
                    side={mobile ? 'bottom' : 'right'}
                    align={mobile ? 'end' : 'start'}
                    sideOffset={8}
                    collisionPadding={11}
                    sticky="always"
                    hideWhenDetached
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        const content = event.currentTarget as HTMLElement
                        content
                            .querySelector<HTMLElement>(
                                '[role="radio"][aria-checked="true"], input, a',
                            )
                            ?.focus({ preventScroll: true })
                    }}
                    onEscapeKeyDown={(event) => {
                        if (event.isComposing) event.preventDefault()
                        event.stopPropagation()
                    }}
                >
                    <SettingsContent panel={panel} compact onSelect={() => setActive(null)} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
    const language = row(
        'languages',
        'Choose Language',
        ui.language === 'en' ? 'English' : '简体中文',
    )
    const range = row('range', 'Searching Range', rangeLabel(preferences.radius))
    const category = row('category', 'Searching Type', categoryNames[preferences.category])
    const source = row('source', 'Map Source', mapSourceNames[preferences.source])
    return (
        <div className={mobile ? 'mobile-settings' : 'settings-cards'}>
            {language}
            {mobile ? (
                <div className="mobile-map-settings">
                    {source}
                    {range}
                    {category}
                </div>
            ) : (
                <>
                    {range}
                    {category}
                    {source}
                </>
            )}
            {row('about', 'About Lycoris Maps')}
        </div>
    )
}

function Choices<T extends string | number>({
    label,
    value,
    options,
    change,
    onSelect,
}: {
    label: string
    value: T
    options: readonly { value: T; label: string }[]
    change: (value: T) => void
    onSelect?: (() => void) | undefined
}) {
    return (
        <div className="language-options" role="radiogroup" aria-label={label}>
            {options.map((option, index) => (
                <DesignButton
                    key={option.value}
                    role="radio"
                    aria-checked={value === option.value}
                    tabIndex={
                        value === option.value ||
                        (!options.some((o) => o.value === value) && index === 0)
                            ? 0
                            : -1
                    }
                    onClick={() => {
                        change(option.value)
                        onSelect?.()
                    }}
                    onKeyDown={(event) => {
                        const offset = ['ArrowDown', 'ArrowRight'].includes(event.key)
                            ? 1
                            : ['ArrowUp', 'ArrowLeft'].includes(event.key)
                              ? -1
                              : 0
                        if (!offset && event.key !== 'Home' && event.key !== 'End') return
                        event.preventDefault()
                        const next =
                            event.key === 'Home'
                                ? 0
                                : event.key === 'End'
                                  ? options.length - 1
                                  : (index + offset + options.length) % options.length
                        change(options[next]!.value)
                        event.currentTarget.parentElement
                            ?.querySelectorAll<HTMLButtonElement>('[role=radio]')
                            [next]?.focus()
                    }}
                >
                    <span>{option.label}</span>
                    {value === option.value && <FigmaIcon name="check" size={20} />}
                </DesignButton>
            ))}
        </div>
    )
}

export function SettingsContent({
    panel,
    mobile = false,
    compact = false,
    onSelect,
}: {
    panel: SettingsPanel
    mobile?: boolean
    compact?: boolean
    onSelect?: (() => void) | undefined
}) {
    const ui = useUi(),
        language = useOptionalLanguage(),
        navigate = useNavigate(),
        location = useLocation()
    const { preferences, update } = usePreferences()
    const [radius, setRadius] = useState(String(preferences.radius)),
        [error, setError] = useState(false)
    useEffect(() => {
        setRadius(String(preferences.radius))
    }, [preferences.radius])
    if (panel === 'settings') return <SettingsRows mobile={mobile} />
    return (
        <div
            className={`preferences-content ${mobile ? 'mobile-preferences' : ''} ${compact ? 'compact-preferences' : ''}`}
        >
            {mobile && <h1>{ui.message(settingsTitles[panel])}</h1>}
            {panel === 'languages' && (
                <Choices
                    label={ui.text('Language')}
                    value={ui.language}
                    onSelect={onSelect}
                    options={[
                        { value: 'en', label: 'English' },
                        { value: 'zh', label: '简体中文' },
                    ]}
                    change={(value) => {
                        language?.setPreference(value)
                        const params = new URLSearchParams(location.search)
                        params.set('lang', value)
                        void navigate(
                            {
                                pathname: location.pathname,
                                search: params.toString(),
                                hash: location.hash,
                            },
                            { replace: true, state: location.state },
                        )
                    }}
                />
            )}
            {panel === 'category' && (
                <Choices
                    label={ui.text('Searching Type')}
                    value={preferences.category}
                    onSelect={onSelect}
                    options={searchCategories.map((value) => ({
                        value,
                        label: ui.message(
                            value === 'accessible_toilet'
                                ? 'Accessible Toilets'
                                : categoryNames[value],
                        ),
                    }))}
                    change={(category) => update({ category })}
                />
            )}
            {panel === 'range' && (
                <form
                    className="preference-form"
                    onSubmit={(event) => {
                        event.preventDefault()
                        const number = Number(radius)
                        if (
                            !/^\d+$/.test(radius) ||
                            !Number.isSafeInteger(number) ||
                            number < 1 ||
                            number > 50000
                        ) {
                            setError(true)
                            return
                        }
                        update({ radius: number })
                        setError(false)
                        onSelect?.()
                    }}
                >
                    <label htmlFor="search-range">{ui.text('Range (meters)')}</label>
                    <input
                        id="search-range"
                        type="number"
                        min="1"
                        max="50000"
                        step="1"
                        inputMode="numeric"
                        required
                        value={radius}
                        aria-invalid={error || undefined}
                        aria-describedby={error ? 'range-error' : undefined}
                        onChange={(event) => setRadius(event.target.value)}
                    />
                    {error && (
                        <p id="range-error" role="alert">
                            {ui.text('Use a whole number between 1 and 50000.')}
                        </p>
                    )}
                    <DesignButton type="submit">{ui.text('Save')}</DesignButton>
                </form>
            )}
            {panel === 'source' && <MapSourceOptions onSelect={onSelect} />}
            {panel === 'about' && (
                <div className="preference-about">
                    <header className="about-identity">
                        <img
                            className="about-icon"
                            src={lycorisMark}
                            width={64}
                            height={64}
                            alt=""
                            decoding="async"
                        />
                        <h2>Lycoris Maps</h2>
                        <p className="about-version">{ui.text('Version {version}', { version })}</p>
                    </header>
                    <p className="about-tagline">
                        {ui.text('Across mountains and seas, together.')}
                    </p>
                    <p>{ui.text('A map of accessible and friendly places.')}</p>
                    <div className="about-links">
                        <Button asChild className="about-repository-button">
                            <a
                                href="https://github.com/Project-Lycoris/lycoris-map"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {ui.text('View on GitHub')}
                            </a>
                        </Button>
                        <a
                            className="about-repository-url"
                            href="https://github.com/Project-Lycoris/lycoris-map"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            github.com/Project-Lycoris/lycoris-map
                        </a>
                    </div>
                    <footer className="about-footer">
                        <p>{ui.text('Thank you to all our contributors.')}</p>
                        <p className="about-attribution">
                            {ui.text('Map data')}:{' '}
                            <a
                                href="https://www.openstreetmap.org/copyright"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                © OpenStreetMap contributors
                            </a>
                        </p>
                    </footer>
                </div>
            )}
        </div>
    )
}
