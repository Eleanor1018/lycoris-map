import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { openingStatus, useOpeningStatus } from './openingStatus'

const hours = { openTimeStart: '09:00', openTimeEnd: '22:00', hoursTimezone: 'Asia/Shanghai' }
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})
it('uses the server time zone and starts warning exactly 30 minutes before closing', () => {
    expect(openingStatus(hours, new Date('2026-09-20T13:29:59Z'))).toBe('open')
    expect(openingStatus(hours, new Date('2026-09-20T13:30:00Z'))).toBe('closing-soon')
    expect(openingStatus(hours, new Date('2026-09-20T13:59:59Z'))).toBe('closing-soon')
    expect(openingStatus(hours, new Date('2026-09-20T14:00:00Z'))).toBe('closed')
    expect(openingStatus(hours, new Date('2026-09-20T00:59:59Z'))).toBe('closed')
    expect(openingStatus(hours, new Date('2026-09-20T01:00:00Z'))).toBe('open')
})
it('handles overnight hours, midnight closing and all-day availability', () => {
    const overnight = { ...hours, openTimeStart: '22:00', openTimeEnd: '06:00' }
    expect(openingStatus(overnight, new Date('2026-09-20T15:59:59Z'))).toBe('open')
    expect(openingStatus(overnight, new Date('2026-09-20T21:30:00Z'))).toBe('closing-soon')
    expect(openingStatus(overnight, new Date('2026-09-20T22:00:00Z'))).toBe('closed')
    expect(
        openingStatus({ ...hours, openTimeEnd: '00:00' }, new Date('2026-09-20T15:30:00Z')),
    ).toBe('closing-soon')
    expect(
        openingStatus({ ...hours, openTimeEnd: '09:00' }, new Date('2026-09-20T00:45:00Z')),
    ).toBe('open')
})
it('does not invent status for absent/invalid hours or an unknown time zone', () => {
    const now = new Date('2026-09-20T13:45:00Z')
    expect(openingStatus({ ...hours, openTimeStart: null }, now)).toBe('unknown')
    expect(openingStatus({ ...hours, openTimeEnd: '24:00' }, now)).toBe('unknown')
    expect(openingStatus({ ...hours, hoursTimezone: undefined }, now)).toBe('scheduled')
    expect(openingStatus({ ...hours, hoursTimezone: 'not-a-zone' }, now)).toBe('scheduled')
    expect(openingStatus(null, now)).toBe('unknown')
})
it('uses IANA daylight-saving rules rather than a fixed UTC offset', () => {
    const ny = { ...hours, hoursTimezone: 'America/New_York' }
    expect(openingStatus(ny, new Date('2026-07-02T01:45:00Z'))).toBe('closing-soon')
    expect(openingStatus(ny, new Date('2026-01-02T02:45:00Z'))).toBe('closing-soon')
})
it('updates an already-open detail at the boundary and when returning from another app', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T13:29:59Z'))
    const view = renderHook(() => useOpeningStatus(hours))
    expect(view.result.current).toBe('open')
    act(() => vi.advanceTimersByTime(1000))
    expect(view.result.current).toBe('closing-soon')
    act(() => {
        vi.setSystemTime(new Date('2026-09-20T14:00:00Z'))
        window.dispatchEvent(new Event('pageshow'))
    })
    expect(view.result.current).toBe('closed')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
})
