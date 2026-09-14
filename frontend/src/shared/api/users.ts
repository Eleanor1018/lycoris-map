/**
 * User DTO from `backend/src/dto.rs::UserResponse` (7 fields, camelCase).
 *
 * `publicId` is a UUID string and must never be coerced to a number.
 * `role`/`isAdmin` are deliberately absent: the backend does not expose them on
 * `/api/me`, so no admin capability is inferred on the client.
 */
import { z } from 'zod'

export const userSchema = z.object({
    publicId: z.string().min(1),
    username: z.string().nullable(),
    nickname: z.string().nullable(),
    email: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    pronouns: z.string().nullable(),
    signature: z.string().nullable(),
})

export type User = z.infer<typeof userSchema>

/** A successful login envelope carries `data: user | null`. */
export const userOrNullSchema = userSchema.nullable()
