import { describe, expect, it } from 'vitest'
import {
    LANGUAGE_STORAGE_KEY,
    persistPreference,
    readStoredPreference,
    resolveLanguage,
    resolveSystemLanguage,
    toHtmlLang,
} from './LanguageProvider'
import { messages, translate } from './messages'

function memoryStorage(initial?: string) {
    let value = initial ?? null
    return {
        getItem: (key: string) => (key === LANGUAGE_STORAGE_KEY ? value : null),
        setItem: (key: string, next: string) => {
            if (key === LANGUAGE_STORAGE_KEY) value = next
        },
    }
}

function throwingStorage() {
    return {
        getItem: () => {
            throw new Error('denied')
        },
        setItem: () => {
            throw new Error('denied')
        },
    }
}

describe('language resolution', () => {
    it('prefers an explicit preference over the navigator language', () => {
        expect(resolveLanguage('en', 'zh-CN')).toBe('en')
        expect(resolveLanguage('zh', 'en-US')).toBe('zh')
    })

    it('uses the navigator language for the system preference', () => {
        expect(resolveLanguage('system', 'en-GB')).toBe('en')
        expect(resolveLanguage('system', 'zh-Hans-CN')).toBe('zh')
        expect(resolveLanguage('system', 'fr-FR')).toBe('zh')
    })

    it('normalises system locales', () => {
        expect(resolveSystemLanguage('en')).toBe('en')
        expect(resolveSystemLanguage('en_US')).toBe('zh')
        expect(resolveSystemLanguage('zh-TW')).toBe('zh')
    })
})

describe('preference restore', () => {
    it('restores a stored preference', () => {
        expect(readStoredPreference(memoryStorage('en'))).toBe('en')
        expect(readStoredPreference(memoryStorage('zh'))).toBe('zh')
    })

    it('falls back to system for missing or invalid values', () => {
        expect(readStoredPreference(memoryStorage())).toBe('system')
        expect(readStoredPreference(memoryStorage('fr'))).toBe('system')
    })

    it('works when localStorage is unavailable', () => {
        expect(readStoredPreference(null)).toBe('system')
        expect(readStoredPreference(throwingStorage())).toBe('system')
        expect(() => persistPreference(throwingStorage(), 'en')).not.toThrow()
        expect(() => persistPreference(null, 'en')).not.toThrow()
    })

    it('persists what it restores', () => {
        const storage = memoryStorage()
        persistPreference(storage, 'en')
        expect(readStoredPreference(storage)).toBe('en')
    })
})

describe('html lang', () => {
    it('maps the language to a BCP-47 tag', () => {
        expect(toHtmlLang('zh')).toBe('zh-CN')
        expect(toHtmlLang('en')).toBe('en')
    })
})

describe('messages', () => {
    it('translates known keys per language', () => {
        expect(translate('zh', 'backend.retry')).toBe('重试')
        expect(translate('en', 'backend.retry')).toBe('Retry')
    })

    it('interpolates values and keeps unknown placeholders intact', () => {
        expect(translate('en', 'backend.error.status', { status: 503 })).toBe(
            'The backend answered with status 503.',
        )
        expect(translate('en', 'backend.retry', { other: 1 })).toBe('Retry')
    })

    it('keeps zh and en in sync for every message', () => {
        for (const [key, value] of Object.entries(messages)) {
            expect(value.zh.length, key).toBeGreaterThan(0)
            expect(value.en.length, key).toBeGreaterThan(0)
        }
    })
})
