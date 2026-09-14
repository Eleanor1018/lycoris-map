import '@testing-library/jest-dom/vitest'

/**
 * jsdom has no layout engine and does not implement `ResizeObserver`, which
 * Leaflet's map container relies on. This is the only library-adjacent shim the
 * tests add: React Leaflet and Leaflet themselves run for real.
 *
 * Because there is no real layout, these tests assert lifecycle and DOM
 * structure, NOT pixel rendering or performance. Real browser rendering is
 * verified separately via the `/__dev/qa` iframes.
 */
if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub implements ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

/**
 * jsdom returns 0 for `clientWidth`/`clientHeight`, so Leaflet's container
 * sizing maths would collapse. Override only the getters on the prototype.
 */
Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
})
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
})
