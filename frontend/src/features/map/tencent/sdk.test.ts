import type { TencentSdk } from './sdk'

beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_TENCENT_MAP_KEY', 'browser-test-key')
    delete window.TMap
})
afterEach(() => {
    document
        .querySelectorAll('script[src*="map.qq.com/api/gljs"]')
        .forEach((script) => script.remove())
    delete window.TMap
    delete window.__lycorisTencentReady
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

it('uses Tencent async callback mode and shares one script until the SDK is actually ready', async () => {
    const { loadTencentSdk } = await import('./sdk')
    const first = loadTencentSdk(),
        second = loadTencentSdk()
    expect(first).toBe(second)
    const scripts = document.querySelectorAll<HTMLScriptElement>(
        'script[src*="map.qq.com/api/gljs"]',
    )
    expect(scripts).toHaveLength(1)
    const url = new URL(scripts[0]!.src)
    expect(url.searchParams.get('callback')).toBe('__lycorisTencentReady')
    expect(url.searchParams.get('key')).toBe('browser-test-key')
    let settled = false
    void first.then(() => {
        settled = true
    })
    scripts[0]!.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(settled).toBe(false)
    const sdk = {} as TencentSdk
    window.TMap = sdk
    window.__lycorisTencentReady?.()
    await expect(first).resolves.toBe(sdk)
    await expect(second).resolves.toBe(sdk)
    await expect(loadTencentSdk()).resolves.toBe(sdk)
})

it('removes a failed script and allows the next selection to retry', async () => {
    const { loadTencentSdk } = await import('./sdk')
    const first = loadTencentSdk()
    const rejection = expect(first).rejects.toThrow('could not load')
    document.querySelector('script[src*="map.qq.com/api/gljs"]')!.dispatchEvent(new Event('error'))
    await rejection
    const retry = loadTencentSdk()
    expect(retry).not.toBe(first)
    expect(document.querySelectorAll('script[src*="map.qq.com/api/gljs"]')).toHaveLength(1)
    window.TMap = {} as TencentSdk
    window.__lycorisTencentReady?.()
    await retry
})

it('times out a script that never calls ready so the UI can recover', async () => {
    vi.useFakeTimers()
    const { loadTencentSdk } = await import('./sdk')
    const pending = loadTencentSdk()
    const rejection = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(20000)
    await rejection
    expect(document.querySelector('script[src*="map.qq.com/api/gljs"]')).toBeNull()
})
