import { act, render, waitFor } from '@testing-library/react'
import L from 'leaflet'
import { MapContainer } from 'react-leaflet'
import TencentBaseMap from './TencentBaseMap'
import { tencentCrs, toTencent } from './coordinates'
import type { TencentSdk } from './sdk'

const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./sdk', () => ({ loadTencentSdk: load }))
let instances: FakeMap[] = []
class FakeMap {
    center: L.LatLng
    zoom: number
    events = new Map<string, () => void>()
    destroy = vi.fn()
    constructor(_container: HTMLElement, options: { center: L.LatLng; zoom: number }) {
        this.center = options.center
        this.zoom = options.zoom
        instances.push(this)
    }
    setCenter = (value: L.LatLng) => {
        this.center = value
    }
    setZoom = (value: number) => {
        this.zoom = value
    }
    getCenter = () => this.center
    getZoom = () => this.zoom
    on = (name: string, action: () => void) => {
        this.events.set(name, action)
    }
    off = (name: string) => {
        this.events.delete(name)
    }
}
const sdk = { Map: FakeMap, LatLng: L.LatLng } as unknown as TencentSdk
beforeEach(() => {
    instances = []
    load.mockReset().mockResolvedValue(sdk)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600)
})
afterEach(() => vi.restoreAllMocks())

it('keeps the Leaflet camera and picked coordinates in WGS84 and restores OSM projection on exit', async () => {
    let map: L.Map | null = null
    const failure = vi.fn()
    const view = (enabled: boolean) => (
        <MapContainer
            ref={(value) => {
                map = value
            }}
            center={[31.2304, 121.4737]}
            zoom={14}
        >
            {enabled && <TencentBaseMap onError={failure} />}
        </MapContainer>
    )
    const { rerender, unmount } = render(view(true))
    await waitFor(() => expect(instances).toHaveLength(1))
    const current = map as unknown as L.Map
    const instance = instances[0]!
    act(() => instance.events.get('tilesloaded')?.())
    expect(current.options.crs).toBe(tencentCrs)
    const pin = L.latLng(31.2304, 121.4737)
    expect(current.getCenter().distanceTo(pin)).toBeLessThan(1)
    const picked = current.containerPointToLatLng(current.latLngToContainerPoint(pin))
    expect(picked.distanceTo(pin)).toBeLessThan(15) // integer pixel at zoom 14
    act(() => current.setView([40.1243, 124.383], 17, { animate: false }))
    const converted = toTencent(current.getCenter())
    expect(instance.center.lat).toBeCloseTo(converted.lat, 7)
    expect(instance.center.lng).toBeCloseTo(converted.lng, 7)
    expect(instance.zoom).toBe(17)
    const before = current.getCenter()
    rerender(view(false))
    expect(current.options.crs).toBe(L.CRS.EPSG3857)
    expect(current.getCenter().distanceTo(before)).toBeLessThan(1)
    expect(instance.destroy).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.tencent-basemap')).toBeNull()
    expect(failure).not.toHaveBeenCalled()
    unmount()
})

it('does not create a late SDK instance after switching away or unmounting', async () => {
    let resolve!: (sdk: TencentSdk) => void
    load.mockReturnValue(
        new Promise<TencentSdk>((done) => {
            resolve = done
        }),
    )
    const { unmount } = render(
        <MapContainer center={[31.2304, 121.4737]} zoom={14}>
            <TencentBaseMap onError={vi.fn()} />
        </MapContainer>,
    )
    unmount()
    await act(async () => {
        resolve(sdk)
    })
    expect(instances).toHaveLength(0)
    expect(document.querySelector('.tencent-basemap')).toBeNull()
})

it('accepts an idle cached viewport without falsely timing out a working map', async () => {
    let map!: L.Map
    const failure = vi.fn()
    const view = render(
        <MapContainer
            ref={(value) => {
                if (value) map = value
            }}
            center={[31.2304, 121.4737]}
            zoom={14}
        >
            <TencentBaseMap onError={failure} />
        </MapContainer>,
    )
    await waitFor(() => expect(instances).toHaveLength(1))
    act(() => instances[0]!.events.get('tilesloaded')?.())
    vi.useFakeTimers()
    act(() => map.setView([31.2305, 121.4738], 14, { animate: false }))
    act(() => instances[0]!.events.get('idle')?.())
    act(() => vi.advanceTimersByTime(21000))
    expect(failure).not.toHaveBeenCalled()
    view.unmount()
    vi.useRealTimers()
})

it('reports load and GPU failures so the parent can fall back instead of leaving a blank map', async () => {
    const failure = vi.fn()
    load.mockRejectedValueOnce(new Error('network'))
    const first = render(
        <MapContainer center={[31.2304, 121.4737]} zoom={14}>
            <TencentBaseMap onError={failure} />
        </MapContainer>,
    )
    await waitFor(() => expect(failure).toHaveBeenCalledTimes(1))
    first.unmount()
    const second = render(
        <MapContainer center={[31.2304, 121.4737]} zoom={14}>
            <TencentBaseMap onError={failure} />
        </MapContainer>,
    )
    await waitFor(() => expect(instances).toHaveLength(1))
    act(() => instances[0]!.events.get('context_lost')?.())
    expect(failure).toHaveBeenCalledTimes(2)
    second.unmount()
})
