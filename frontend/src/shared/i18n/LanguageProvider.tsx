import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react'
import { translate, type Language, type MessageKey } from './messages'

export type LanguagePreference = Language | 'system'

export const LANGUAGE_STORAGE_KEY = 'lycoris.language'

/**
 * Read `window.localStorage` safely.
 *
 * The property getter itself throws `SecurityError` when storage is blocked
 * (e.g. cookies disabled, sandboxed iframe), not just `getItem`/`setItem`, so
 * the access must sit inside the `try`.
 */
export function resolveBrowserStorage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

/** Explicit preference wins; otherwise the navigator language decides. */
export function resolveSystemLanguage(locale: string): Language {
    return /^en(?:-|$)/i.test(locale) ? 'en' : 'zh'
}

export function resolveLanguage(
    preference: LanguagePreference,
    navigatorLanguage: string,
): Language {
    if (preference === 'zh' || preference === 'en') return preference
    return resolveSystemLanguage(navigatorLanguage)
}

/** Storage may be denied or full; fall back to the system preference. */
export function readStoredPreference(storage: Pick<Storage, 'getItem'> | null): LanguagePreference {
    if (!storage) return 'system'
    try {
        const value = storage.getItem(LANGUAGE_STORAGE_KEY)
        return value === 'en' || value === 'zh' ? value : 'system'
    } catch {
        return 'system'
    }
}

export function persistPreference(
    storage: Pick<Storage, 'setItem'> | null,
    preference: LanguagePreference,
): void {
    if (!storage) return
    try {
        storage.setItem(LANGUAGE_STORAGE_KEY, preference)
    } catch {
        // The in-memory selection still works without storage.
    }
}

export function toHtmlLang(language: Language): string {
    return language === 'zh' ? 'zh-CN' : 'en'
}

export type Translator = (key: MessageKey, values?: Record<string, string | number>) => string

type LanguageContextValue = {
    language: Language
    preference: LanguagePreference
    userSelected: boolean
    setPreference: (value: LanguagePreference) => void
    t: Translator
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

type LanguageProviderProps = {
    children: ReactNode
    /** Explicit preference, e.g. `?lang=en` from a shared link. */
    override?: Language | undefined
    initialPreference?: LanguagePreference
    /** Injectable for tests; `undefined` uses `window.localStorage`. */
    storage?: Storage | null
    /** Injectable for tests; `undefined` follows `window.navigator.language`. */
    navigatorLanguage?: string
}

export function LanguageProvider({
    children,
    initialPreference,
    override,
    storage,
    navigatorLanguage,
}: LanguageProviderProps) {
    const resolveStorage = useCallback((): Storage | null => {
        if (storage !== undefined) return storage
        return resolveBrowserStorage()
    }, [storage])

    const resolveNavigatorLanguage = useCallback((): string => {
        if (navigatorLanguage !== undefined) return navigatorLanguage
        return typeof window === 'undefined' ? 'zh' : window.navigator.language
    }, [navigatorLanguage])

    const [preference, setPreferenceState] = useState<LanguagePreference>(
        () => initialPreference ?? readStoredPreference(resolveStorage()),
    )
    const [systemLanguage, setSystemLanguage] = useState<Language>(() =>
        resolveSystemLanguage(resolveNavigatorLanguage()),
    )

    const [userSelected, setUserSelected] = useState(false)
    const language: Language =
        (userSelected ? undefined : override) ??
        (preference === 'system' ? systemLanguage : preference)

    useEffect(() => {
        if (typeof document === 'undefined') return
        document.documentElement.lang = toHtmlLang(language)
    }, [language])

    useEffect(() => {
        if (navigatorLanguage !== undefined || typeof window === 'undefined') return
        const onLanguageChange = () =>
            setSystemLanguage(resolveSystemLanguage(window.navigator.language))
        window.addEventListener('languagechange', onLanguageChange)
        return () => window.removeEventListener('languagechange', onLanguageChange)
    }, [navigatorLanguage])

    useEffect(() => {
        const sync = (event: StorageEvent) => {
            if (event.key === LANGUAGE_STORAGE_KEY || event.key === null)
                setPreferenceState(readStoredPreference(resolveStorage()))
        }
        window.addEventListener('storage', sync)
        return () => window.removeEventListener('storage', sync)
    }, [resolveStorage])

    const setPreference = useCallback(
        (value: LanguagePreference) => {
            persistPreference(resolveStorage(), value)
            setPreferenceState(value)
            setUserSelected(true)
        },
        [resolveStorage],
    )

    const t = useCallback<Translator>((key, values) => translate(language, key, values), [language])

    const value = useMemo(
        () => ({ language, preference, userSelected, setPreference, t }),
        [language, preference, userSelected, setPreference, t],
    )

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useOptionalLanguage() {
    return useContext(LanguageContext)
}

export function useLanguage(): LanguageContextValue {
    const context = useContext(LanguageContext)
    if (!context) throw new Error('LanguageProvider is missing')
    return context
}
