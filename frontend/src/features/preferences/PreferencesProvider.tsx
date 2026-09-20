import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { resolveBrowserStorage } from '@/shared/i18n'
import { isMapSourceAvailable, type MapSource } from '@/features/map/mapSources'

export const PREFERENCES_KEY = 'lycoris.map-preferences'
export const searchCategories = ['accessible_toilet', 'baby_room', 'friendly_clinic'] as const
export type SearchCategory = (typeof searchCategories)[number]
export type Preferences = { radius: number; category: SearchCategory; source: MapSource }
export const defaultPreferences: Preferences = {
    radius: 1000,
    category: 'accessible_toilet',
    source: 'osm',
}

export function parsePreferences(raw: string | null): Preferences {
    try {
        const value: unknown = JSON.parse(raw ?? '{}')
        if (!value || typeof value !== 'object') return defaultPreferences
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
            source:
                'source' in value &&
                (value.source === 'tianditu' || value.source === 'tencent') &&
                isMapSourceAvailable(value.source)
                    ? value.source
                    : 'osm',
        }
    } catch {
        return defaultPreferences
    }
}
function readPreferences(): Preferences {
    try {
        return parsePreferences(resolveBrowserStorage()?.getItem(PREFERENCES_KEY) ?? null)
    } catch {
        return defaultPreferences
    }
}
const Context = createContext({
    preferences: defaultPreferences,
    update: (_change: Partial<Preferences>) => {},
})
export function PreferencesProvider({ children }: { children: ReactNode }) {
    const [preferences, setPreferences] = useState(readPreferences)
    useEffect(() => {
        const changed = (event: StorageEvent) => {
            if (event.key === PREFERENCES_KEY || event.key === null)
                setPreferences(readPreferences())
        }
        window.addEventListener('storage', changed)
        return () => window.removeEventListener('storage', changed)
    }, [])
    const update = (change: Partial<Preferences>) => {
        const next = parsePreferences(JSON.stringify({ ...preferences, ...change }))
        setPreferences(next)
        try {
            resolveBrowserStorage()?.setItem(PREFERENCES_KEY, JSON.stringify(next))
        } catch {
            /* The current selection remains usable with storage disabled. */
        }
    }
    return <Context value={{ preferences, update }}>{children}</Context>
}
export const usePreferences = () => useContext(Context)
export function rangeLabel(meters: number) {
    return meters < 1000 ? `${meters}m` : `${meters / 1000}km`
}
