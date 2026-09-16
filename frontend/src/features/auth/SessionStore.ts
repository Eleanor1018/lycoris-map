import type { QueryClient } from '@tanstack/react-query'
import * as api from '@/shared/api/session'
import type { User } from '@/shared/api/users'
import { ApiError } from '@/shared/api/ApiError'
import { privateKeys, type PrivateScope } from '@/shared/query/keys'

export type SessionSnapshot = {
    user: User | null
    scope: PrivateScope | null
    epoch: number
    status: 'checking' | 'anonymous' | 'authenticated' | 'error'
    busy: boolean
    error: string | null
}
export const sessionEventKey = 'lycoris.session.changed'
const aborted = () => new DOMException('The account session changed', 'AbortError')
let localQueue: Promise<unknown> = Promise.resolve()

/** Cookie-changing requests must finish in order, including across tabs. */
export function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request('lycoris-cookie-session', task)
    const pending = localQueue.then(task, task)
    localQueue = pending.catch(() => undefined)
    return pending
}

export class SessionStore {
    private snapshot: SessionSnapshot = {
        user: null,
        scope: null,
        epoch: 0,
        status: 'checking',
        busy: false,
        error: null,
    }
    private readonly listeners = new Set<() => void>()
    private readonly reads = new Set<AbortController>()
    private stopSync: (() => void) | undefined
    private emitChange: () => void = () => undefined
    private refreshRound = 0

