/**
 * Minimal fetch adapter over the real Rust backend contract.
 *
 * Contract notes (verified in `backend/src`):
 * - Browsers use HttpOnly cookies, so every request sends `credentials: 'include'`.
 * - `AbortSignal` is passed straight to `fetch`.
 * - Bodies are parsed by `parseBody`: JSON, text, or empty. A 200/204 with an
 *   empty body resolves to `undefined` (e.g. favorite add/remove, logout).
 * - Non-2xx responses become `ApiError(status, code?, message, requestId?)`.
 *   `code` is taken from the Auth envelope when present; plain JSON `{message}`,
 *   plain text, and empty bodies fall back to a status-derived message.
 * - `X-Request-ID` is captured when the backend exposes it.
 * - A 401 NEVER mutates global auth state here. Session identity changes belong
 *   to the S4 auth layer, which compares the request's authEpoch.
 */

import { ApiError } from './ApiError'
import { parseAuthEnvelope, parseSpringSecurityMessage } from './envelope'

export type RequestOptions = {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    /** Query parameters; `undefined`/`null` entries are omitted. */
    query?: Record<string, string | number | boolean | undefined | null>
    /** JSON body; serialized with `Content-Type: application/json`. */
    json?: unknown
    /** Pre-built body (e.g. multipart); never combined with `json`. */
    body?: BodyInit
    /** Explicit headers merged after defaults. */
    headers?: Record<string, string>
    signal?: AbortSignal
    /** Base URL override; defaults to the same-origin proxy. */
    baseUrl?: string
}

export const DEFAULT_BASE_URL = ''

function buildUrl(path: string, query: RequestOptions['query'], baseUrl: string): string {
    const url = `${baseUrl}${path}`
    if (!query) return url
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue
        params.set(key, String(value))
    }
    const serialized = params.toString()
    return serialized ? `${url}?${serialized}` : url
}

async function parseBody(response: Response): Promise<unknown> {
    const raw = await response.text()
    if (raw.trim() === '') return undefined
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('json')) {
        try {
            return JSON.parse(raw) as unknown
        } catch {
            return raw
        }
    }
    return raw
}

/**
 * Binary counterpart of [`parseBody`] for response bodies that are not text.
 *
 * `GET /api/me/avatar` and `GET /api/users/{publicId}/avatar` stream image
 * bytes, so calling `response.text()` on them would corrupt the payload and
 * could not be re-read. Only non-2xx responses are read as text there, because
 * the backend answers those with JSON/text or an empty body.
 */
async function parseBlobOrDefault(response: Response): Promise<unknown> {
    if (!response.ok) return parseBody(response)
    return response.blob()
}

function messageFromBody(status: number, body: unknown): { code?: number; message: string } {
    const envelope = parseAuthEnvelope(body)
    if (envelope) {
        return envelope.code === 0
            ? { code: envelope.code, message: envelope.message }
            : { code: envelope.code, message: envelope.message || `HTTP ${status}` }
    }
    const securityMessage = parseSpringSecurityMessage(body)
    if (securityMessage) return { message: securityMessage }
    if (typeof body === 'string' && body.trim() !== '') return { message: body.trim() }
    return { message: `HTTP ${status}` }
}

/**
 * Options for [`requestBlob`] only.
 *
 * Binary reads are plain GETs, so the write-oriented fields of
 * [`RequestOptions`] (`method`, `json`, `body`) are intentionally NOT part of
 * this type: the signature must not promise behaviour it does not implement.
 */
export type BlobRequestOptions = {
    /** Query parameters; `undefined`/`null` entries are omitted. */
    query?: Record<string, string | number | boolean | undefined | null>
    /** Explicit headers merged after the default `Accept: image/*`. */
    headers?: Record<string, string>
    signal?: AbortSignal
    /** Base URL override; defaults to the same-origin proxy. */
    baseUrl?: string
}

/**
 * Perform one GET request and return its parsed body.
 *
 * The caller decides the expected shape (bare array, Auth envelope, text,
 * `undefined` for empty success) and validates it with Zod where a stable DTO
 * exists.
 */
export async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    const url = buildUrl(path, options.query, baseUrl)

    const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' }
    let body: BodyInit | undefined
    if (options.json !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(options.json)
    } else if (options.body !== undefined) {
        body = options.body
    }
    Object.assign(headers, options.headers ?? {})

    let response: Response
    try {
        response = await fetch(url, {
            method: options.method ?? 'GET',
            headers,
            credentials: 'include',
            ...(body === undefined ? {} : { body }),
            ...(options.signal ? { signal: options.signal } : {}),
        })
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw ApiError.network('网络请求失败，请检查网络连接')
    }

    const requestId = response.headers.get('x-request-id') ?? undefined
    const parsed = await parseBody(response)

    if (!response.ok) {
        const { code, message } = messageFromBody(response.status, parsed)
        throw new ApiError(response.status, message, { code, requestId })
    }

    return parsed
}

/**
 * GET a binary body (avatar image streams) and resolve a `Blob`.
 *
 * Always a GET with no request body. This never guesses JSON: a successful
 * response is returned as raw bytes, while a non-2xx response is still parsed
 * as JSON/text/empty so the caller gets the usual
 * `ApiError(status, code?, message, requestId?)`.
 */
export async function requestBlob(path: string, options: BlobRequestOptions = {}): Promise<Blob> {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    const url = buildUrl(path, options.query, baseUrl)

    const headers: Record<string, string> = { Accept: 'image/*' }
    Object.assign(headers, options.headers ?? {})

    let response: Response
    try {
        response = await fetch(url, {
            method: 'GET',
            headers,
            credentials: 'include',
            ...(options.signal ? { signal: options.signal } : {}),
        })
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw ApiError.network('网络请求失败，请检查网络连接')
    }

    const requestId = response.headers.get('x-request-id') ?? undefined
    const parsed = await parseBlobOrDefault(response)

    if (!response.ok) {
        const { code, message } = messageFromBody(response.status, parsed)
        throw new ApiError(response.status, message, { code, requestId })
    }

    return parsed as Blob
}
