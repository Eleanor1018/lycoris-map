/**
 * Bounded fetch deadline shared by `request`/`requestBlob`.
 *
 * Reads can otherwise hang forever (a stalled TCP connection or a body that
 * never completes), which keeps callers — and the shared private-session lock —
 * busy indefinitely. This helper guarantees that both the `fetch` call and the
 * whole body read finish within a deadline, without relying on
 * `AbortSignal.any` (not available in all supported Safari versions).
 */

import { ApiError } from './ApiError'

export const DEFAULT_TIMEOUT_MS = 30_000
/** Uploads legitimately take longer and are exempt from the read deadline. */
export const UPLOAD_TIMEOUT_MS = 90_000

export type DeadlineOptions = {
    signal?: AbortSignal | undefined
    timeoutMs?: number | undefined
    /** `true` for requests that carry an upload body (JSON or FormData). */
    upload?: boolean | undefined
}

export type Deadline = {
    /** Signal to hand to `fetch`; combines the caller signal and the timer. */
    signal: AbortSignal
    /** The single terminal cause once settled, or null while running. */
    reason: () => 'caller' | 'timeout' | null
    /**
     * Runs `promise` to completion but rejects as soon as the deadline fires or
     * the caller aborts, even if `promise` (e.g. a non-native response body)
     * never settles on its own.
     */
    guard: <T>(promise: Promise<T>) => Promise<T>
    /** Clears the timer and removes the caller listener. Safe to call twice. */
    cleanup: () => void
}

const abortError = () => new DOMException('The operation was aborted.', 'AbortError')

export function createDeadline(options: DeadlineOptions = {}): Deadline {
    const timeoutMs = options.timeoutMs ?? (options.upload ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
    const controller = new AbortController()
    // Exactly one terminal reason wins: caller abort, timeout, or neither.
    let settledReason: 'caller' | 'timeout' | null = null
    let rejectGuard: ((error: unknown) => void) | null = null
    let guardSettled = false
    const rejectNow = (error: Error) => {
        if (guardSettled) return
        guardSettled = true
        rejectGuard?.(error)
    }
    const onCallerAbort = () => {
        if (settledReason) return
        settledReason = 'caller'
        controller.abort(options.signal?.reason)
        rejectNow(abortError())
    }
    if (options.signal) {
        // A pre-aborted caller must abort the internal controller immediately,
        // so the forwarded signal is already aborted and `fetch` cannot
        // dispatch a request (especially a POST write).
        if (options.signal.aborted) onCallerAbort()
        else options.signal.addEventListener('abort', onCallerAbort)
    }
    const timer = setTimeout(() => {
        if (settledReason) return
        settledReason = 'timeout'
        controller.abort(new DOMException('Request timed out', 'TimeoutError'))
        rejectNow(ApiError.network('Request timed out. Please try again.'))
    }, timeoutMs)
    return {
        signal: controller.signal,
        reason: () => settledReason,
        guard: <T>(promise: Promise<T>) => {
            // `guard` receives an already-created promise (the real `fetch`),
            // which will reject with AbortError from the forwarded signal. Even
            // when settling synchronously, consume it to avoid an unhandled
            // rejection.
            promise.catch(() => {})
            if (settledReason === 'caller') return Promise.reject(abortError())
            if (settledReason === 'timeout')
                return Promise.reject(ApiError.network('Request timed out. Please try again.'))
            return new Promise<T>((resolve, reject) => {
                guardSettled = false
                rejectGuard = reject
                promise.then(
                    (value) => {
                        guardSettled = true
                        resolve(value)
                    },
                    (error) => {
                        guardSettled = true
                        reject(error)
                    },
                )
            })
        },
        cleanup: () => {
            clearTimeout(timer)
            options.signal?.removeEventListener('abort', onCallerAbort)
            // If cleanup happens while a guard is still pending (e.g. a body
            // that ignores aborts), settle it so the chain cannot hang or emit
            // an unhandled rejection.
            if (rejectGuard && !guardSettled) rejectNow(abortError())
            rejectGuard = null
        },
    }
}
