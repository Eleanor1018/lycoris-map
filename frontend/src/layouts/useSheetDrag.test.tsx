import { StrictMode, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSheetDrag } from './useSheetDrag'
import type { Snap } from './types'

let now = 0
const close = vi.fn()
const action = vi.fn()
function Harness({
    initial = 'collapsed',
    expanded = false,
}: {
    initial?: Snap
    expanded?: boolean
}) {
    const sheet = useRef<HTMLElement>(null)
    const [snap, setSnap] = useState<Snap>(initial)
    const [height, setDragHeight] = useState<number | null>(null)
    useSheetDrag({ sheet, snap, expandedPanel: expanded, close, setSnap, setDragHeight })
    return (
        <div data-testid="viewport">
            <section
                ref={sheet}
                data-testid="sheet"
                data-snap={snap}
                style={{ height: height ?? { collapsed: 158, half: 320, full: 754 }[snap] }}
            >
                <button className="sheet-handle" onClick={action}>
                    Handle
                </button>
                <div className="sheet-scroll" data-testid="scroll">
                    <h1>Lycoris Maps</h1>
                    <button onClick={action}>Nearby</button>
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
beforeEach(() => {
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
    ) {
        return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 390,
            bottom: 800,
            width: 390,
            height: this.dataset.testid === 'viewport' ? 800 : parseFloat(this.style.height),
            toJSON: () => ({}),
        }
    })
})
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
})

it('expands from the title through half and full, then collapses from the top of content', () => {
    const { sheet, title } = setup()
    touch(title, 'start', 700)
    expect(touch(title, 'move', 520).defaultPrevented).toBe(true)
    expect(sheet.style.height).toBe('338px')
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
    expect(sheet.style.height).toBe('158px')
    touch(title, 'start', 700)
    touch(title, 'move', 500)
    fireEvent.touchStart(title, { touches: [{ identifier: 1 }, { identifier: 2 }] })
    expect(sheet.style.height).toBe('158px')
    expect(sheet.dataset.snap).toBe('collapsed')
})
it('preserves the existing expanded-panel close gesture, but never closes on cancel', () => {
    const { title } = setup('full', true)
    touch(title, 'start', 100)
    touch(title, 'move', 250)
    touch(title, 'cancel', 250)
    expect(close).not.toHaveBeenCalled()
    touch(title, 'start', 100)
    touch(title, 'move', 250)
    touch(title, 'end', 250)
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
