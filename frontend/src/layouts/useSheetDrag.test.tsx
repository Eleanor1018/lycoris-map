import { StrictMode, useRef, useState, type CSSProperties } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSheetDrag } from './useSheetDrag'
import type { Snap } from './types'

let now = 0
const close = vi.fn()
const action = vi.fn()
const rendered = vi.fn()
let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
function flushFrame() {
    act(() => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => callback(now))
    })
}
function Harness({
    initial = 'collapsed',
    expanded = false,
    route = 'search',
}: {
    initial?: Snap
    expanded?: boolean
    route?: string
}) {
    const sheet = useRef<HTMLElement>(null)
    const [snap, setSnap] = useState<Snap>(initial)
    const height = { collapsed: 158, half: 320, full: 754 }[snap]
    rendered()
    useSheetDrag({ sheet, snap, height, resetKey: route, expandedPanel: expanded, close, setSnap })
    return (
        <div data-testid="viewport" style={{ '--sheet-height': `${height}px` } as CSSProperties}>
            <section ref={sheet} data-testid="sheet" data-snap={snap} style={{ height: 754 }}>
                <button className="sheet-handle" onClick={action}>
                    Handle
                </button>
                <div className="sheet-scroll" data-testid="scroll">
                    <h1>Lycoris Maps</h1>
                    <div className="nearby-result-scroll" data-testid="nested-scroll">
                        <button onClick={action}>Nearby</button>
                    </div>
                    <input aria-label="Search" />
                </div>
            </section>
        </div>
    )
}
function touch(target: Element, type: 'start' | 'move' | 'end' | 'cancel', y: number, x = 100) {
    now += 100
    const point = { identifier: 1, clientX: x, clientY: y }
    const event = new Event(`touch${type}`, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
        touches: { value: type === 'end' || type === 'cancel' ? [] : [point] },
        changedTouches: { value: [point] },
    })
    fireEvent(target, event)
    flushFrame()
    return event
}
function setup(initial?: Snap, expanded = false) {
    render(
        <StrictMode>
            <Harness {...(initial ? { initial } : {})} expanded={expanded} />
        </StrictMode>,
    )
    return {
        sheet: screen.getByTestId('sheet'),
        title: screen.getByRole('heading'),
        scroll: screen.getByTestId('scroll'),
    }
}
function visualHeight() {
    return screen.getByTestId('viewport').style.getPropertyValue('--sheet-visual-height')
}
beforeEach(() => {
    now = 0
    frames = new Map()
    nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback)
        return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
    ) {
        const viewport = this.dataset.testid === 'viewport'
        const owner = this.parentElement
        const visible = parseFloat(
            owner?.style.getPropertyValue('--sheet-visual-height') ||
                owner?.style.getPropertyValue('--sheet-height') ||
                '754',
        )
        const top = viewport ? 0 : 800 - visible
        return {
            x: 0,
            y: top,
            top,
            left: 0,
            right: 390,
            bottom: viewport ? 800 : top + 754,
            width: 390,
            height: viewport ? 800 : 754,
            toJSON: () => ({}),
        }
    })
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
})

