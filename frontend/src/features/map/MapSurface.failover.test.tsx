import { act, render, waitFor } from '@testing-library/react'
import L from 'leaflet'
import { LanguageProvider } from '@/shared/i18n'
import { PreferencesProvider, usePreferences } from '@/features/preferences/PreferencesProvider'
import { MapSurface } from './MapSurface'

vi.mock('./tencent/sdk', () => ({
    loadTencentSdk: vi.fn().mockRejectedValue(new Error('unreachable')),
}))

afterEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
})
it('connects real Leaflet tile failures to the fallback chain and keeps the camera and text attribution', async () => {
    vi.stubEnv('VITE_TENCENT_MAP_KEY', 'test')
    vi.stubEnv('VITE_TIANDITU_API_KEY', 'test')
    let map!: L.Map
    let preferences!: ReturnType<typeof usePreferences>
    function Probe() {
        preferences = usePreferences()
        return null
    }
    const view = render(
        <LanguageProvider initialPreference="zh" storage={null}>
            <PreferencesProvider>
                <MapSurface
                    onMap={(value) => {
                        if (value) map = value
                    }}
                />
                <Probe />
            </PreferencesProvider>
        </LanguageProvider>,
    )
    const instance = L.stamp(map)
    await waitFor(() => expect(preferences.preferences.source).toBe('tianditu'))
    act(() => map.setView([40.1243, 124.383], 16, { animate: false }))
    const position = map.getCenter()
    const tiles = () => {
        const result: L.TileLayer[] = []
        map.eachLayer((layer) => {
            if (layer instanceof L.TileLayer) result.push(layer)
        })
        return result
    }
    expect(tiles()).toHaveLength(2)
    act(() =>
        tiles()[0]!
            .fire('loading')
            .fire('tileerror')
            .fire('tileerror')
            .fire('tileerror')
            .fire('load'),
    )
    expect(preferences.preferences.source).toBe('osm')
    expect(tiles()).toHaveLength(1)
    expect(L.stamp(map)).toBe(instance)
    expect(map.getCenter().distanceTo(position)).toBeLessThan(1)
    expect(view.container.querySelector('.leaflet-attribution-flag')).toBeNull()
    expect(view.container.querySelector('.leaflet-control-attribution')).toHaveTextContent(
        'Leaflet | © OpenStreetMap contributors',
    )
    act(() =>
        tiles()[0]!
            .fire('loading')
            .fire('tileerror')
            .fire('tileerror')
            .fire('tileerror')
            .fire('load'),
    )
    expect(preferences.sourceFailure?.exhausted).toBe(true)
    expect(preferences.preferences.source).toBe('osm')
})
