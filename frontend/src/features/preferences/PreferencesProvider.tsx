import {
    createContext,
    useContext,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react'
import { resolveBrowserStorage } from '@/shared/i18n'
import { isMapSourceAvailable, mapSourceOrder, type MapSource } from '@/features/map/mapSources'
import { useOptionalLanguage } from '@/shared/i18n/LanguageProvider'
import type { Language } from '@/shared/i18n'

export const PREFERENCES_KEY = 'lycoris.map-preferences'
export const searchCategories = ['accessible_toilet', 'baby_room', 'friendly_clinic'] as const
export type SearchCategory = (typeof searchCategories)[number]
export type Preferences = { radius: number; category: SearchCategory; source: MapSource }
export const defaultPreferences: Preferences = {
    radius: 1000,
    category: 'accessible_toilet',
    source: 'osm',
}

type StoredPreferences = Omit<Preferences, 'source'> & { source?: MapSource }
const storedDefaults: StoredPreferences = { radius: 1000, category: 'accessible_toilet' }
function parseStoredPreferences(raw: string | null): StoredPreferences {
    try {
        const value: unknown = JSON.parse(raw ?? '{}')
        if (!value || typeof value !== 'object') return storedDefaults
        return {
            radius:
                'radius' in value &&
                typeof value.radius === 'number' &&
                Number.isInteger(value.radius) &&
                value.radius >= 1 &&
                value.radius <= 50000
                    ? value.radius
                    : 1000,
            category:
                'category' in value && searchCategories.some((c) => c === value.category)
                    ? (value.category as SearchCategory)
                    : 'accessible_toilet',
            ...('source' in value &&
            (value.source === 'osm' || value.source === 'tianditu' || value.source === 'tencent') &&
            isMapSourceAvailable(value.source)
                ? { source: value.source }
                : {}),
        }
    } catch {
        return storedDefaults
    }
}
export function parsePreferences(raw: string | null, language: Language = 'en'): Preferences {
    const stored = parseStoredPreferences(raw)
    return { ...stored, source: stored.source ?? mapSourceOrder(language)[0]! }
}
function readPreferences(): StoredPreferences {
    try {
        return parseStoredPreferences(resolveBrowserStorage()?.getItem(PREFERENCES_KEY) ?? null)
    } catch {
        return storedDefaults
    }
}
type SourceFailure = { exhausted: boolean; id: string } | null
const Context = createContext({
    preferences: defaultPreferences,
    update: (_change: Partial<Preferences>) => {},
    reportSourceFailure: (_source: MapSource) => {},
    retrySource: () => {},
    sourceAttempt: '',
    sourceFailure: null as SourceFailure,
})
export function PreferencesProvider({ children }: { children: ReactNode }) {
    const language = useOptionalLanguage()?.language ?? 'en'
    const [stored, setStored] = useState(readPreferences)
    const [revision, setRevision] = useState(0)
    const requested = stored.source ?? mapSourceOrder(language)[0]!
    const sourceAttempt = `${language}/${requested}/${revision}`
    const latestAttempt = useRef(sourceAttempt)
    latestAttempt.current = sourceAttempt
    const [recovery, setRecovery] = useState<{ key: string; failed: MapSource[] }>({
        key: '',
        failed: [],
    })
    const failed = recovery.key === sourceAttempt ? recovery.failed : []
    const order = [requested, ...mapSourceOrder(language).filter((source) => source !== requested)]
    const available = order.find((source) => !failed.includes(source))
    const preferences: Preferences = { ...stored, source: available ?? failed.at(-1) ?? requested }
    const sourceFailure: SourceFailure = failed.length
        ? { exhausted: !available, id: `${sourceAttempt}/${failed.length}` }
        : null
    const retrySource = useCallback(() => setRevision((value) => value + 1), [])
    const reportSourceFailure = useCallback(
        (source: MapSource) => {
            if (latestAttempt.current !== sourceAttempt || navigator.onLine === false) return
            setRecovery((previous) => {
                const tried = previous.key === sourceAttempt ? previous.failed : []
                const candidates = [
                    requested,
                    ...mapSourceOrder(language).filter((entry) => entry !== requested),
                ]
                if (candidates.find((entry) => !tried.includes(entry)) !== source) return previous
                return { key: sourceAttempt, failed: [...tried, source] }
            })
        },
        [sourceAttempt, requested, language],
    )
    useEffect(() => {
        const changed = (event: StorageEvent) => {
            if (event.key === PREFERENCES_KEY || event.key === null) {
                setStored(readPreferences())
                retrySource()
            }
        }
        window.addEventListener('storage', changed)
        return () => window.removeEventListener('storage', changed)
    }, [retrySource])
    const update = (change: Partial<Preferences>) => {
        // Persist deliberate choices only. Radius/category edits must not turn
        // a language default or temporary failover into a permanent selection.
        const next = parseStoredPreferences(JSON.stringify({ ...stored, ...change }))
        setStored(next)
        if (change.source !== undefined) retrySource()
        try {
            resolveBrowserStorage()?.setItem(PREFERENCES_KEY, JSON.stringify(next))
        } catch {
            /* The current selection remains usable with storage disabled. */
        }
    }
    return (
        <Context
            value={{
                preferences,
                update,
                reportSourceFailure,
                retrySource,
                sourceAttempt,
                sourceFailure,
            }}
        >
            {children}
        </Context>
    )
}
export const usePreferences = () => useContext(Context)
export function rangeLabel(meters: number) {
    return meters < 1000 ? `${meters}m` : `${meters / 1000}km`
}
