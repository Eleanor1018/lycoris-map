/**
 * Auth endpoints used by the S1 QA diagnostics page.
 *
 * Contract (`backend/src/routes/auth.rs`, `dto.rs`):
 * - `POST /api/login` body `{username, password}`; success is the Auth envelope
 *   `{code, message, data: UserResponse | null}`.
 * - `GET /api/me` returns the same envelope with `data: UserResponse | null`.
 * - `POST /api/logout` returns the envelope with `data: null`.
 * - `GET /api/me/avatar` streams an image (Blob) or answers 404 with an empty
 *   body; it is never JSON.
 *
 * These are the real endpoints. S1 only exposes them on the diagnostics page;
 * the product login/registration UI arrives in S4.
 */

import { z } from 'zod'
import { request, requestBlob } from './transport'
import { parseAuthEnvelope } from './envelope'
import { userOrNullSchema, type User } from './users'

export type LoginInput = {
    username: string
    password: string
}

const loginResponseSchema = z.object({ code: z.number(), message: z.string() })

function readEnvelopeData(body: unknown): unknown {
    const envelope = parseAuthEnvelope(body)
    if (!envelope) throw new Error('response is not an Auth envelope')
    return envelope.data
}

/** `POST /api/login`; resolves the authenticated user (or `null`). */
export async function login(input: LoginInput): Promise<User | null> {
    const body = await request('/api/login', {
        method: 'POST',
        json: { username: input.username, password: input.password },
    })
    const parsed = loginResponseSchema.parse(body)
    if (parsed.code !== 0) throw new Error(parsed.message)
    return userOrNullSchema.parse(readEnvelopeData(body))
}

/** `GET /api/me`; resolves the current user or `null` when anonymous. */
export async function fetchMe(): Promise<User | null> {
    const body = await request('/api/me')
    return userOrNullSchema.parse(readEnvelopeData(body))
}

/** `POST /api/logout`; success is an empty envelope body. */
export async function logout(): Promise<void> {
    await request('/api/logout', { method: 'POST' })
}

/** `GET /api/me/avatar`; binary stream, so it uses `requestBlob`. */
export async function fetchMyAvatar(): Promise<Blob> {
    return requestBlob('/api/me/avatar')
}

/** `POST /api/me/avatar` with the single `file` multipart field. */
export async function uploadMyAvatar(file: File): Promise<User | null> {
    const form = new FormData()
    form.set('file', file)
    const body = await request('/api/me/avatar', { method: 'POST', body: form })
    return userOrNullSchema.parse(readEnvelopeData(body))
}
