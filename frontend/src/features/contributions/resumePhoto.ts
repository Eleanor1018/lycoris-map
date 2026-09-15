import * as api from '@/shared/api/photoUploads'
import { ApiError } from '@/shared/api/ApiError'
export type PrivatePhotoCall = <T>(
    task: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
) => Promise<T>
type Options = {
    api?: typeof api
    pause?: (ms: number, signal: AbortSignal) => Promise<void>
    digest?: (file: File) => Promise<string>
}
async function digest(file: File) {
    const bytes = await file.arrayBuffer()
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const finish = () => {
            cleanup()
            resolve()
        }
        const abort = () => {
            cleanup()
            reject(new DOMException('Upload cancelled', 'AbortError'))
        }
        const timer = setTimeout(() => {
            // A real offline connection waits for online, even after a long outage.
            if (navigator.onLine) finish()
        }, ms)
        const cleanup = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            window.removeEventListener('online', finish)
        }
        signal.addEventListener('abort', abort, { once: true })
        window.addEventListener('online', finish, { once: true })
        if (signal.aborted) abort()
    })
}
/** Retries query the confirmed offset; no Cookie lock is held while backing off. */
export async function resumePhoto(
    markerId: number,
    file: File,
    requestId: string,
    run: PrivatePhotoCall,
    signal: AbortSignal,
    options: Options = {},
) {
    const calls = options.api ?? api,
        wait = options.pause ?? pause
    const sha256 = await (options.digest ?? digest)(file)
    let receipt: api.PhotoReceipt | null = null,
        failures = 0,
        reconcile = false
    const call = <T>(task: (s: AbortSignal) => Promise<T>) =>
        run(task, AbortSignal.any([signal, AbortSignal.timeout(35000)]))
    const check = (next: api.PhotoReceipt) => {
        if (
            next.markerId !== markerId ||
            next.totalBytes !== file.size ||
            (receipt &&
                (next.uploadId !== receipt.uploadId ||
                    next.receivedBytes < receipt.receivedBytes)) ||
            (next.receivedBytes !== file.size && next.receivedBytes % next.chunkSize !== 0)
        )
            throw new Error('Upload receipt does not match this photo.')
        receipt = next
        return next
    }
    while (!signal.aborted) {
        try {
            if (!receipt)
                check(
                    await call((s) =>
                        calls.beginPhotoUpload(markerId, requestId, file.size, sha256, s),
                    ),
                )
            else if (reconcile)
                check(await call((s) => calls.readPhotoUpload(markerId, receipt!.uploadId, s)))
            reconcile = false
            const current = receipt!
            if (current.status === 'COMPLETED') return
            if (current.receivedBytes < file.size) {
                const part = file.slice(
                    current.receivedBytes,
                    current.receivedBytes + current.chunkSize,
                )
                const advanced = check(
                    await call((s) =>
                        calls.sendPhotoChunk(
                            markerId,
                            current.uploadId,
                            current.receivedBytes,
                            part,
                            s,
                        ),
                    ),
                )
                if (advanced.receivedBytes <= current.receivedBytes)
                    throw new Error(
                        'The upload did not confirm the chunk. Retry to check its progress.',
                    )
            } else {
                const completed = check(
                    await call((s) => calls.finishPhotoUpload(markerId, current.uploadId, s)),
                )
                if (completed.status !== 'COMPLETED')
                    throw new Error('The upload did not confirm completion.')
            }
            failures = 0
        } catch (error) {
            if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
            const retry =
                error instanceof ApiError
                    ? error.status === 0 || error.status === 408 || error.status >= 500
                    : error instanceof DOMException &&
                      ['TimeoutError', 'AbortError'].includes(error.name)
            if (!retry || ++failures > 8) throw error
            reconcile = true
            await wait(Math.min(30000, 1000 * 2 ** (failures - 1)), signal)
        }
    }
    throw new DOMException('Upload cancelled', 'AbortError')
}
