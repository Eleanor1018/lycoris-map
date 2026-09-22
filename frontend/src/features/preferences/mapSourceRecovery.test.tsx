import { act, render } from '@testing-library/react'
import { LanguageProvider } from '@/shared/i18n'
import { useLanguage } from '@/shared/i18n'
import { PreferencesProvider, usePreferences, PREFERENCES_KEY } from './PreferencesProvider'

let current: ReturnType<typeof usePreferences>
let changeLanguage: ReturnType<typeof useLanguage>['setPreference']
function Probe() {
    current = usePreferences()
    changeLanguage = useLanguage().setPreference
    return null
}
function mount(locale: string) {
    return render(
        <LanguageProvider navigatorLanguage={locale} storage={null}>
            <PreferencesProvider>
                <Probe />
            </PreferencesProvider>
        </LanguageProvider>,
    )
}
beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_TENCENT_MAP_KEY', 'test-key')
    vi.stubEnv('VITE_TIANDITU_API_KEY', 'test-key')
})
afterEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

it('follows detected language until a deliberate map choice, without freezing a default on range edits', () => {
    mount('zh-CN')
    expect(current.preferences.source).toBe('tencent')
    act(() => current.update({ radius: 2000 }))
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).not.toHaveProperty('source')
    act(() => changeLanguage('en'))
    expect(current.preferences.source).toBe('osm')
    act(() => current.update({ source: 'tianditu' }))
    act(() => changeLanguage('zh'))
    expect(current.preferences.source).toBe('tianditu')
})

it.each([
    ['zh-CN', ['tencent', 'tianditu', 'osm']],
    ['en-US', ['osm', 'tencent', 'tianditu']],
] as const)(
    'recovers once per provider in %s without loops or persisting temporary failover',
    (locale, order) => {
        mount(locale)
        for (const source of order) {
            expect(current.preferences.source).toBe(source)
            act(() => {
                current.reportSourceFailure(source)
                current.reportSourceFailure(source)
            })
        }
        expect(current.sourceFailure?.exhausted).toBe(true)
        expect(current.preferences.source).toBe(order[2])
        act(() => current.reportSourceFailure(order[0]))
        expect(current.sourceFailure?.exhausted).toBe(true)
        expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull()
        act(() => current.retrySource())
        expect(current.preferences.source).toBe(order[0])
        expect(current.sourceFailure).toBeNull()
    },
)

it('restores explicit OSM, skips missing keys and ignores stale failures after a new manual choice', () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ source: 'osm' }))
    vi.stubEnv('VITE_TIANDITU_API_KEY', '')
    mount('zh-CN')
    expect(current.preferences.source).toBe('osm')
    const stale = current.reportSourceFailure
    act(() => current.update({ source: 'tencent' }))
    act(() => stale('osm'))
    expect(current.sourceFailure).toBeNull()
    act(() => current.reportSourceFailure('tencent'))
    expect(current.preferences.source).toBe('osm')
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!).source).toBe('tencent')
    act(() => current.update({ source: 'osm' }))
    expect(current.sourceFailure).toBeNull()
})

it('does not cycle providers while the whole device is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mount('en-US')
    act(() => current.reportSourceFailure('osm'))
    expect(current.preferences.source).toBe('osm')
    expect(current.sourceFailure).toBeNull()
})
