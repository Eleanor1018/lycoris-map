import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, fetchMe, fetchMyAvatar, login, logout, uploadMyAvatar } from '@/shared/api'
import {
    beginSession,
    currentEpoch,
    endSession,
    initialSessionState,
    isCurrentEpoch,
    type SessionState,
} from '@/shared/auth'
import { privateKeys, privateKeysFor } from '@/shared/query'
import { useLanguage } from '@/shared/i18n'
import { Button } from '@/shared/ui'

const PREVIEWS = [{ labelKey: 'qa.viewport375', width: 375, height: 812 }] as const

type SessionOutcome = { kind: 'idle' | 'ok' | 'error' | 'info'; message: string }

/**
 * S1 development-only QA diagnostics (`/__dev/qa`).
 *
 * Two things:
 * 1. A fixed-size iframe over the real map spike, so a browser tool can inspect
 *    a genuine CSS viewport without rescaling screenshots. This is responsive
 *    checking, NOT iPhone device emulation.
 * 2. A local session probe that exercises the real transport against
 *    `/api/login`, `/api/me`, avatar Blob reads, avatar upload and logout with
 *    the authEpoch / private-cache rules.
 *
 * The password is never persisted, printed or put in the URL, and is cleared
 * from state immediately after submit. No account is created and no password is
 * changed. S4 replaces this with the product account UI.
 *
 * Session transitions are serialised through one `runSession` helper so login,
 * logout and `/me` checks cannot interleave: each operation captures the epoch
 * it started in and only applies results that are still current.
 */
