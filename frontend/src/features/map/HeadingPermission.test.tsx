import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiLanguage } from '@/shared/i18n/ui'
import { HeadingPermission } from './HeadingPermission'
import {
    enableDeviceHeading,
    headingPermissionRequired,
    requestDeviceHeading,
    resetHeadingPermissionForTests,
} from './useDeviceHeading'

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
    // A silent page-load restore that is refused must not remove the guide.
    const requestPermission = vi.fn(async () => 'denied')
    stub(true, 5, requestPermission)
    mount()
    const enable = await screen.findByRole('button', { name: 'Enable heading' })
    await waitFor(() => expect(requestPermission).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Enable heading' })).toBeInTheDocument()
    requestPermission.mockResolvedValue('granted')
    fireEvent.click(enable)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable heading' })).toBeNull())
})

it('keeps the Enable button after a silent restore denial so the user can tap once', async () => {
    const requestPermission = vi.fn(async () => 'denied')
    stub(true, 5, requestPermission)
    expect(headingPermissionRequired()).toBe(true)
    // The page-load restore is silent: a denial here must not become a
    // permanent settings message before the user ever tapped.
    expect(await requestDeviceHeading()).toBe('prompt')
    mount()
    expect(await screen.findByRole('button', { name: 'Enable heading' })).toBeInTheDocument()
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
