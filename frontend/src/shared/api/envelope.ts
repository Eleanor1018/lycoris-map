/**
 * Backend Auth envelope: `{"code":number,"message":string,"data":unknown}`.
 *
 * Only AuthController (`/api/login`, `/api/register`, `/api/me`, ...) uses this
 * shape. Marker read endpoints return a bare array/object, so this parser must
 * never be applied globally.
 */
export type AuthEnvelope<T> = {
    code: number
    message: string
    data: T
}

export function parseAuthEnvelope<T>(value: unknown): AuthEnvelope<T> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (typeof record['code'] !== 'number') return null
    if (typeof record['message'] !== 'string') return null
    return {
        code: record['code'],
        message: record['message'],
        data: record['data'] as T,
    }
}

/** Spring Security entry point body: `{"message":"Spring Security Error"}`. */
export function parseSpringSecurityMessage(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const message = (value as Record<string, unknown>)['message']
    return typeof message === 'string' ? message : null
}
