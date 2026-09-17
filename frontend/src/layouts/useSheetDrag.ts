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
    halfHeight = 320,
    maxHeight = Infinity,
    resetKey,
    expandedPanel,
    close,
    setSnap,
}: {
    sheet: RefObject<HTMLElement | null>
    snap: Snap
    height: number
    halfHeight?: number
    maxHeight?: number
    resetKey: string
    expandedPanel: boolean
    close: () => void
    setSnap: (snap: Snap) => void
}) {
    const gesture = useRef<Gesture | null>(null)
    const frame = useRef(0)
    const physicalHeight = useRef(0)
    const attribution = useRef<HTMLElement[]>([])
    const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const suppressClickUntil = useRef(0)
    const clearMotion = useEffectEvent(() => {
        cancelAnimationFrame(frame.current)
        frame.current = 0
    })
    const rest = useEffectEvent(() => {
        const element = sheet.current
        if (!element) return
        if (element.hasAttribute('data-dragging')) {
            // Keep outgoing content painted until it has moved below the viewport.
            element.dataset.settling = 'true'
            clearTimeout(settling.current)
            settling.current = setTimeout(() => delete element.dataset.settling, 350)
        }
        delete element.dataset.dragging
        delete element.dataset.holding
        element.style.removeProperty('transform')
        for (const item of attribution.current) {
            item.style.removeProperty('transform')
            item.style.removeProperty('transition')
        }
    })
    const cancel = useEffectEvent(() => {
        gesture.current = null
        clearMotion()
        rest()
    })
    const paint = useEffectEvent((visibleHeight: number, dragging: boolean) => {
        const element = sheet.current
        if (!element) return
        if (dragging) {
            element.dataset.dragging = 'true'
        } else {
            delete element.dataset.dragging
        }
        // Only these composited layers change; per-move styles stay off the map
        // root and don't cascade into its tiles and pins.
        element.style.transform = `translate3d(0, ${physicalHeight.current - visibleHeight}px, 0)`
        for (const item of attribution.current) {
            item.style.transition = 'none'
            item.style.transform = `translateY(${-visibleHeight}px)`
        }
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
            Math.min(box.height, (viewport?.height || window.innerHeight) - 46 - bottom, maxHeight),
        )
        const visibleHeight = Math.max(
            0,
            (viewport?.bottom || window.innerHeight) - bottom - box.top,
        )
        clearMotion()
        clearTimeout(settling.current)
        delete element.dataset.settling
        physicalHeight.current = box.height
        attribution.current = Array.from(
            element.parentElement?.querySelectorAll<HTMLElement>('.leaflet-bottom') ?? [],
        )
        // Catch a settling sheet where it is now, rather than letting its old
        // transition continue underneath the finger until the drag threshold.
        element.dataset.holding = 'true'
        paint(visibleHeight, false)
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
            half: Math.min(halfHeight, limit),
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
            if (Math.max(Math.abs(delta), Math.abs(x - current.x)) < 3) return
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
        // Paint the latest finger position in this frame rather than enqueueing
        // another animation frame before the layer can move.
        paint(visibleHeight, true)
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
        const settled = (event: TransitionEvent) => {
            if (event.target !== element || event.propertyName !== 'transform') return
            clearTimeout(settling.current)
            delete element.dataset.settling
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
        element.addEventListener('transitionend', settled)
        window.addEventListener('blur', cancel)
        window.addEventListener('resize', cancel)
        return () => {
            cancel()
            clearTimeout(settling.current)
            delete element.dataset.settling
            element.removeEventListener('touchstart', touchStart)
            element.removeEventListener('touchmove', touchMove)
            element.removeEventListener('touchend', touchEnd)
            element.removeEventListener('touchcancel', cancel)
            element.removeEventListener('pointerdown', pointerDown)
            window.removeEventListener('pointermove', pointerMove)
            window.removeEventListener('pointerup', pointerUp)
            element.removeEventListener('pointercancel', cancelPointer)
            element.removeEventListener('click', click, true)
            element.removeEventListener('transitionend', settled)
            window.removeEventListener('blur', cancel)
            window.removeEventListener('resize', cancel)
        }
    }, [sheet])
}
