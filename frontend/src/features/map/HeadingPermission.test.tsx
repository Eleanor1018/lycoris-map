import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UiLanguage } from '@/shared/i18n/ui'
import { HeadingPermission } from './HeadingPermission'
import {
    enableDeviceHeading,
    headingPermissionRequired,
    resetHeadingPermissionForTests,
} from './useDeviceHeading'

beforeEach(() => localStorage.clear())

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetHeadingPermissionForTests()
})

function stub(sensor: boolean, touchPoints: number, requestPermission?: () => Promise<string>) {
    vi.stubGlobal(
        'DeviceOrientationEvent',
        sensor ? { requestPermission: requestPermission ?? (async () => 'granted') } : {},
    )
    Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => touchPoints,
    })
    // The store reads the device when it is (re)created.
    resetHeadingPermissionForTests()
}

function mount() {
    return render(
        <StrictMode>
            <UiLanguage language="en">
                <HeadingPermission />
            </UiLanguage>
        </StrictMode>,
    )
}

it('does not prompt or nag on a desktop with the API but no touch points', async () => {
    const requestPermission = vi.fn(async () => 'granted')
    stub(true, 0, requestPermission)
    mount()
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Enable heading' })).toBeNull()
    expect(requestPermission).not.toHaveBeenCalled()
})

it('renders the enable guide on a touch device and asks only from the click', async () => {
    const requestPermission = vi.fn(async () => 'denied')
    stub(true, 5, requestPermission)
    mount()
    const enable = await screen.findByRole('button', { name: 'Enable heading' })
    expect(requestPermission).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enable heading' })).toBeInTheDocument()
    requestPermission.mockResolvedValue('granted')
    fireEvent.click(enable)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable heading' })).toBeNull())
})

it('remembers a dismissed guide across page reloads without requesting access', async () => {
    const requestPermission = vi.fn(async () => 'granted')
    stub(true, 5, requestPermission)
    expect(headingPermissionRequired()).toBe(true)
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    first.unmount()
    resetHeadingPermissionForTests()
    mount()
    expect(screen.queryByRole('button', { name: 'Enable heading' })).toBeNull()
    expect(requestPermission).not.toHaveBeenCalled()
    // Locate remains an explicit way to enable the compass after dismissing.
    await act(async () => {
        await enableDeviceHeading()
    })
    expect(requestPermission).toHaveBeenCalledTimes(1)
})

it.each(['granted', 'denied'])(
    'remembers an answered %s choice without prompting on reload',
    async (answer) => {
        const requestPermission = vi.fn(async () => answer)
        stub(true, 5, requestPermission)
        const first = mount()
        fireEvent.click(screen.getByRole('button', { name: 'Enable heading' }))
        await act(async () => {})
        first.unmount()
        resetHeadingPermissionForTests()
        mount()
        await act(async () => {})
        expect(screen.queryByRole('status')).toBeNull()
        expect(requestPermission).toHaveBeenCalledTimes(1)
        // The next real gesture checks the browser again, not the stored choice.
        requestPermission.mockResolvedValue('granted')
        await act(async () => {
            await enableDeviceHeading()
        })
        expect(requestPermission).toHaveBeenCalledTimes(2)
    },
)

it('still allows enabling and dismissing when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
    })
    const requestPermission = vi.fn(async () => 'denied')
    stub(true, 5, requestPermission)
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Enable heading' }))
    await waitFor(() => expect(screen.getByText(/Compass access is blocked/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('status')).toBeNull()
})

it('shows the settings message only after an explicit tap is denied, and dismisses', async () => {
    const requestPermission = vi.fn(async () => 'denied')
    stub(true, 5, requestPermission)
    mount()
    const enable = await screen.findByRole('button', { name: 'Enable heading' })
    fireEvent.click(enable)
    await waitFor(() => expect(screen.getByText(/Compass access is blocked/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText(/Compass access is blocked/)).toBeNull()
})

it('treats a synchronous requestPermission throw as a retryable prompt', async () => {
    const requestPermission = vi.fn(() => {
        throw new DOMException('needs activation', 'NotAllowedError')
    })
    stub(true, 5, requestPermission)
    mount()
    const enable = await screen.findByRole('button', { name: 'Enable heading' })
    expect(() => fireEvent.click(enable)).not.toThrow()
    await act(async () => {
        await enableDeviceHeading()
    })
    expect(await screen.findByRole('button', { name: 'Enable heading' })).toBeInTheDocument()
})
