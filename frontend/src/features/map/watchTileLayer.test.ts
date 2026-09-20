import L from 'leaflet'
import { watchTileLayer } from './watchTileLayer'

let cleanups: (() => void)[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
    cleanups.forEach((stop) => stop())
    cleanups = []
    vi.useRealTimers()
    vi.restoreAllMocks()
})
function monitor() {
    const layer = L.tileLayer('/tiles/{z}/{x}/{y}.png')
    const fail = vi.fn(),
        ready = vi.fn()
    cleanups.push(watchTileLayer(layer, fail, ready))
    layer.fire('loading')
    return { layer, fail, ready }
}
it('fails a broken batch once, including later viewports, but tolerates a single missing edge tile', () => {
    const { layer, fail, ready } = monitor()
    layer.fire('tileload').fire('load')
    expect(ready).toHaveBeenCalledOnce()
    layer.fire('loading').fire('tileerror').fire('load')
    vi.advanceTimersByTime(21000)
    expect(fail).not.toHaveBeenCalled()
    layer.fire('loading').fire('tileerror').fire('tileerror').fire('tileerror').fire('load')
    expect(fail).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(21000)
    expect(fail).toHaveBeenCalledOnce()
})
it('times out a hanging batch and cancels deadlines/listeners when removed', () => {
    const { layer, fail } = monitor()
    vi.advanceTimersByTime(19999)
    expect(fail).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fail).toHaveBeenCalledOnce()
    const second = monitor()
    cleanups.forEach((stop) => stop())
    second.layer.fire('loading')
    layer.fire('loading')
    vi.advanceTimersByTime(21000)
    expect(second.fail).not.toHaveBeenCalled()
})
it('pauses deadlines in the background/offline and redraws after connectivity returns', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { layer, fail } = monitor()
    const redraw = vi.spyOn(layer, 'redraw')
    vi.advanceTimersByTime(60000)
    expect(fail).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    online.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(redraw).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(20000)
    expect(fail).toHaveBeenCalledOnce()
})
