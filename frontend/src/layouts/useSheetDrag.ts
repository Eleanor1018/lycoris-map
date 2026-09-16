import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
import type { Snap } from './types'

type Gesture = {
    id: number
    x: number
    y: number
    height: number
    min: number
    max: number
    half: number
    handle: boolean
    scrolled: boolean
    dragging: boolean
    samples: { y: number; time: number }[]
}

/** Move a composited sheet, without rendering the map or resizing content per touch. */
export function useSheetDrag({
    sheet,
    snap,
    height,
    resetKey,
    expandedPanel,
    close,
    setSnap,
}: {
    sheet: RefObject<HTMLElement | null>
    snap: Snap
    height: number
    resetKey: string
    expandedPanel: boolean
    close: () => void
    setSnap: (snap: Snap) => void
}) {
    const gesture = useRef<Gesture | null>(null)
    const frame = useRef(0)
    const suppressClickUntil = useRef(0)
    const clearMotion = useEffectEvent(() => {
        cancelAnimationFrame(frame.current)
        frame.current = 0
    })
    const rest = useEffectEvent(() => {
        const element = sheet.current
        if (!element) return
        delete element.dataset.dragging
        const owner = element.parentElement
        owner?.style.removeProperty('--sheet-visual-height')
        owner?.removeAttribute('data-sheet-dragging')
    })
    const cancel = useEffectEvent(() => {
        gesture.current = null
        clearMotion()
        rest()
    })
    const paint = useEffectEvent((visibleHeight: number, dragging: boolean) => {
        const element = sheet.current
        if (!element) return
        const owner = element.parentElement
        if (dragging) {
            element.dataset.dragging = 'true'
            owner?.setAttribute('data-sheet-dragging', 'true')
        } else {
            delete element.dataset.dragging
            owner?.removeAttribute('data-sheet-dragging')
        }
        owner?.style.setProperty('--sheet-visual-height', `${visibleHeight}px`)
    })
    useEffect(() => {
        if (expandedPanel || snap === 'full') return
        const content = sheet.current?.querySelector<HTMLElement>('.sheet-scroll')
        if (content) content.scrollTop = 0
    }, [snap, expandedPanel, sheet])
    useEffect(() => {
        cancel()
        return cancel
    }, [resetKey])

    const begin = useEffectEvent((id: number, x: number, y: number, target: EventTarget | null) => {
        const element = sheet.current
        if (!element || !(target instanceof Element)) return
        if (target.closest('input, textarea, select, [contenteditable="true"], [role="slider"]'))
            return
        suppressClickUntil.current = 0
        const viewport = element.parentElement?.getBoundingClientRect()
        const box = element.getBoundingClientRect()
        const bottom = Math.max(0, parseFloat(getComputedStyle(element).bottom) || 0)
        const limit = Math.max(
            1,
            Math.min(box.height, (viewport?.height || window.innerHeight) - 46 - bottom),
        )
        const visibleHeight = Math.max(
            0,
            (viewport?.bottom || window.innerHeight) - bottom - box.top,
        )
        clearMotion()
        // Nearby/search lists may scroll inside .sheet-scroll. Check the entire
        // target ancestry so a scrolled nested list never dismisses the sheet.
        let scrolled = false
        for (
            let node: Element | null = target;
            node && node !== element;
            node = node.parentElement
        ) {
            if (node.scrollTop > 1) scrolled = true
        }
        gesture.current = {
            id,
            x,
            y,
            height: visibleHeight,
            min: expandedPanel ? 0 : Math.min(158, limit),
            half: Math.min(320, limit),
            max: expandedPanel ? Math.min(height, limit) : limit,
            handle: Boolean(target.closest('.sheet-handle')),
            scrolled,
            dragging: false,
            samples: [{ y, time: performance.now() }],
        }
    })
    const move = useEffectEvent((x: number, y: number, event: Event) => {
        const current = gesture.current
        if (!current) return
        const delta = current.y - y
        if (!current.dragging) {
            if (Math.max(Math.abs(delta), Math.abs(x - current.x)) < 6) return
            if (
                Math.abs(x - current.x) > Math.abs(delta) ||
                (!current.handle &&
                    (snap === 'full' || expandedPanel) &&
                    (current.scrolled || delta > 0))
            ) {
                gesture.current = null
                rest()
                return
            }
            if (!event.cancelable) return cancel()
            current.dragging = true
        }
        event.preventDefault()
        const time = performance.now()
        current.samples.push({ y, time })
        while (current.samples.length > 2 && current.samples[1]!.time < time - 80)
            current.samples.shift()
        const visibleHeight = Math.max(current.min, Math.min(current.max, current.height + delta))
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => {
            frame.current = 0
            paint(visibleHeight, true)
        })
    })
    const finish = useEffectEvent((y: number) => {
        const current = gesture.current
        if (!current) return
        gesture.current = null
        if (!current.dragging) {
            rest()
            return
        }
        suppressClickUntil.current = performance.now() + 500
        cancelAnimationFrame(frame.current)
        const now = performance.now()
        const last = current.samples.at(-1)!
        const first = current.samples[0]!
        const velocity =
            now - last.time < 100 && last.time > first.time
                ? (first.y - last.y) / (last.time - first.time)
                : 0
        const released = Math.max(
            current.min,
            Math.min(current.max, current.height + current.y - y),
        )
        paint(released, true)
        // Commit the last finger position once, before enabling the settle transition.
        sheet.current?.getBoundingClientRect()
        if (expandedPanel) {
            const dismiss =
                current.y - y < -Math.min(80, height * 0.25) ||
                (velocity < -0.6 && current.y - y < -24)
            if (dismiss) {
                // Use the same route action as the close button in this event.
                // The primary sheet settles from the released finger position;
                // no delayed callback can close a later panel or stale route.
                close()
                rest()
            } else rest()
        } else {
            const choices: [Snap, number][] = [
                ['collapsed', current.min],
                ['half', current.half],
                ['full', current.max],
            ]
            const projected =
                released +
                (Math.abs(velocity) > 0.45 ? Math.max(-1.2, Math.min(1.2, velocity)) * 160 : 0)
            const nearest = choices.reduce((best, choice) =>
                Math.abs(choice[1] - projected) < Math.abs(best[1] - projected) ? choice : best,
            )
            setSnap(nearest[0])
            // React commits the destination once; the browser animates from the
            // final drag position to that destination on its compositor.
            frame.current = requestAnimationFrame(() => {
                frame.current = 0
                rest()
            })
        }
    })
    useEffect(() => {
        const element = sheet.current
        if (!element) return
        const touchStart = (event: TouchEvent) => {
            if (event.touches.length !== 1) return cancel()
            const touch = event.touches[0]!
            begin(touch.identifier, touch.clientX, touch.clientY, event.target)
        }
        const touchMove = (event: TouchEvent) => {
            if (event.touches.length !== 1) return cancel()
            const touch = event.touches[0]!
            if (touch.identifier === gesture.current?.id) move(touch.clientX, touch.clientY, event)
        }
        const touchEnd = (event: TouchEvent) => {
            const touch = Array.from(event.changedTouches).find(
                (item) => item.identifier === gesture.current?.id,
            )
            if (touch) finish(touch.clientY)
        }
        const pointerDown = (event: PointerEvent) => {
            if (event.pointerType === 'touch' || event.button !== 0) return
            begin(event.pointerId, event.clientX, event.clientY, event.target)
        }
        const pointerMove = (event: PointerEvent) => {
            if (event.pointerType === 'touch' || gesture.current?.id !== event.pointerId) return
            move(event.clientX, event.clientY, event)
        }
        const pointerUp = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' && gesture.current?.id === event.pointerId)
                finish(event.clientY)
        }
        const cancelPointer = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') cancel()
        }
        const click = (event: MouseEvent) => {
            if (event.detail > 0 && performance.now() < suppressClickUntil.current) {
                event.preventDefault()
                event.stopPropagation()
                suppressClickUntil.current = 0
            }
        }
        element.addEventListener('touchstart', touchStart, { passive: true })
        element.addEventListener('touchmove', touchMove, { passive: false })
        element.addEventListener('touchend', touchEnd)
        element.addEventListener('touchcancel', cancel)
        element.addEventListener('pointerdown', pointerDown)
        window.addEventListener('pointermove', pointerMove)
        window.addEventListener('pointerup', pointerUp)
        element.addEventListener('pointercancel', cancelPointer)
        element.addEventListener('click', click, true)
        window.addEventListener('blur', cancel)
        window.addEventListener('resize', cancel)
        return () => {
            cancel()
            element.removeEventListener('touchstart', touchStart)
            element.removeEventListener('touchmove', touchMove)
            element.removeEventListener('touchend', touchEnd)
            element.removeEventListener('touchcancel', cancel)
            element.removeEventListener('pointerdown', pointerDown)
            window.removeEventListener('pointermove', pointerMove)
            window.removeEventListener('pointerup', pointerUp)
            element.removeEventListener('pointercancel', cancelPointer)
            element.removeEventListener('click', click, true)
            window.removeEventListener('blur', cancel)
            window.removeEventListener('resize', cancel)
        }
    }, [sheet])
}
