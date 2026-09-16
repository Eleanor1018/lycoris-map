import { request, requestBlob } from './transport'
import { parseAuthEnvelope } from './envelope'
import { ApiError } from './ApiError'
import { userOrNullSchema, type User } from './users'

export type LoginInput = { username: string; password: string }
export type RegisterInput = LoginInput & { email: string; nickname?: string; website?: string }
export type ProfileInput = { nickname?: string; pronouns?: string; signature?: string }
export type PasswordInput = { oldPassword: string; newPassword: string }

function envelopeData(body: unknown): unknown {
    const envelope = parseAuthEnvelope(body)
    if (!envelope) throw new Error('Invalid account response')
    if (envelope.code !== 0) throw new ApiError(200, envelope.message, { code: envelope.code })
    return envelope.data
}
export async function login(input: LoginInput): Promise<User | null> {
    return userOrNullSchema.parse(
        envelopeData(await request('/api/login', { method: 'POST', json: input })),
    )
}
export async function register(input: RegisterInput): Promise<User | null> {
    return userOrNullSchema.parse(
        envelopeData(await request('/api/register', { method: 'POST', json: input })),
    )
}
export async function fetchMe(signal?: AbortSignal): Promise<User | null> {
    return userOrNullSchema.parse(
        envelopeData(
            await request('/api/me', { ...(signal ? { signal } : {}), cache: 'no-store' }),
        ),
    )
}
export async function logout(): Promise<void> {
    envelopeData(await request('/api/logout', { method: 'POST' }))
}
export async function updateProfile(
    input: ProfileInput,
    signal: AbortSignal,
): Promise<User | null> {
    return userOrNullSchema.parse(
        envelopeData(await request('/api/me', { method: 'PATCH', json: input, signal })),
    )
}
export async function changePassword(input: PasswordInput): Promise<void> {
    envelopeData(await request('/api/me/password', { method: 'POST', json: input }))
}
export async function fetchMyAvatar(signal?: AbortSignal): Promise<Blob> {
    // /me/avatar has a public ten-minute cache on the backend. Its bytes must
    // never be reused for a different Cookie identity.
    return requestBlob('/api/me/avatar', { ...(signal ? { signal } : {}), cache: 'no-store' })
}
export async function uploadMyAvatar(file: File, signal?: AbortSignal): Promise<User | null> {
    const form = new FormData()
    form.set('file', file)
    return userOrNullSchema.parse(
        envelopeData(
            await request('/api/me/avatar', {
                method: 'POST',
                body: form,
                ...(signal ? { signal } : {}),
            }),
        ),
    )
}
