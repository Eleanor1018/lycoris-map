import { useUi } from '@/shared/i18n/ui'
import { useState, type FormEvent } from 'react'
import { DesignButton } from '@/shared/ui/design-primitives'
import { useAccountFlow } from './AccountFlow'
import { useSession } from './SessionProvider'
import { AccountField, AccountSubmit, accountError, passwordError } from './accountFields'
import apple from '@/assets/figma/auth-apple.svg'
import google from '@/assets/figma/auth-google.svg'

export function AuthForm({ register, mobile }: { register: boolean; mobile: boolean }) {
    const ui = useUi()
    const session = useSession(),
        flow = useAccountFlow()!
    const [identity, setIdentity] = useState(''),
        [email, setEmail] = useState(''),
        [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!session.store || session.busy) return
        if (!identity.trim() || !password || (register && !email.trim())) {
            setError('Please fill in all required fields.')
            return
        }
        const invalid = register ? passwordError(password) : null
        if (invalid) {
            setError(invalid)
            return
        }
        setError(null)
        try {
            if (register)
                await session.store.register({
                    username: identity.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                })
            else await session.store.login({ username: identity.trim(), password })
            setPassword('')
            await flow.authenticated(flow.round)
        } catch (error) {
            setPassword('')
            if (flow.isCurrent(flow.round)) setError(accountError(error))
        }
    }
    return (
        <>
            <form className="auth-form" onSubmit={(event) => void submit(event)}>
                <div className="account-fields">
                    {register && (
                        <AccountField
                            label="Email"
                            type="email"
                            autoComplete="email"
                            required
                            maxLength={255}
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            disabled={session.busy}
                        />
                    )}
                    <AccountField
                        label={register ? 'Username' : 'Email or Username'}
                        name="username"
                        autoComplete="username"
                        required
                        maxLength={register ? 255 : undefined}
                        value={identity}
                        onChange={(event) => setIdentity(event.target.value)}
                        disabled={session.busy}
                        autoCapitalize="none"
                        spellCheck={false}
                    />
                    <AccountField
                        label="Password"
                        name="password"
                        type="password"
                        autoComplete={register ? 'new-password' : 'current-password'}
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={session.busy}
                    />
                    {register && (
                        <AccountField
                            className="verification-field"
                            label="Verification Code"
                            disabled
                            placeholder={ui.text('Not enabled yet')}
                        />
                    )}
                </div>
                <p className="auth-switch">
                    {ui.text(register ? 'Already have an account?' : 'Haven’t got an account?')}{' '}
                    <DesignButton
                        onClick={() => flow.setView(register ? 'login' : 'register')}
                        disabled={session.busy}
                    >
                        {ui.text(register ? 'Login Here.' : 'Register Here.')}
                    </DesignButton>
                </p>
                {(error || flow.message) && (
                    <p className="account-status" role="alert">
                        {ui.message(error ?? flow.message)}
                    </p>
                )}
                <AccountSubmit disabled={session.busy} aria-busy={session.busy}>
                    {session.busy ? 'Please wait…' : register ? 'Register' : 'Login'}
                </AccountSubmit>
            </form>
            <div className="auth-social">
                <h3>{ui.text(mobile ? 'Third Party Login' : '--OR--')}</h3>
                <div className="auth-social-buttons">
                    <DesignButton
                        className="auth-apple"
                        onClick={() =>
                            setError(
                                'Apple login is not available yet. Please use your email or username.',
                            )
                        }
                    >
                        <img src={apple} alt="" width={24} height={24} />
                        <span>{ui.text('Continue with Apple')}</span>
                    </DesignButton>
                    <DesignButton
                        className="auth-google"
                        onClick={() =>
                            setError(
                                'Google login is not available yet. Please use your email or username.',
                            )
                        }
                    >
                        <img src={google} alt="" width={23} height={23} />
                        <span>{ui.text('Continue with Google')}</span>
                    </DesignButton>
                </div>
            </div>
        </>
    )
}
