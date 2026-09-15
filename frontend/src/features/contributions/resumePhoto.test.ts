import { expect, it, vi } from 'vitest'
import { resumePhoto, type PrivatePhotoCall } from './resumePhoto'
import { ApiError } from '@/shared/api/ApiError'
import type { PhotoReceipt } from '@/shared/api/photoUploads'
const size = 262144
const file = new File([new Uint8Array(size + 31)], 'synthetic.png', { type: 'image/png' })
const direct: PrivatePhotoCall = (task, signal) => task(signal)
const receipt = (offset = 0, status: PhotoReceipt['status'] = 'UPLOADING'): PhotoReceipt => ({
    uploadId: 'a1819c71-7340-4bbd-98ba-f63b6670e4db',
    markerId: 1,
    totalBytes: file.size,
    receivedBytes: offset,
    chunkSize: size,
    status,
})
function fixture() {
    const api = {
        beginPhotoUpload: vi.fn().mockResolvedValue(receipt()),
        readPhotoUpload: vi.fn().mockResolvedValue(receipt(size)),
        sendPhotoChunk: vi
            .fn()
            .mockResolvedValueOnce(receipt(size))
            .mockResolvedValue(receipt(file.size)),
        finishPhotoUpload: vi.fn().mockResolvedValue(receipt(file.size, 'COMPLETED')),
    }
    const pause = vi.fn().mockResolvedValue(undefined),
        digest = vi.fn().mockResolvedValue('a'.repeat(64))
    return { api, pause, digest }
}
it('recovers a lost chunk response by querying offset and sends only the remaining bytes', async () => {
    const options = fixture()
    options.api.sendPhotoChunk
        .mockReset()
        .mockRejectedValueOnce(ApiError.network('lost'))
        .mockResolvedValue(receipt(file.size))
    await resumePhoto(1, file, 'request', direct, new AbortController().signal, options)
    expect(options.api.readPhotoUpload).toHaveBeenCalledTimes(1)
    expect(
        options.api.sendPhotoChunk.mock.calls.map((call) => [call[2], (call[3] as Blob).size]),
    ).toEqual([
        [0, size],
        [size, 31],
    ])
    expect(options.api.finishPhotoUpload).toHaveBeenCalledTimes(1)
    expect(options.pause).toHaveBeenCalledTimes(1)
})
it('reconciles a lost completion response without submitting completion again', async () => {
    const options = fixture()
    options.api.finishPhotoUpload.mockRejectedValueOnce(new ApiError(503, 'lost'))
    options.api.readPhotoUpload.mockResolvedValue(receipt(file.size, 'COMPLETED'))
    await resumePhoto(1, file, 'request', direct, new AbortController().signal, options)
    expect(options.api.finishPhotoUpload).toHaveBeenCalledTimes(1)
    expect(options.api.sendPhotoChunk).toHaveBeenCalledTimes(2)
})
it('replays the same initiation UUID and hash after the start response is lost', async () => {
    const options = fixture()
    options.api.beginPhotoUpload.mockRejectedValueOnce(ApiError.network('lost'))
    await resumePhoto(1, file, 'request', direct, new AbortController().signal, options)
    expect(options.api.beginPhotoUpload.mock.calls.map((call) => call.slice(0, 4))).toEqual([
        [1, 'request', file.size, 'a'.repeat(64)],
        [1, 'request', file.size, 'a'.repeat(64)],
    ])
})
it('does not retry invalid image content and releases the account lock during backoff', async () => {
    const options = fixture()
    options.api.sendPhotoChunk
        .mockReset()
        .mockRejectedValueOnce(new ApiError(408, 'interrupted'))
        .mockResolvedValue(receipt(file.size))
    options.api.finishPhotoUpload.mockRejectedValue(new ApiError(400, 'invalid image'))
    let active = false
    const run: PrivatePhotoCall = async (task, signal) => {
        active = true
        try {
            return await task(signal)
        } finally {
            active = false
        }
    }
    options.pause.mockImplementation(async () => {
        expect(active).toBe(false)
    })
    await expect(
        resumePhoto(1, file, 'request', run, new AbortController().signal, options),
    ).rejects.toMatchObject({ status: 400 })
    expect(options.api.finishPhotoUpload).toHaveBeenCalledTimes(1)
})
it('cancels while backing off and never sends another chunk after cancellation', async () => {
    const options = fixture(),
        controller = new AbortController()
    options.api.sendPhotoChunk.mockReset().mockRejectedValue(ApiError.network('offline'))
    options.pause.mockImplementation(async () => {
        controller.abort()
    })
    await expect(
        resumePhoto(1, file, 'request', direct, controller.signal, options),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(options.api.sendPhotoChunk).toHaveBeenCalledTimes(1)
})
it('waits silently through a long browser offline period and resumes on the online event', async () => {
    vi.useFakeTimers()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
        const options = fixture()
        options.api.beginPhotoUpload.mockRejectedValueOnce(ApiError.network('offline'))
        const job = resumePhoto(1, file, 'request', direct, new AbortController().signal, {
            api: options.api,
            digest: options.digest,
        })
        await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
        expect(options.api.beginPhotoUpload).toHaveBeenCalledTimes(1)
        online.mockReturnValue(true)
        window.dispatchEvent(new Event('online'))
        await job
        expect(options.api.finishPhotoUpload).toHaveBeenCalledTimes(1)
    } finally {
        online.mockRestore()
        vi.useRealTimers()
    }
})
