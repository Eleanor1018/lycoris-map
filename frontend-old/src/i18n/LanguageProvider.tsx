import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { english } from './strings'

export type Language = 'zh' | 'en'
export type LanguagePreference = Language | 'system'
export const LANGUAGE_STORAGE_KEY = 'lycoris.language'
const resolveSystemLanguage = (locale: string): Language => /^en(?:-|$)/i.test(locale) ? 'en' : 'zh'
const readPreference = (): LanguagePreference => {
    try {
        const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
        return value === 'en' || value === 'zh' ? value : 'system'
    } catch {
        return 'zh'
    }
}
const persistPreference = (value: LanguagePreference) => {
    try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, value)
    } catch {
        // Storage can be denied or full; the current in-memory selection still works.
    }
}
type Translator = (text: string, values?: Record<string, string | number>) => string
type LanguageContextValue = {
    language: Language
    preference: LanguagePreference
    setPreference: (value: LanguagePreference) => void
    t: Translator
}
const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
    const location = useLocation()
    const navigate = useNavigate()
    const urlLanguage = new URLSearchParams(location.search).get('lang')
    const [preference, updatePreference] = useState<LanguagePreference>(() =>
        urlLanguage === 'zh' || urlLanguage === 'en' ? urlLanguage : readPreference())
    const [previousUrlLanguage, setPreviousUrlLanguage] = useState(urlLanguage)
    const [systemLanguage, setSystemLanguage] = useState(() => resolveSystemLanguage(navigator.language))
    // A shared link selects its language for the following in-app navigation too.
    if (urlLanguage !== previousUrlLanguage) {
        setPreviousUrlLanguage(urlLanguage)
        if (urlLanguage === 'zh' || urlLanguage === 'en') updatePreference(urlLanguage)
    }
    const language: Language = urlLanguage === 'zh' || urlLanguage === 'en'
        ? urlLanguage : preference === 'system' ? systemLanguage : preference

    useEffect(() => {
        if (urlLanguage !== 'zh' && urlLanguage !== 'en') return
        persistPreference(urlLanguage)
    }, [urlLanguage])

    useEffect(() => {
        const updateSystem = () => setSystemLanguage(resolveSystemLanguage(navigator.language))
        const updateStorage = (event: StorageEvent) => {
            if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) updatePreference(readPreference())
        }
        window.addEventListener('languagechange', updateSystem)
        window.addEventListener('storage', updateStorage)
        return () => {
            window.removeEventListener('languagechange', updateSystem)
            window.removeEventListener('storage', updateStorage)
        }
    }, [])
    useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en' }, [language])

    const setPreference = useCallback((value: LanguagePreference) => {
        persistPreference(value)
        updatePreference(value)
        const params = new URLSearchParams(location.search)
        if (params.has('lang')) {
            params.delete('lang')
            navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true })
        }
    }, [location, navigate])
    const t = useCallback<Translator>((text, values) => {
        const translated = language === 'en' ? english[text] ?? text : text
        return translated.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match))
    }, [language])
    const value = useMemo(() => ({ language, preference, setPreference, t }), [language, preference, setPreference, t])
    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

// Context and its hook intentionally share a module, as in AuthProvider.
// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
    const context = useContext(LanguageContext)
    if (!context) throw new Error('LanguageProvider is missing')
    return context
}