it('expands from the title through half and full, then collapses from the top of content', () => {
    const { sheet, title } = setup()
    touch(title, 'start', 700)
    expect(touch(title, 'move', 520).defaultPrevented).toBe(true)
    expect(visualHeight()).toBe('338px')
    touch(title, 'end', 520)
    expect(sheet.dataset.snap).toBe('half')
    touch(title, 'start', 520)
    touch(title, 'move', 100)
    touch(title, 'end', 100)
    expect(sheet.dataset.snap).toBe('full')
    touch(title, 'start', 100)
    touch(title, 'move', 540)
    touch(title, 'end', 540)
    expect(sheet.dataset.snap).toBe('half')
})
it('leaves upward swipes and already-scrolled full-panel content to native scrolling', () => {
    const { sheet, title, scroll } = setup('full')
    touch(title, 'start', 500)
    expect(touch(title, 'move', 300).defaultPrevented).toBe(false)
    touch(title, 'end', 300)
    scroll.scrollTop = 120
    touch(title, 'start', 300)
    expect(touch(title, 'move', 550).defaultPrevented).toBe(false)
    touch(title, 'end', 550)
    expect(sheet.dataset.snap).toBe('full')
})
it('drags the handle even when content is scrolled, without also clicking it', () => {
    const { sheet, scroll } = setup('full')
    scroll.scrollTop = 200
    const handle = screen.getByRole('button', { name: 'Handle' })
    touch(handle, 'start', 100)
    touch(handle, 'move', 700)
    touch(handle, 'end', 700)
    fireEvent.click(handle, { detail: 1 })
    expect(sheet.dataset.snap).toBe('collapsed')
    expect(action).not.toHaveBeenCalled()
    expect(scroll.scrollTop).toBe(0)
    touch(handle, 'start', 700)
    touch(handle, 'end', 700)
    fireEvent.click(handle, { detail: 1 })
    expect(action).toHaveBeenCalledOnce()
})
it('keeps inputs and horizontal swipes usable, and a card tap still clicks', () => {
    const { sheet, title } = setup()
    const input = screen.getByRole('textbox')
    touch(input, 'start', 700)
    expect(touch(input, 'move', 300).defaultPrevented).toBe(false)
    touch(input, 'end', 300)
    touch(title, 'start', 700)
    expect(touch(title, 'move', 690, 250).defaultPrevented).toBe(false)
    touch(title, 'end', 690)
    const button = screen.getByRole('button', { name: 'Nearby' })
    touch(button, 'start', 700)
    touch(button, 'end', 700)
    fireEvent.click(button, { detail: 1 })
    expect(action).toHaveBeenCalledOnce()
    expect(sheet.dataset.snap).toBe('collapsed')
})
it('cancels interrupted and multi-touch drags without changing the snap', () => {
    const { sheet, title } = setup()
    touch(title, 'start', 700)
    touch(title, 'move', 500)
    touch(title, 'cancel', 500)
    expect(visualHeight()).toBe('')
    touch(title, 'start', 700)
    touch(title, 'move', 500)
    fireEvent.touchStart(title, { touches: [{ identifier: 1 }, { identifier: 2 }] })
    expect(visualHeight()).toBe('')
    expect(sheet.dataset.snap).toBe('collapsed')
})
it('settles an expanded panel before closing, and never closes on cancel', () => {
    vi.useFakeTimers()
    const { title } = setup('full', true)
    touch(title, 'start', 100)
    touch(title, 'move', 250)
    touch(title, 'cancel', 250)
    expect(close).not.toHaveBeenCalled()
    touch(title, 'start', 100)
    touch(title, 'move', 250)
    touch(title, 'end', 250)
    expect(close).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(280))
    expect(close).toHaveBeenCalledOnce()
})
it('projects a short upward flick to the next snap', () => {
    const { sheet, title } = setup()
    touch(title, 'start', 700)
    now -= 80
    touch(title, 'move', 670)
    now -= 80
    touch(title, 'end', 670)
    expect(sheet.dataset.snap).toBe('half')
})
it('does not let the companion touch pointercancel discard an active touch gesture', () => {
    const { sheet, title } = setup()
    touch(title, 'start', 700)
    const cancel = new Event('pointercancel', { bubbles: true })
    Object.defineProperty(cancel, 'pointerType', { value: 'touch' })
    fireEvent(title, cancel)
    expect(touch(title, 'move', 520).defaultPrevented).toBe(true)
    touch(title, 'end', 520)
    expect(sheet.dataset.snap).toBe('half')
})
it('does not skip straight from full to collapsed on a short fast downward flick', () => {
    const { sheet, title } = setup('full')
    touch(title, 'start', 100)
    now -= 99
    touch(title, 'move', 215)
    now -= 99
    touch(title, 'end', 215)
    expect(sheet.dataset.snap).toBe('half')
})
it('does not rerender React during a continuous drag', () => {
    const { sheet, title } = setup()
    const renders = rendered.mock.calls.length
    touch(title, 'start', 700)
    for (let y = 690; y >= 450; y -= 10) touch(title, 'move', y)
    expect(rendered).toHaveBeenCalledTimes(renders)
    expect(sheet.dataset.snap).toBe('collapsed')
    expect(sheet.style.height).toBe('754px')
    expect(visualHeight()).toBe('408px')
    touch(title, 'end', 450)
    expect(sheet.dataset.snap).toBe('half')
    expect(rendered.mock.calls.length).toBeGreaterThan(renders)
})
it('lets a nested nearby list scroll down without dismissing the panel', () => {
    setup('full', true)
    screen.getByTestId('nested-scroll').scrollTop = 120
    const row = screen.getByRole('button', { name: 'Nearby' })
    touch(row, 'start', 200)
    expect(touch(row, 'move', 450).defaultPrevented).toBe(false)
    touch(row, 'end', 450)
    expect(close).not.toHaveBeenCalled()
    expect(visualHeight()).toBe('')
})
it('cancels a pending dismissal when navigating to another panel', () => {
    vi.useFakeTimers()
    const view = render(<Harness initial="full" expanded route="detail" />)
    const title = screen.getByRole('heading')
    touch(title, 'start', 100)
    touch(title, 'move', 300)
    touch(title, 'end', 300)
    expect(visualHeight()).toBe('0px')
    view.rerender(<Harness initial="full" expanded route="bookmarks" />)
    act(() => vi.advanceTimersByTime(300))
    expect(close).not.toHaveBeenCalled()
    expect(visualHeight()).toBe('')
})
it('finishes mouse dragging even when the pointer leaves the sheet', () => {
    const { sheet, title } = setup()
    function pointer(target: Element | Window, type: string, y: number) {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperties(event, {
            pointerType: { value: 'mouse' },
            pointerId: { value: 4 },
            button: { value: 0 },
            clientX: { value: 100 },
            clientY: { value: y },
        })
        now += 100
        fireEvent(target, event)
        flushFrame()
    }
    pointer(title, 'pointerdown', 700)
    pointer(window, 'pointermove', 250)
    pointer(window, 'pointerup', 250)
    expect(sheet.dataset.snap).toBe('full')
    expect(sheet.dataset.dragging).toBeUndefined()
})
