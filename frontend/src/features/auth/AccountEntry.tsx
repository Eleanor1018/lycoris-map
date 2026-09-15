import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from './SessionProvider'
import { useAccountFlow } from './AccountFlow'
import { fetchMyAvatar } from '@/shared/api/session'
import { privateKeys } from '@/shared/query/keys'
import { DesignButton } from '@/shared/ui/design-primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import './account.css'

export function useAccountAvatar() {
    const { store, scope, user, busy } = useSession()
    const key = scope ? `${scope.publicId}:${scope.authEpoch}:${user?.avatarUrl}` : ''
    const query = useQuery({
        queryKey: scope
            ? [...privateKeys.me(scope), 'avatar', user?.avatarUrl]
            : ['private', 'avatar-idle'],
        enabled: !!scope && !!user?.avatarUrl && !!store && !busy,
        queryFn: ({ signal }) => store!.runPrivate(scope!, fetchMyAvatar, signal),
        retry: false,
        staleTime: Infinity,
    })
    const [image, setImage] = useState<{ key: string; blob: Blob; url: string } | null>(null)
    const blob = query.data
    useEffect(() => {
        if (!blob || !key) return
        const url = URL.createObjectURL(blob)
        setImage({ key, blob, url })
        return () => URL.revokeObjectURL(url)
    }, [blob, key])
    return image?.key === key && image.blob === blob ? image.url : null
}
export function AccountAvatar() {
    const { user } = useSession(),
        url = useAccountAvatar()
    const [failed, setFailed] = useState<string | null>(null)
    const initials = (user?.nickname || user?.username || 'AA').trim().slice(0, 2).toUpperCase()
    return url && failed !== url ? (
        <img className="account-avatar-image" src={url} alt="" onError={() => setFailed(url)} />
    ) : (
        <>{initials}</>
    )
}
export function AccountEntry({ mobile = false }: { mobile?: boolean }) {
    const flow = useAccountFlow(),
        session = useSession()
    if (!mobile && !session.user)
        return (
            <div className="desktop-guest-account">
                <p className="desktop-login-hint" id="desktop-login-hint">
                    <span>
                        Login to bookmark points
                        <br />
                        or contribute.
                    </span>
                </p>
                <DesignButton
                    id="desktop-account"
                    className="desktop-login-button"
                    aria-describedby="desktop-login-hint"
                    onClick={() => flow?.open()}
                >
                    <span>Login</span>
                    <FigmaIcon name="authLogin" size={24} />
                </DesignButton>
            </div>
        )
    return (
        <DesignButton
            id={mobile ? 'mobile-account' : 'desktop-account'}
            className={mobile ? 'mobile-avatar' : 'desktop-account live-account'}
            aria-label={session.user ? 'Account' : 'Login'}
            onClick={() => flow?.open()}
        >
            {mobile ? (
                session.store ? (
                    <AccountAvatar />
                ) : (
                    'AA'
                )
            ) : (
                <>
                    <span className="account-avatar">
                        {session.store ? <AccountAvatar /> : 'AA'}
                    </span>
                    <span className="account-entry-text">
                        <span className="account-name">
                            {session.user?.nickname || session.user?.username || 'Login'}
                        </span>
                        {session.user && (
                            <span className="account-handle">{session.user.username}</span>
                        )}
                    </span>
                    <FigmaIcon name="accountMore" className="account-entry-more" />
                </>
            )}
        </DesignButton>
    )
}
