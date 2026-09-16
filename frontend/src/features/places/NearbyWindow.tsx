import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Marker } from '@/shared/api/markers'
import type { PlaceBrowse } from './usePlaceBrowse'
import { publicImageUrl } from './model'

/** Nearby cards have variable heights (wrapping text, absent or failed photos).
 * Measure visible rows and retain those measurements with the list's position. */
export function NearbyWindow({
    browse,
    listKey,
    label,
    mobile,
    children,
}: {
    browse: PlaceBrowse
    listKey: string
    label: string
    mobile: boolean
    children: (place: Marker) => ReactNode
}) {
    const { results } = browse
    const saved = browse.listPositions.current.get(listKey)
    const list = useRef<HTMLDivElement>(null)
    const sizes = useRef(saved?.sizes ?? new Map<number, number>())
    const [offset, setOffset] = useState(saved?.offset ?? 0)
    const active = useRef(saved?.active ?? 0)
    const keyboardTarget = useRef<number | null>(null)
    const [box, setBox] = useState({ width: saved?.width ?? 288, height: 800 })
    const [, measured] = useState(0)
    const virtual = results.length > 100
    const offsets = (width: number) => {
        const result = [0]
        for (const place of results) {
            const photo = publicImageUrl(place.markImage) ? (mobile ? (width * 157) / 280 : 157) : 0
            const estimate = 48 + 20 + photo + (place.description ? 60 : 0) + 54 + 24
            result.push(result[result.length - 1]! + (sizes.current.get(place.id) ?? estimate))
        }
        return result
    }
    const tops = offsets(box.width)
    const first = Math.max(
        0,
        tops.findIndex((_top, i) => i < results.length && tops[i + 1]! > offset),
    )
    const start = virtual ? Math.max(0, first - 3) : 0
    const last = tops.findIndex((top) => top > offset + box.height)
    const end = virtual
        ? Math.min(results.length, (last < 0 ? results.length : last) + 3)
        : results.length
    const remember = (nextOffset: number, nextActive = active.current) => {
        active.current = nextActive
        browse.listPositions.current.set(listKey, {
            offset: nextOffset,
            active: nextActive,
            sizes: sizes.current,
            width: box.width,
        })
        setOffset(nextOffset)
    }
    useLayoutEffect(() => {
        const element = list.current
        if (!element) return
        const measure = () => {
            const before = offsets(box.width)
            const target = keyboardTarget.current
            const anchor =
                target ??
                Math.max(
                    0,
                    before.findIndex(
                        (_top, i) => i < results.length && before[i + 1]! > element.scrollTop,
                    ),
                )
            const withinRow = target === null ? element.scrollTop - (before[anchor] ?? 0) : 0
            const width = element.clientWidth || box.width
            const resized = width !== box.width
            if (resized) {
                sizes.current.clear()
                setBox({ width, height: element.clientHeight || 800 })
            } else if (element.clientHeight && element.clientHeight !== box.height)
                setBox({ ...box, height: element.clientHeight })
            let changed = resized
            for (const row of element.querySelectorAll<HTMLElement>('[data-nearby-id]')) {
                const id = Number(row.dataset.nearbyId),
                    height = row.getBoundingClientRect().height
                if (height > 0 && sizes.current.get(id) !== height) {
                    sizes.current.set(id, height)
                    changed = true
                }
            }
            if (changed) {
                // Keep the same row visible as measured heights replace estimates.
                // A keyboard jump stays pinned to its target until user scrolling.
                const nextOffset = (offsets(width)[anchor] ?? 0) + withinRow
                remember(nextOffset)
                element.scrollTop = nextOffset
                measured((n) => n + 1)
            }
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        for (const row of element.querySelectorAll('[data-nearby-id]')) observer.observe(row)
        return () => observer.disconnect()
    }, [box, start, end, results])
    return (
        <div
            ref={(element) => {
                list.current = element
                if (element) element.scrollTop = offset
            }}
            className="nearby-result-scroll"
            role="list"
            aria-label={label}
            tabIndex={virtual ? 0 : undefined}
            onWheel={() => {
                keyboardTarget.current = null
            }}
            onPointerDown={() => {
                keyboardTarget.current = null
            }}
            onTouchStart={() => {
                keyboardTarget.current = null
            }}
            onScroll={(event) => remember(event.currentTarget.scrollTop)}
            onFocusCapture={(event) => {
                const row = event.target.closest<HTMLElement>('[data-row]')
                if (row) remember(event.currentTarget.scrollTop, Number(row.dataset.row))
            }}
            onKeyDown={(event) => {
                if (!virtual || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    keyboardTarget.current = null
                    return
                }
                event.preventDefault()
                const next =
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? results.length - 1
                          : Math.max(
                                0,
                                Math.min(
                                    results.length - 1,
                                    active.current + (event.key === 'ArrowDown' ? 1 : -1),
                                ),
                            )
                keyboardTarget.current = next
                const element = event.currentTarget
                element.scrollTop = tops[next] ?? 0
                remember(element.scrollTop, next)
                requestAnimationFrame(() =>
                    element
                        .querySelector<HTMLButtonElement>(`[data-row="${next}"] button`)
                        ?.focus({ preventScroll: true }),
                )
            }}
        >
            {virtual && <div aria-hidden style={{ height: tops[start] }} />}
            {results.slice(start, end).map((place, index) => (
                <div
                    key={place.id}
                    className="nearby-row"
                    data-row={start + index}
                    data-nearby-id={place.id}
                    role="listitem"
                    aria-posinset={start + index + 1}
                    aria-setsize={results.length}
                >
                    {children(place)}
                </div>
            ))}
            {virtual && <div aria-hidden style={{ height: tops[results.length]! - tops[end]! }} />}
        </div>
    )
}
