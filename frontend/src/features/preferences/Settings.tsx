import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useOptionalLanguage } from '@/shared/i18n/LanguageProvider'
import { useUi } from '@/shared/i18n/ui'
import { DesignButton } from '@/shared/ui/design-primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import type { Panel } from '@/layouts/types'
import { rangeLabel, searchCategories, usePreferences } from './PreferencesProvider'
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
type OpenSettings = (panel: Panel, focusId?: string) => void

export function SettingsRows({ mobile = false, open }: { mobile?: boolean; open: OpenSettings }) {
    const ui = useUi(),
        { preferences } = usePreferences()
    const row = (panel: SettingsPanel, label: string, value = '') => (
        <DesignButton
            key={panel}
            id={`${mobile ? 'mobile-' : ''}setting-${panel}`}
            className="setting-card"
            aria-label={`${ui.message(label)}${value ? ` ${ui.message(value)}` : ''}`}
            onClick={() => open(panel, `${mobile ? 'mobile-' : ''}setting-${panel}`)}
        >
            <span>{ui.message(label)}</span>
            <span className="setting-value">{ui.message(value)}</span>
            <span className="chevron-slot">
                <FigmaIcon name={mobile ? 'mobileChevronBlue' : 'chevron'} />
            </span>
        </DesignButton>
    )
    const language = row(
        'languages',
        'Choose Language',
        ui.language === 'en' ? 'English' : '简体中文',
    )
    const range = row('range', 'Searching Range', rangeLabel(preferences.radius))
    const category = row('category', 'Searching Type', categoryNames[preferences.category])
    const source = row('source', 'Map Source', 'OSM')
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
}: {
    label: string
    value: T
    options: readonly { value: T; label: string }[]
    change: (value: T) => void
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
                    onClick={() => change(option.value)}
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
    open,
}: {
    panel: SettingsPanel
    mobile?: boolean
    open: OpenSettings
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
    if (panel === 'settings') return <SettingsRows mobile={mobile} open={open} />
    return (
        <div className={`preferences-content ${mobile ? 'mobile-preferences' : ''}`}>
            {mobile && <h1>{ui.message(settingsTitles[panel])}</h1>}
            {panel === 'languages' && (
                <Choices
                    label={ui.text('Language')}
                    value={ui.language}
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
                <>
                    <Choices
                        label={ui.text('Searching Range')}
                        value={preferences.radius}
                        options={[1000, 2500].map((value) => ({ value, label: rangeLabel(value) }))}
                        change={(radius) => {
                            update({ radius })
                            setError(false)
                        }}
                    />
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
                </>
            )}
            {panel === 'source' && (
                <>
                    <Choices
                        label={ui.text('Map Source')}
                        value="osm"
                        options={[{ value: 'osm', label: 'OSM' }]}
                        change={() => update({ source: 'osm' })}
                    />
                    <p>{ui.text('OSM is the map source available in this version.')}</p>
                </>
            )}
            {panel === 'about' && (
                <div className="preference-about">
                    <p>{ui.text('A map of accessible and friendly places.')}</p>
                    <p>{ui.text('Place details are contributed by the community.')}</p>
                    <p>
                        {ui.text('Map data')}:{' '}
                        <a
                            href="https://www.openstreetmap.org/copyright"
                            target="_blank"
                            rel="noreferrer"
                        >
                            © OpenStreetMap contributors
                        </a>
                    </p>
                    <a
                        href="https://github.com/Eleanor1018/lycoris-map"
                        target="_blank"
                        rel="noreferrer"
                    >
                        {ui.text('Source code')}
                    </a>
                </div>
            )}
        </div>
    )
}