export function QaPage() {
    const { t } = useLanguage()
    const queryClient = useQueryClient()
    const [session, setSession] = useState<SessionState>(initialSessionState)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [outcome, setOutcome] = useState<SessionOutcome>({ kind: 'idle', message: '' })
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

    /** Always-current snapshot for async callbacks (no stale closures). */
    const sessionRef = useRef<SessionState>(session)
    const avatarUrlRef = useRef<string | null>(null)
    const operationRef = useRef(0)
    const mountedRef = useRef(true)

    const commitSession = useCallback((next: SessionState) => {
        sessionRef.current = next
        setSession(next)
    }, [])

    const releaseAvatarUrl = useCallback(() => {
        if (avatarUrlRef.current) {
            URL.revokeObjectURL(avatarUrlRef.current)
            avatarUrlRef.current = null
        }
        if (mountedRef.current) setAvatarUrl(null)
    }, [])

    /** Remove only the given account scope; public data is untouched. */
    const clearPrivateCache = useCallback(
        (state: SessionState) => {
            if (!state.publicId) return
            const scope = { publicId: state.publicId, authEpoch: currentEpoch(state) }
            queryClient.removeQueries({ queryKey: privateKeys.me(scope) })
            for (const key of privateKeysFor(scope)) {
                queryClient.removeQueries({ queryKey: key })
            }
        },
        [queryClient],
    )

    /** Drop an entirely stale login round: cancel + clear its private scope. */
    const discardScope = useCallback(
        (state: SessionState) => {
            if (!state.publicId) return
            const scope = { publicId: state.publicId, authEpoch: currentEpoch(state) }
            const [scopePrefix] = privateKeysFor(scope)
            if (scopePrefix) void queryClient.cancelQueries({ queryKey: scopePrefix })
            clearPrivateCache(state)
        },
        [queryClient, clearPrivateCache],
    )

    /**
     * Single serialised entry point. `operation` guards out-of-order responses:
     * only the newest operation may write state.
     */
    const runSession = useCallback(
        async (task: (operation: number, epoch: number) => Promise<void>) => {
            const operation = operationRef.current + 1
            operationRef.current = operation
            const epoch = currentEpoch(sessionRef.current)
            setBusy(true)
            try {
                await task(operation, epoch)
            } finally {
                if (mountedRef.current && operationRef.current === operation) setBusy(false)
            }
        },
        [],
    )

    const isCurrentOperation = useCallback(
        (operation: number) => mountedRef.current && operationRef.current === operation,
        [],
    )

    /**
     * Reliable lifecycle effect: mirrors `mountedRef` and releases any created
     * object URL on real unmount. Kept separate from the startup probe below so
     * a StrictMode setup replay can never skip this cleanup.
     */
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            if (avatarUrlRef.current) {
                URL.revokeObjectURL(avatarUrlRef.current)
                avatarUrlRef.current = null
            }
        }
    }, [])

    /** Startup probe: adopt the result only if the epoch is still current. */
    const startupProbeStarted = useRef(false)
    useEffect(() => {
        if (startupProbeStarted.current) return
        startupProbeStarted.current = true
        const operation = operationRef.current
        const epoch = currentEpoch(sessionRef.current)
        void (async () => {
            try {
                const me = await fetchMe()
                if (!isCurrentOperation(operation) || !isCurrentEpoch(sessionRef.current, epoch))
                    return
                if (me) commitSession(beginSession(sessionRef.current, me.publicId))
            } catch {
                // Anonymous or unreachable: nothing to adopt.
            }
        })()
    }, [commitSession, isCurrentOperation])

    const handleLogin = useCallback(
        async (input: { username: string; password: string }) => {
            await runSession(async (operation, epoch) => {
                if (!isCurrentEpoch(sessionRef.current, epoch)) return
                try {
                    const user = await login(input)
                    if (!isCurrentOperation(operation)) return
                    const previous = sessionRef.current
                    const next = user ? beginSession(previous, user.publicId) : previous
                    // Every successful new login round starts a new epoch, so the
                    // previous round's scope and avatar are always released —
                    // even when the same account logs in again.
                    if (previous.publicId && user) {
                        discardScope(previous)
                        releaseAvatarUrl()
                    }
                    commitSession(next)
                    setOutcome({ kind: 'ok', message: `login ok · /api/me ${next.publicId}` })
                } catch (error) {
                    if (!isCurrentOperation(operation)) return
                    setOutcome({
                        kind: 'error',
                        message:
                            error instanceof ApiError
                                ? `${error.status} ${error.message}`
                                : 'login failed',
                    })
                }
            })
        },
        [runSession, isCurrentOperation, discardScope, releaseAvatarUrl, commitSession],
    )

    const handleCheckMe = useCallback(async () => {
        await runSession(async (operation, epoch) => {
            try {
                const me = await fetchMe()
                if (!isCurrentOperation(operation) || !isCurrentEpoch(sessionRef.current, epoch))
                    return
                if (!me) {
                    setOutcome({ kind: 'info', message: 'me.data = null' })
                    return
                }
                const current = sessionRef.current
                if (!current.publicId) {
                    commitSession(beginSession(current, me.publicId))
                } else if (current.publicId !== me.publicId) {
                    // Different account: discard the old scope instead of leaking it.
                    discardScope(current)
                    releaseAvatarUrl()
                    commitSession(beginSession(current, me.publicId))
                }
                // Same account: no new epoch, so no orphaned private scope.
                setOutcome({ kind: 'ok', message: `me.data.publicId = ${me.publicId}` })
            } catch (error) {
                if (!isCurrentOperation(operation)) return
                if (error instanceof ApiError && error.status === 401) {
                    // A 401 only clears a session it actually belongs to.
                    if (isCurrentEpoch(sessionRef.current, epoch)) {
                        const current = sessionRef.current
                        if (current.publicId) {
                            clearPrivateCache(current)
                            releaseAvatarUrl()
                            commitSession(endSession(current))
                        }
                    }
                    setOutcome({ kind: 'info', message: t('qa.me401') })
                } else {
                    setOutcome({
                        kind: 'error',
                        message:
                            error instanceof ApiError
                                ? `${error.status} ${error.message}`
                                : 'me failed',
                    })
                }
            }
        })
    }, [
        runSession,
        isCurrentOperation,
        discardScope,
        releaseAvatarUrl,
        clearPrivateCache,
        commitSession,
        t,
    ])

    const handleLogout = useCallback(async () => {
        await runSession(async (operation) => {
            const current = sessionRef.current
            try {
                await logout()
                if (!isCurrentOperation(operation)) return
                clearPrivateCache(current)
                releaseAvatarUrl()
                commitSession(endSession(current))
                setOutcome({ kind: 'info', message: t('qa.privateCacheCleared') })
            } catch (error) {
                if (!isCurrentOperation(operation)) return
                setOutcome({
                    kind: 'error',
                    message:
                        error instanceof ApiError
                            ? `${error.status} ${error.message}`
                            : 'logout failed',
                })
            }
        })
    }, [runSession, isCurrentOperation, clearPrivateCache, releaseAvatarUrl, commitSession, t])

    const handleAvatar = useCallback(async () => {
        await runSession(async (operation, epoch) => {
            try {
                const blob = await fetchMyAvatar()
                if (!isCurrentOperation(operation) || !isCurrentEpoch(sessionRef.current, epoch))
                    return
                releaseAvatarUrl()
                const url = URL.createObjectURL(blob)
                avatarUrlRef.current = url
                setAvatarUrl(url)
                setOutcome({ kind: 'ok', message: `avatar ${blob.type} ${blob.size} bytes` })
            } catch (error) {
                if (!isCurrentOperation(operation)) return
                setOutcome({
                    kind: 'info',
                    message: error instanceof ApiError ? `avatar ${error.status}` : 'avatar failed',
                })
            }
        })
    }, [runSession, isCurrentOperation, releaseAvatarUrl])

    const handleUpload = useCallback(
        async (file: File) => {
            await runSession(async (operation, epoch) => {
                try {
                    const user = await uploadMyAvatar(file)
                    if (
                        !isCurrentOperation(operation) ||
                        !isCurrentEpoch(sessionRef.current, epoch)
                    )
                        return
                    setOutcome({
                        kind: 'ok',
                        message: user ? `avatar uploaded for ${user.publicId}` : 'avatar uploaded',
                    })
                } catch (error) {
                    if (!isCurrentOperation(operation)) return
                    setOutcome({
                        kind: 'error',
                        message:
                            error instanceof ApiError
                                ? `${error.status} ${error.message}`
                                : 'upload failed',
                    })
                }
            })
        },
        [runSession, isCurrentOperation],
    )

    const handleSubmit = useCallback(
        (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const input = { username, password }
            // Clear immediately: the password must not survive in component state.
            setPassword('')
            void handleLogin(input)
        },
        [username, password, handleLogin],
    )

    return (
        <main className="flex min-h-dvh flex-col gap-6 p-6" data-testid="qa-page">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl" style={{ fontFamily: 'var(--ui-font-heading)' }}>
                    {t('qa.title')}
                </h1>
                <p className="text-sm opacity-80">{t('qa.notProduction')}</p>
            </header>

            <section className="flex flex-col gap-2">
                <p className="text-xs opacity-80">{t('qa.viewportNote')}</p>
                {PREVIEWS.map((preview) => (
                    <figure key={preview.labelKey} className="flex w-fit flex-col gap-1">
                        <figcaption className="text-xs">
                            {t(preview.labelKey)} · {preview.width}×{preview.height}
                        </figcaption>
                        <iframe
                            title={t(preview.labelKey)}
                            src="/__dev/map-spike"
                            width={preview.width}
                            height={preview.height}
                            data-frame-width={preview.width}
                            data-frame-height={preview.height}
                            style={{ border: '1px solid var(--ui-brand-blush)' }}
                        />
                    </figure>
                ))}
            </section>

            <section
                className="flex max-w-2xl flex-col gap-3 rounded-(--ui-card-radius) p-4"
                style={{ background: 'var(--ui-nav-surface)' }}
            >
                <h2 className="text-lg">{t('qa.sessionTitle')}</h2>
                <p className="text-xs opacity-80">{t('qa.sessionNote')}</p>

                <form className="flex flex-wrap items-end gap-2" onSubmit={handleSubmit}>
                    <label className="flex flex-col gap-1 text-xs">
                        {t('qa.username')}
                        <input
                            className="rounded border px-2 py-1"
                            name="username"
                            autoComplete="off"
                            value={username}
                            disabled={busy}
                            onChange={(event) => setUsername(event.target.value)}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                        {t('qa.password')}
                        <input
                            className="rounded border px-2 py-1"
                            name="password"
                            type="password"
                            autoComplete="off"
                            value={password}
                            disabled={busy}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                    </label>
                    <Button size="sm" type="submit" disabled={busy}>
                        {t('qa.login')}
                    </Button>
                </form>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCheckMe()}
                        disabled={busy}
                    >
                        {t('qa.checkMe')}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleAvatar()}
                        disabled={busy}
                    >
                        {t('qa.avatar')}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleLogout()}
                        disabled={busy}
                    >
                        {t('qa.logout')}
                    </Button>
                    <label className="flex items-center gap-2 text-xs">
                        {t('qa.uploadAvatar')}
                        <input
                            type="file"
                            name="file"
                            accept="image/*"
                            disabled={busy}
                            onChange={(event) => {
                                const file = event.target.files?.[0]
                                if (file) void handleUpload(file)
                            }}
                        />
                    </label>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                    <dt>{t('qa.sessionState')}</dt>
                    <dd data-testid="qa-session">
                        {session.publicId
                            ? t('qa.signedIn', { publicId: session.publicId })
                            : t('qa.signedOut')}
                    </dd>
                    <dt>{t('qa.authEpochLabel')}</dt>
                    <dd data-testid="qa-epoch">{currentEpoch(session)}</dd>
                    <dt>{t('qa.result')}</dt>
                    <dd data-testid="qa-result">{outcome.message || '-'}</dd>
                </dl>

                {avatarUrl ? (
                    <figure className="flex flex-col gap-1">
                        <figcaption className="text-xs">{t('qa.avatarPreview')}</figcaption>
                        <img
                            src={avatarUrl}
                            alt={t('qa.avatarPreview')}
                            data-testid="qa-avatar-preview"
                            style={{ maxWidth: 120 }}
                        />
                    </figure>
                ) : null}
            </section>
        </main>
    )
}
