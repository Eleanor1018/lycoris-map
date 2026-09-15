import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { LanguageProvider } from '@/shared/i18n'
import { QaPage } from './QaPage'
afterEach(cleanup)
it('keeps map diagnostics and directs account testing to the single product session owner', () => {
    render(
        <LanguageProvider>
            <QaPage />
        </LanguageProvider>,
    )
    expect(screen.getByRole('link', { name: /Open the map/ })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.querySelector('iframe')).toHaveAttribute('src', '/__dev/map-spike')
})
