import { scheduleIdlePreload } from './idlePreload'

let stop = () => {}
beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.stubGlobal('requestIdleCallback', undefined)
})
afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

it('waits for quiet and CPU idle, and performs a single silent warmup', async () => {
    let idle: (() => void) | undefined
    vi.stubGlobal(
        'requestIdleCallback',
        vi.fn((run: () => void) => {
            idle = run
            return 1
        }),
    )
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    const load = vi.fn().mockResolvedValue(undefined)
    stop = scheduleIdlePreload(load)
    await vi.advanceTimersByTimeAsync(2500)
    window.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(2999)
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(idle).toBeDefined()
    expect(load).not.toHaveBeenCalled()
    idle?.()
    expect(load).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(20000)
    expect(load).toHaveBeenCalledOnce()
})

it.each([{ saveData: true }, { effectiveType: '2g' }, { effectiveType: '3g' }])(
    'does not compete on constrained connections: %s',
    async (settings) => {
        const connection = Object.assign(new EventTarget(), settings)
        Object.defineProperty(navigator, 'connection', { configurable: true, value: connection })
        const load = vi.fn().mockResolvedValue(undefined)
        stop = scheduleIdlePreload(load)
        await vi.advanceTimersByTimeAsync(20000)
        expect(load).not.toHaveBeenCalled()
        Reflect.deleteProperty(navigator, 'connection')
    },
)

it('defers while hidden, handles browsers without idle callbacks, cancels on unmount and ignores warmup failures', async () => {
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    stop = scheduleIdlePreload(load)
    await vi.advanceTimersByTimeAsync(10000)
    expect(load).not.toHaveBeenCalled()
    visible.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledOnce()
    stop()
    const next = vi.fn()
    stop = scheduleIdlePreload(next)
    stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(next).not.toHaveBeenCalled()
})
