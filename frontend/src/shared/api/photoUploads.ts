import { z } from 'zod'
import { request } from './transport'
const receiptSchema = z
    .object({
        uploadId: z.uuid(),
        markerId: z.number().int().safe().positive(),
        totalBytes: z
            .number()
            .int()
            .min(1)
            .max(5 * 1024 * 1024),
        receivedBytes: z
            .number()
            .int()
            .min(0)
            .max(5 * 1024 * 1024),
        chunkSize: z.literal(256 * 1024),
        status: z.enum(['UPLOADING', 'COMPLETED']),
    })
    .refine(
        (value) =>
            value.receivedBytes <= value.totalBytes &&
            (value.status !== 'COMPLETED' || value.receivedBytes === value.totalBytes),
    )
export type PhotoReceipt = z.infer<typeof receiptSchema>
const path = (markerId: number, uploadId?: string) =>
    `/api/markers/${z.number().int().positive().safe().parse(markerId)}/image-uploads${uploadId ? `/${z.uuid().parse(uploadId)}` : ''}`
export async function beginPhotoUpload(
    markerId: number,
    clientRequestId: string,
    totalBytes: number,
    sha256: string,
    signal: AbortSignal,
) {
    return receiptSchema.parse(
        await request(path(markerId), {
            method: 'POST',
            json: { clientRequestId, totalBytes, sha256 },
            signal,
        }),
    )
}
export async function readPhotoUpload(markerId: number, uploadId: string, signal: AbortSignal) {
    return receiptSchema.parse(
        await request(path(markerId, uploadId), { signal, cache: 'no-store' }),
    )
}
export async function sendPhotoChunk(
    markerId: number,
    uploadId: string,
    offset: number,
    bytes: Blob,
    signal: AbortSignal,
) {
    return receiptSchema.parse(
        await request(
            `${path(markerId, uploadId)}/chunks/${z.number().int().nonnegative().parse(offset)}`,
            {
                method: 'POST',
                body: bytes,
                headers: { 'Content-Type': 'application/octet-stream' },
                signal,
            },
        ),
    )
}
export async function finishPhotoUpload(markerId: number, uploadId: string, signal: AbortSignal) {
    return receiptSchema.parse(
        await request(`${path(markerId, uploadId)}/complete`, { method: 'POST', signal }),
    )
}
