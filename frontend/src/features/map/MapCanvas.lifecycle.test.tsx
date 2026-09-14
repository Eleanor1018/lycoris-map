import { StrictMode } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/shared/i18n'
import { MapCanvas, readLeafletContainer, readMapInstanceId } from './MapCanvas'
import { createSyntheticMarkers, type SyntheticMarker } from './syntheticMarkers'

/**
 * Lifecycle regression with the REAL React Leaflet + Leaflet stack under jsdom,
 * wrapped in StrictMode so effect replay is exercised. Leaflet is NOT mocked.
 *
 * Tooltip assertions use real `mouseover`/`mouseout` on the actual SVG paths and
 * read the real `.leaflet-tooltip` DOM Leaflet creates.
 *
 * jsdom has no layout engine, so this asserts lifecycle, DOM structure and
 * attribute/text updates — NOT pixels or performance. Real rendering is checked
 * by温晓 in a browser via `/__dev/qa`.
 */

afterEach(cleanup)

function canvas(markers: readonly SyntheticMarker[], language: 'zh' | 'en') {
    return (
        <LanguageProvider navigatorLanguage={language === 'zh' ? 'zh-CN' : 'en-US'}>
            <div style={{ height: 600, width: 800 }}>
                <MapCanvas markers={markers} language={language} />
            </div>
        </LanguageProvider>
    )
}

function renderStrict(markers: readonly SyntheticMarker[], language: 'zh' | 'en') {
    return render(<StrictMode>{canvas(markers, language)}</StrictMode>)
}

function paths(container: HTMLElement): SVGPathElement[] {
    return [...container.querySelectorAll<SVGPathElement>('path.leaflet-interactive')]
}

/** Hover the first marker and read the real tooltip Leaflet renders. */
function hoverFirstTooltip(container: HTMLElement): string {
    const first = paths(container)[0]
    if (!first) throw new Error('no marker path rendered')
    fireEvent.mouseOver(first)
    const tooltip = container.querySelector('.leaflet-tooltip')
    return tooltip?.textContent ?? ''
}

function unhoverFirst(container: HTMLElement): void {
    const first = paths(container)[0]
    if (!first) return
    fireEvent.mouseOut(first)
}

describe('MapCanvas under StrictMode', () => {
    it('renders 200 -> 100 -> 200 markers without rebuilding the map', () => {
        const all = createSyntheticMarkers()
        const half = all.slice(0, 100)

        const view = renderStrict(all, 'zh')
        const container = view.container
        const leafletContainer = readLeafletContainer(container)
        const instanceId = readMapInstanceId(container)

        expect(leafletContainer).not.toBeNull()
        expect(instanceId).not.toBe('')
        expect(paths(container)).toHaveLength(200)

        view.rerender(<StrictMode>{canvas(half, 'zh')}</StrictMode>)
        expect(paths(container)).toHaveLength(100)

        view.rerender(<StrictMode>{canvas(all, 'zh')}</StrictMode>)
        expect(paths(container)).toHaveLength(200)

        expect(readLeafletContainer(container)).toBe(leafletContainer)
        expect(readMapInstanceId(container)).toBe(instanceId)
    })

    it('applies marker colour and real tooltip changes while the map instance stays', () => {
        const original = createSyntheticMarkers()
        const view = renderStrict(original, 'zh')
        const container = view.container
        const leafletContainer = readLeafletContainer(container)
        const instanceId = readMapInstanceId(container)

        const beforeColor = paths(container)[0]?.getAttribute('stroke') ?? null
        expect(hoverFirstTooltip(container)).toBe('合成点位 1 · v1')
        unhoverFirst(container)

        // id/version unchanged; title and isActive flipped.
        const updated = original.map((marker) =>
            marker.id === 1
                ? {
                      ...marker,
                      title: { zh: '合成点位 1（已更新 2）', en: 'Synthetic point 1 (updated 2)' },
                      isActive: false,
                  }
                : marker,
        )
        view.rerender(<StrictMode>{canvas(updated, 'zh')}</StrictMode>)

        const afterColor = paths(container)[0]?.getAttribute('stroke') ?? null
        expect(afterColor).toBe('#EFB8C8')
        expect(afterColor).not.toBe(beforeColor)

        // The real Tooltip text changed, and version stayed at v1.
        expect(hoverFirstTooltip(container)).toBe('合成点位 1（已更新 2） · v1')

        expect(updated[0]?.id).toBe(original[0]?.id)
        expect(updated[0]?.version).toBe(original[0]?.version)
        expect(readLeafletContainer(container)).toBe(leafletContainer)
        expect(readMapInstanceId(container)).toBe(instanceId)
        expect(paths(container)).toHaveLength(200)
    })

    it('updates real tooltip text when the language changes without rebuild', () => {
        const markers = createSyntheticMarkers()
        const view = renderStrict(markers, 'zh')
        const container = view.container
        const leafletContainer = readLeafletContainer(container)
        const instanceId = readMapInstanceId(container)

        expect(hoverFirstTooltip(container)).toBe('合成点位 1 · v1')
        unhoverFirst(container)

        view.rerender(<StrictMode>{canvas(markers, 'en')}</StrictMode>)

        expect(hoverFirstTooltip(container)).toBe('Synthetic point 1 · v1')

        expect(readLeafletContainer(container)).toBe(leafletContainer)
        expect(readMapInstanceId(container)).toBe(instanceId)
        expect(paths(container)).toHaveLength(200)
    })

    it('unmounts and remounts without duplicating the Leaflet container', () => {
        const markers = createSyntheticMarkers()
        const first = renderStrict(markers, 'zh')
        expect(readLeafletContainer(first.container)).not.toBeNull()

        first.unmount()
        cleanup()

        const second = renderStrict(markers, 'zh')
        expect(second.container.querySelectorAll('.leaflet-container')).toHaveLength(1)
        expect(paths(second.container)).toHaveLength(200)
        cleanup()
    })

    it('does not expose a debugging hook on window', () => {
        renderStrict(createSyntheticMarkers(), 'zh')
        expect(Object.keys(window)).not.toContain('__lycorisMap')
    })
})
