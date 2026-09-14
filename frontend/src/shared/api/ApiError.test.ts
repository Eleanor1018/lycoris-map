import { describe, expect, it } from 'vitest'
import { ApiError, isApiError } from './ApiError'
import { parseAuthEnvelope, parseSpringSecurityMessage } from './envelope'

describe('parseAuthEnvelope', () => {
    it('accepts the Auth shape and keeps data', () => {
        const parsed = parseAuthEnvelope<{ id: number }>({
            code: 0,
            message: 'ok',
            data: { id: 7 },
        })
        expect(parsed).toEqual({ code: 0, message: 'ok', data: { id: 7 } })
    })

    it('rejects bare JSON payloads', () => {
        expect(parseAuthEnvelope({ id: 7 })).toBeNull()
        expect(parseAuthEnvelope([{ id: 7 }])).toBeNull()
        expect(parseAuthEnvelope('ok')).toBeNull()
        expect(parseAuthEnvelope(null)).toBeNull()
    })

    it('rejects a partial envelope', () => {
        expect(parseAuthEnvelope({ code: 0 })).toBeNull()
        expect(parseAuthEnvelope({ message: 'ok' })).toBeNull()
    })
})

describe('parseSpringSecurityMessage', () => {
    it('reads the fixed security entry body', () => {
        expect(parseSpringSecurityMessage({ message: 'Spring Security Error' })).toBe(
            'Spring Security Error',
        )
    })

    it('ignores other shapes', () => {
        expect(parseSpringSecurityMessage({ message: 3 })).toBeNull()
        expect(parseSpringSecurityMessage([])).toBeNull()
    })
})

describe('ApiError', () => {
    it('keeps status, business code and request id', () => {
        const error = new ApiError(401, 'Invalid username or password', {
            code: 4001,
            requestId: 'req-1',
        })
        expect(isApiError(error)).toBe(true)
        expect(error.status).toBe(401)
        expect(error.code).toBe(4001)
        expect(error.requestId).toBe('req-1')
        expect(error.message).toBe('Invalid username or password')
    })

    it('allows optional metadata to be absent', () => {
        const error = new ApiError(404, 'HTTP 404')
        expect(error.code).toBeUndefined()
        expect(error.requestId).toBeUndefined()
    })

    it('represents a network failure with status 0', () => {
        const error = ApiError.network('网络请求失败，请检查网络连接')
        expect(error.status).toBe(0)
        expect(isApiError(error)).toBe(true)
    })
})
