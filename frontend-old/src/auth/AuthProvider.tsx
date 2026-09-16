import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { Alert, Button, Snackbar } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { toBackendAssetUrl } from '../config/runtime'

export type Me = {
    publicId: string
    username: string
    nickname?: string
    email: string
    avatarUrl?: string
    pronouns?: string
    signature?: string
}

type AuthContextValue = {
    user: Me | null
    loading: boolean
    isLoggedIn: boolean
    refresh: () => Promise<void>
    setUser: (u: Me | null) => void
    logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const AUTH_USER_STORAGE_KEY = 'lycoris.auth.user.v1'

const normalizeUser = (raw: unknown): Me | null => {
    if (!raw || typeof raw !== 'object') return null
    const data = raw as Partial<Me>
    if (!data.publicId || !data.username || !data.email) return null
    return {
        publicId: String(data.publicId),
        username: String(data.username),
        nickname: data.nickname ? String(data.nickname) : undefined,
        email: String(data.email),
        avatarUrl: toBackendAssetUrl(data.avatarUrl),
        pronouns: data.pronouns ? String(data.pronouns) : undefined,
        signature: data.signature ? String(data.signature) : undefined,
    }
}

const readCachedUser = (): Me | null => {
    if (typeof window === 'undefined') return null
    try {
        const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY)
        if (!raw) return null
        return normalizeUser(JSON.parse(raw))
    } catch {
        return null
    }
}

const writeCachedUser = (user: Me | null) => {
    if (typeof window === 'undefined') return
    try {
        if (user) {
            window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user))
        } else {
            window.localStorage.removeItem(AUTH_USER_STORAGE_KEY)
        }
    } catch {
        // Ignore storage failures and keep runtime auth usable.
    }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUserState] = useState<Me | null>(() => readCachedUser())
    const [loading, setLoading] = useState(true)
    const [sessionExpired, setSessionExpired] = useState(false)
    const currentUserRef = useRef(user)
    const authEpochRef = useRef(0)
    const refreshSequenceRef = useRef(0)

    const applyUser = useCallback((next: Me | null, newSession: boolean) => {
        const normalized = next ? normalizeUser(next) : null
        if (newSession || currentUserRef.current?.publicId !== normalized?.publicId) authEpochRef.current += 1
        currentUserRef.current = normalized
        setUserState(normalized)
        writeCachedUser(normalized)
        if (normalized) setSessionExpired(false)
    }, [])

    const setUser = useCallback((next: Me | null) => applyUser(next, true), [applyUser])

    useLayoutEffect(() => {
        let active = true
        const requestEpochs = new WeakMap<object, number>()
        const requestInterceptor = axios.interceptors.request.use((config) => {
            requestEpochs.set(config, authEpochRef.current)
            return config
        }, undefined, { synchronous: true })
        const responseInterceptor = axios.interceptors.response.use(undefined, (error: unknown) => {
            if (active && axios.isAxiosError(error) && error.response?.status === 401 && error.config) {
                const config = error.config
                const base = new URL(config.baseURL || window.location.origin, window.location.origin)
                const url = new URL(config.url || '', base)
                const credentialEndpoint = ['/api/login', '/api/register', '/api/logout'].includes(url.pathname)
                if (url.origin === base.origin && url.pathname.startsWith('/api/') && !credentialEndpoint
                    && requestEpochs.get(config) === authEpochRef.current && currentUserRef.current) {
                    setUser(null)
                    setSessionExpired(true)
                }
            }
            return Promise.reject(error)
        })
        return () => {
            active = false
            axios.interceptors.request.eject(requestInterceptor)
            axios.interceptors.response.eject(responseInterceptor)
        }
    }, [setUser])

    const refresh = useCallback(async () => {
        const epoch = authEpochRef.current
        const sequence = ++refreshSequenceRef.current
        try {
            const res = await axios.get('/api/me', { withCredentials: true })
            if (epoch !== authEpochRef.current || sequence !== refreshSequenceRef.current) return
            const nextUser = normalizeUser(res.data?.data ?? null)
            if (!nextUser && currentUserRef.current) setSessionExpired(true)
            applyUser(nextUser, false)
        } catch {
            // Current-session 401 responses are handled centrally; permission/network errors keep auth intact.
        } finally {
            if (sequence === refreshSequenceRef.current) setLoading(false)
        }
    }, [applyUser])

    const logout = useCallback(async () => {
        // Invalidate pending requests before waiting for logout so they cannot restore the old account.
        setUser(null)
        try {
            await axios.post('/api/logout', null, { withCredentials: true })
        } catch {
            // ignore
        }
    }, [setUser])

    useEffect(() => {
        setLoading(true)
        void refresh()
    }, [refresh])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const handleFocus = () => {
            void refresh()
        }
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void refresh()
            }
        }
        const handleStorage = (event: StorageEvent) => {
            if (event.key !== AUTH_USER_STORAGE_KEY) return
            setUser(readCachedUser())
        }

        window.addEventListener('focus', handleFocus)
        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('storage', handleStorage)
        return () => {
            window.removeEventListener('focus', handleFocus)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            window.removeEventListener('storage', handleStorage)
        }
    }, [refresh, setUser])

    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            loading,
            isLoggedIn: !!user,
            refresh,
            setUser,
            logout,
        }),
        [user, loading, refresh, setUser, logout]
    )

    return (
        <AuthContext.Provider value={value}>
            {children}
            <Snackbar open={sessionExpired} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert
                    severity="warning"
                    onClose={() => setSessionExpired(false)}
                    action={<Button color="inherit" component={RouterLink} to="/login" onClick={() => setSessionExpired(false)}>重新登录</Button>}
                >
                    登录已失效，请重新登录。
                </Alert>
            </Snackbar>
        </AuthContext.Provider>
    )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
    return ctx
}
