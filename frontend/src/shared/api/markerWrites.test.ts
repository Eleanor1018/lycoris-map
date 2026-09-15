import { afterEach, expect, it, vi } from 'vitest'
import { createMarker, proposeMarkerEdit } from './markerWrites'
import {
    beginPhotoUpload,
    readPhotoUpload,
    sendPhotoChunk,
    finishPhotoUpload,
} from './photoUploads'
import { syntheticPlace } from '@/features/dev/placeFixtures'
const text = {
    title: 'Synthetic',
    category: 'accessible_toilet' as const,
    description: '',
    language: 'zh' as const,
    isPublic: false,
    openTimeStart: '',
    openTimeEnd: '',
}
const uuid = '7d33c649-94cd-4159-b6a5-7d2d0bef385a'
const response = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())
it('sends stable create UUID and parses the bare pending marker response', async () => {
    const marker = syntheticPlace({ reviewStatus: 'PENDING', isPublic: false })
    const fetch = vi.fn().mockResolvedValue(response(marker))
    vi.stubGlobal('fetch', fetch)
    expect(await createMarker({ ...text, lat: 31, lng: 121, clientRequestId: uuid })).toEqual(
        marker,
    )
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toMatchObject({
        clientRequestId: uuid,
        lat: 31,
        lng: 121,
    })
    expect(String(fetch.mock.calls[0]![0])).toContain('lang=zh')
})
it('omits coordinates, computed active and image URLs from text edit even if supplied at runtime', async () => {
    const fetch = vi.fn().mockResolvedValue(response(syntheticPlace()))
    vi.stubGlobal('fetch', fetch)
    await proposeMarkerEdit(1, {
        ...text,
        ...{ lat: 0, lng: 0, isActive: false, markImage: 'bad' },
    })
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual(text)
    expect(fetch.mock.calls[0]![1].method).toBe('PATCH')
})
it('uses authenticated no-cache resume reads and raw binary chunks, keeping completion separate', async () => {
    const receipt = {
        uploadId: uuid,
        markerId: 1,
        totalBytes: 3,
        receivedBytes: 3,
        chunkSize: 262144,
        status: 'UPLOADING',
    }
    const fetch = vi.fn().mockImplementation(async () => response(receipt))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal,
        bytes = new Blob(['abc'])
    await beginPhotoUpload(1, uuid, 3, 'a'.repeat(64), signal)
    await readPhotoUpload(1, uuid, signal)
    await sendPhotoChunk(1, uuid, 0, bytes, signal)
    receipt.status = 'COMPLETED'
    await finishPhotoUpload(1, uuid, signal)
    expect(fetch.mock.calls[1]![1]).toMatchObject({
        cache: 'no-store',
        credentials: 'include',
        signal,
    })
    expect(fetch.mock.calls[2]![1].body).toBe(bytes)
    expect(new Headers(fetch.mock.calls[2]![1].headers).get('Content-Type')).toBe(
        'application/octet-stream',
    )
    expect(String(fetch.mock.calls[3]![0])).toMatch(/\/complete$/)
})
it('rejects a completed receipt with missing bytes', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
            response({
                uploadId: uuid,
                markerId: 1,
                totalBytes: 3,
                receivedBytes: 2,
                chunkSize: 262144,
                status: 'COMPLETED',
            }),
        ),
    )
    await expect(readPhotoUpload(1, uuid, new AbortController().signal)).rejects.toThrow()
})
it('reports a broken response stream as a recoverable network error with request ID', async () => {
    const stream = new ReadableStream({
        start(controller) {
            controller.error(new TypeError('synthetic disconnect after headers'))
        },
    })
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockResolvedValue(
                new Response(stream, { headers: { 'x-request-id': 'synthetic-request' } }),
            ),
    )
    await expect(finishPhotoUpload(1, uuid, new AbortController().signal)).rejects.toMatchObject({
        status: 0,
        requestId: 'synthetic-request',
    })
})