    constructor(private readonly client: QueryClient) {}
    getSnapshot = () => this.snapshot
    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }
    private publish(next: Partial<SessionSnapshot>) {
        this.snapshot = { ...this.snapshot, ...next }
        this.listeners.forEach((listener) => listener())
    }
    isCurrent = (scope: PrivateScope) =>
        this.snapshot.scope?.publicId === scope.publicId && this.snapshot.epoch === scope.authEpoch
    private assertCurrent(scope: PrivateScope, signal?: AbortSignal) {
        if (!this.isCurrent(scope) || signal?.aborted) throw aborted()
    }
    private discard(status: SessionSnapshot['status'] = 'checking') {
        const previous = this.snapshot.scope
        this.publish({
            user: null,
            scope: null,
            epoch: this.snapshot.epoch + 1,
            status,
            error: null,
        })
        for (const controller of this.reads) controller.abort()
        this.reads.clear()
        if (previous) {
            const filter = { queryKey: privateKeys.scope(previous) }
            void this.client.cancelQueries(filter).then(() => this.client.removeQueries(filter))
        }
    }
    private adopt(user: User | null) {
        if (this.snapshot.user?.publicId !== user?.publicId) this.discard()
        this.publish({
            user,
            scope: user ? { publicId: user.publicId, authEpoch: this.snapshot.epoch } : null,
            status: user ? 'authenticated' : 'anonymous',
            error: null,
        })
    }
    private async me(signal?: AbortSignal) {
        try {
            return await api.fetchMe(signal)
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) return null
            throw error
        }
    }
    refresh = async () => {
        if (this.snapshot.busy) return
        const epoch = this.snapshot.epoch,
            round = ++this.refreshRound
        const controller = new AbortController()
        this.reads.add(controller)
        try {
            const user = await withSessionLock(() => this.me(controller.signal))
            if (
                this.snapshot.epoch === epoch &&
                round === this.refreshRound &&
                !controller.signal.aborted
            )
                this.adopt(user)
        } catch (error) {
            if (
                this.snapshot.epoch === epoch &&
                round === this.refreshRound &&
                !controller.signal.aborted
            )
                this.publish({
                    status: this.snapshot.user ? 'authenticated' : 'error',
                    error: 'Could not confirm your session. Try again.',
                })
        } finally {
            this.reads.delete(controller)
        }
    }
    /** Ignore broadcast identities: only /me may confirm the shared Cookie. */
    externalChange = () => {
        this.discard()
        if (!this.snapshot.busy) void this.refresh()
    }
    connect = () => {
        this.stopSync?.()
        let channel: BroadcastChannel | undefined
        const source = crypto.randomUUID()
        const seen = new Set<string>()
        const receive = (data: unknown) => {
            if (
                !data ||
                typeof data !== 'object' ||
                !('id' in data) ||
                typeof data.id !== 'string' ||
                !('source' in data) ||
                data.source === source ||
                !('type' in data) ||
                data.type !== 'session'
            )
                return
            if (seen.has(data.id)) return
            if (seen.size > 100) seen.clear()
            seen.add(data.id)
            this.externalChange()
        }
        try {
            channel = new BroadcastChannel('lycoris-session')
            channel.onmessage = (event) => receive(event.data)
        } catch {
            /* storage and focus still revalidate when channels are unavailable */
        }
        const storage = (event: StorageEvent) => {
            if (event.key !== sessionEventKey || !event.newValue) return
            try {
                receive(JSON.parse(event.newValue) as unknown)
            } catch {
                /* ignore unrelated data */
            }
        }
        const focus = () => {
            void this.refresh()
        }
        window.addEventListener('storage', storage)
        window.addEventListener('focus', focus)
        window.addEventListener('pageshow', focus)
        this.emitChange = () => {
            const event = { type: 'session', source, id: crypto.randomUUID() }
            try {
                channel?.postMessage(event)
            } catch {
                /* storage fallback below */
            }
            try {
                localStorage.setItem(sessionEventKey, JSON.stringify(event))
            } catch {
                /* private browsing */
            }
        }
        void this.refresh()
        const stop = () => {
            window.removeEventListener('storage', storage)
            window.removeEventListener('focus', focus)
            window.removeEventListener('pageshow', focus)
            channel?.close()
            this.emitChange = () => undefined
            this.refreshRound++
            for (const controller of this.reads) controller.abort()
            this.reads.clear()
        }
        this.stopSync = stop
        return stop
    }
    /** All private calls are scoped; writes recheck the Cookie owner before dispatch. */
    runPrivate = async <T>(
        scope: PrivateScope,
        task: (signal: AbortSignal) => Promise<T>,
        parentSignal?: AbortSignal,
    ): Promise<T> => {
        if (this.snapshot.busy) throw aborted()
        this.assertCurrent(scope, parentSignal)
        const controller = new AbortController()
        this.reads.add(controller)
        const signal = parentSignal
            ? AbortSignal.any([controller.signal, parentSignal])
            : controller.signal
        try {
            return await withSessionLock(async () => {
                if (this.snapshot.busy) throw aborted()
                this.assertCurrent(scope, signal)
                const user = await this.me(signal)
                this.assertCurrent(scope, signal)
                if (user?.publicId !== scope.publicId) {
                    this.adopt(user)
                    throw aborted()
                }
                const result = await task(signal)
                this.assertCurrent(scope, signal)
                return result
            })
        } catch (error) {
            if (!this.isCurrent(scope) || signal.aborted) throw aborted()
            if (error instanceof ApiError && error.status === 401) {
                this.discard('anonymous')
                this.emitChange()
            }
            throw error
        } finally {
            this.reads.delete(controller)
        }
    }
    updateUser = (scope: PrivateScope, user: User | null) => {
        this.assertCurrent(scope)
        if (!user || user.publicId !== scope.publicId)
            throw new Error('Could not confirm updated profile. Refresh and try again.')
        this.publish({ user })
    }
    private async transition(task: () => Promise<unknown>, requireOwner: boolean) {
        if (this.snapshot.busy) throw new Error('Please wait for the current account request.')
        const previous = this.snapshot.scope
        this.publish({ busy: true, error: null })
        for (const controller of this.reads) controller.abort()
        this.reads.clear()
        try {
            return await withSessionLock(async () => {
                if (requireOwner) {
                    if (!previous) throw new Error('Please log in again.')
                    this.assertCurrent(previous)
                    const owner = await this.me()
                    this.assertCurrent(previous)
                    if (owner?.publicId !== previous.publicId) {
                        this.adopt(owner)
                        throw new Error('Your session changed. Please try again.')
                    }
                }
                this.discard()
                this.emitChange()
                try {
                    // Do not abort Set-Cookie responses or start a second cookie
                    // write while this one can still complete in the browser.
                    await task()
                    const epoch = this.snapshot.epoch
                    const user = await this.me()
                    if (epoch === this.snapshot.epoch) this.adopt(user)
                    return user
                } catch (error) {
                    // A failed register may already have created the account;
                    // a failed logout may have left the server session intact.
                    const epoch = this.snapshot.epoch
                    try {
                        const user = await this.me()
                        if (epoch === this.snapshot.epoch) this.adopt(user)
                    } catch {
                        if (epoch === this.snapshot.epoch)
                            this.publish({
                                status: 'error',
                                error: 'Could not confirm your session. Try again.',
                            })
                    }
                    throw error
                } finally {
                    this.emitChange()
                }
            })
        } finally {
            this.publish({ busy: false })
            if (this.snapshot.status === 'checking') void this.refresh()
        }
    }
    login = (input: api.LoginInput) => this.transition(() => api.login(input), false)
    register = (input: api.RegisterInput) => this.transition(() => api.register(input), false)
    logout = () =>
        this.transition(async () => {
            try {
                await api.logout()
            } catch (error) {
                if (!(error instanceof ApiError && error.status === 401)) throw error
            }
        }, true)
    changePassword = (input: api.PasswordInput) =>
        this.transition(() => api.changePassword(input), true)
}
