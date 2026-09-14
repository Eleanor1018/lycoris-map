/**
 * Public DTO schemas for the marker read endpoints, modelled on
 * `backend/src/modules/markers/model.rs` (`MarkerDto`, 23 fields).
 *
 * Only the read shape used by S1/S3 lives here; write DTOs arrive with S5.
 * `id`/`version` are Rust `i64`, so they are validated as safe integers rather
 * than allowed to silently lose precision.
 */
import { z } from 'zod'
import { MARKER_CATEGORIES } from '@/shared/query/keys'

const safeInteger = z.number().int().safe()

export const markerCategorySchema = z.enum(MARKER_CATEGORIES)

export const reviewStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED'])

/** `HH:mm`, or the backend's `00:00` all-day marker. */
export const openTimeSchema = z.string()

export const markerSchema = z.object({
    id: safeInteger,
    version: safeInteger,
    lat: z.number(),
    lng: z.number(),
    category: markerCategorySchema,
    title: z.string(),
    description: z.string().nullable(),
    sourceLanguage: z.string(),
    contentLanguage: z.string(),
    isPublic: z.boolean(),
    username: z.string(),
    userPublicId: z.string().nullable(),
    clientRequestId: z.string().nullable(),
    isActive: z.boolean(),
    openTimeStart: openTimeSchema.nullable(),
    openTimeEnd: openTimeSchema.nullable(),
    reviewStatus: reviewStatusSchema,
    lastEditedBy: z.string().nullable(),
    lastEditedByPublicId: z.string().nullable(),
    lastEditedByOwner: z.boolean(),
    markImage: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
})

export type Marker = z.infer<typeof markerSchema>

/** `/api/markers/{viewport,nearby,search}` answer with a bare array. */
export const markerListSchema = z.array(markerSchema)

/** `/api/markers/me/favorites` answers with an array of marker IDs. */
export const markerIdListSchema = z.array(safeInteger)
