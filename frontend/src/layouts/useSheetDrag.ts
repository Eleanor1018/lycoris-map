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
    scrollTop: number
    dragging: boolean
    lastY: number
    lastTime: number
    velocity: number
}

/** Let native scrolling win in an expanded panel, except a downward pull at its top. */
export function useSheetDrag({
    sheet,
    snap,
    expandedPanel,
    close,
    setSnap,
    setDragHeight,
}: {
    sheet: RefObject<HTMLElement | null>
    snap: Snap
    expandedPanel: boolean
    close: () => void
    setSnap: (snap: Snap) => void
    setDragHeight: (height: number | null) => void
}) {
    const gesture = useRef<Gesture | null>(null)
    const suppressClickUntil = useRef(0)
    useEffect(() => {
        if (snap === 'full') return
        const content = sheet.current?.querySelector<HTMLElement>('.sheet-scroll')
        if (content) content.scrollTop = 0
    }, [snap, sheet])
    const cancel = useEffectEvent(() => {
        gesture.current = null
        setDragHeight(null)
    })
    const begin = useEffectEvent((id: number, x: number, y: number, target: EventTarget | null) => {
        suppressClickUntil.current = 0
        const element = sheet.current
        if (!element || !(target instanceof Element)) return
        // Text selection, range inputs, editing and keyboard focus belong to the form.
        if (target.closest('input, textarea, select, [contenteditable="true"], [role="slider"]'))
            return
        const scroll = element.querySelector<HTMLElement>('.sheet-scroll')
        const viewport = element.parentElement?.getBoundingClientRect().height || window.innerHeight
        const safeBottom = Math.max(
            0,
            (parseFloat(getComputedStyle(element).bottom) || 0) -
                (snap === 'full' && !element.classList.contains('mobile-detail') ? 8 : 0),
        )
        const max = Math.max(1, viewport - 54 - safeBottom)
        gesture.current = {
            id,
            x,
            y,
            height: element.getBoundingClientRect().height,
            min: Math.min(158, max),
            half: Math.min(320, max),
            max,
            handle: Boolean(target.closest('.sheet-handle')),
            scrollTop: scroll?.scrollTop ?? 0,
            dragging: false,
            lastY: y,
            lastTime: performance.now(),
            velocity: 0,
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
                    (current.scrollTop > 0 || delta > 0))
            ) {
                gesture.current = null
                return
            }
            // If the browser already owns this gesture, never resize underneath it.
            if (!event.cancelable) return cancel()
            current.dragging = true
        }
        event.preventDefault()
        const now = performance.now()
        const elapsed = now - current.lastTime
        if (elapsed > 0) current.velocity = (current.lastY - y) / elapsed
        current.lastTime = now
        current.lastY = y
        setDragHeight(Math.max(current.min, Math.min(current.max, current.height + delta)))
    })
    const finish = useEffectEvent((y: number) => {
        const current = gesture.current
        if (!current) return
        if (current.dragging) {
            suppressClickUntil.current = performance.now() + 500
            if (expandedPanel) {
                if (y - current.y > 48) close()
            } else {
                const velocity = performance.now() - current.lastTime < 100 ? current.velocity : 0
                const height = current.height + current.y - y
                const choices: [Snap, number][] = [
                    ['collapsed', current.min],
                    ['half', current.half],
                    ['full', current.max],
                ]
                const projected =
                    height +
                    (Math.abs(velocity) > 0.45 ? Math.max(-1.2, Math.min(1.2, velocity)) * 160 : 0)
                const nearest = [...choices].sort(
                    (a, b) => Math.abs(a[1] - projected) - Math.abs(b[1] - projected),
                )[0]!
                setSnap(nearest[0])
            }
        }
        cancel()
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
            if (gesture.current?.dragging && !element.hasPointerCapture(event.pointerId))
                element.setPointerCapture(event.pointerId)
        }
        const pointerUp = (event: PointerEvent) => {
            if (event.pointerType === 'touch' || gesture.current?.id !== event.pointerId) return
            finish(event.clientY)
            if (element.hasPointerCapture(event.pointerId))
                element.releasePointerCapture(event.pointerId)
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
        // React's touch listeners are passive. The native non-passive listener is
        // needed to claim a sheet drag before Safari/Chrome turn it into scrolling.
        element.addEventListener('touchstart', touchStart, { passive: true })
        element.addEventListener('touchmove', touchMove, { passive: false })
        element.addEventListener('touchend', touchEnd)
        element.addEventListener('touchcancel', cancel)
        element.addEventListener('pointerdown', pointerDown)
        element.addEventListener('pointermove', pointerMove)
        element.addEventListener('pointerup', pointerUp)
        element.addEventListener('pointercancel', cancelPointer)
        element.addEventListener('lostpointercapture', cancelPointer)
        element.addEventListener('click', click, true)
        window.addEventListener('blur', cancel)
        window.addEventListener('resize', cancel)
        return () => {
            element.removeEventListener('touchstart', touchStart)
            element.removeEventListener('touchmove', touchMove)
            element.removeEventListener('touchend', touchEnd)
            element.removeEventListener('touchcancel', cancel)
            element.removeEventListener('pointerdown', pointerDown)
            element.removeEventListener('pointermove', pointerMove)
            element.removeEventListener('pointerup', pointerUp)
            element.removeEventListener('pointercancel', cancelPointer)
            element.removeEventListener('lostpointercapture', cancelPointer)
            element.removeEventListener('click', click, true)
            window.removeEventListener('blur', cancel)
            window.removeEventListener('resize', cancel)
        }
    }, [sheet])
}
