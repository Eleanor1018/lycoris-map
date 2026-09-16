import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider, resolveBrowserStorage, useLanguage } from './LanguageProvider'

function Probe() {
    const { language, t, setPreference } = useLanguage()
    return (
        <div>
            <span data-testid="language">{language}</span>
            <span data-testid="retry">{t('backend.retry')}</span>
            <button type="button" onClick={() => setPreference('en')}>
                switch
            </button>
        </div>
    )
}

const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

afterEach(() => {
    if (originalDescriptor) {
        Object.defineProperty(window, 'localStorage', originalDescriptor)
    }
    vi.restoreAllMocks()
})

/** Make the `window.localStorage` getter itself throw, like a blocked origin. */
function blockLocalStorageGetter() {
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
            throw new DOMException('Access is denied for this document.', 'SecurityError')
        },
    })
}

describe('resolveBrowserStorage', () => {
    it('returns null when the localStorage getter throws', () => {
        blockLocalStorageGetter()
        expect(resolveBrowserStorage()).toBeNull()
    })
})

describe('LanguageProvider with blocked storage', () => {
    it('renders and still switches language when the getter throws', async () => {
        blockLocalStorageGetter()
        const user = userEvent.setup()

        render(
            <LanguageProvider navigatorLanguage="zh-CN">
                <Probe />
            </LanguageProvider>,
        )

        expect(screen.getByTestId('language')).toHaveTextContent('zh')
        expect(screen.getByTestId('retry')).toHaveTextContent('重试')
        expect(document.documentElement.lang).toBe('zh-CN')

        await user.click(screen.getByRole('button', { name: 'switch' }))

        expect(screen.getByTestId('language')).toHaveTextContent('en')
        expect(screen.getByTestId('retry')).toHaveTextContent('Retry')
        expect(document.documentElement.lang).toBe('en')
    })

    it('does not render a blank tree when storage access is denied', () => {
        blockLocalStorageGetter()
        render(
            <LanguageProvider navigatorLanguage="en-US">
                <Probe />
            </LanguageProvider>,
        )
        expect(screen.getByTestId('language')).toHaveTextContent('en')
        expect(document.documentElement.lang).toBe('en')
    })
})
