import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
    PreferencesProvider,
    usePreferences,
    PREFERENCES_KEY,
    parsePreferences,
    defaultPreferences,
} from './PreferencesProvider'
import { SettingsContent } from './Settings'
import { localize } from '@/shared/i18n/ui'
afterEach(() => localStorage.clear())
it('validates untrusted settings and arbitrary status messages', () => {
    for (const value of [
        null,
        'null',
        'broken',
        '{"radius":-1,"category":"invalid"}',
        '{"radius":1.5}',
        '{"radius":50001}',
    ])
        expect(parsePreferences(value)).toEqual(defaultPreferences)
    expect(parsePreferences('{"radius":50000,"category":"baby_room"}').radius).toBe(50000)
    for (const value of ['constructor', 'toString', '__proto__'])
        expect(localize('zh', value)).toBe(value)
})
function Value() {
    const { preferences } = usePreferences()
    return <output>{preferences.radius}</output>
}
it('reads the latest stored value instead of replaying stale cross-tab events', () => {
    render(
        <PreferencesProvider>
            <Value />
        </PreferencesProvider>,
    )
    localStorage.setItem(PREFERENCES_KEY, '{"radius":5000}')
    act(() =>
        window.dispatchEvent(
            new StorageEvent('storage', { key: PREFERENCES_KEY, newValue: '{"radius":2500}' }),
        ),
    )
    expect(screen.getByRole('status')).toHaveTextContent('5000')
})
it('keeps settings usable when storage writes fail', () => {
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
    })
    render(
        <MemoryRouter>
            <PreferencesProvider>
                <SettingsContent panel="range" open={() => {}} />
                <Value />
            </PreferencesProvider>
        </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('radio', { name: '2.5km' }))
    expect(screen.getByRole('status')).toHaveTextContent('2500')
    fail.mockRestore()
})
