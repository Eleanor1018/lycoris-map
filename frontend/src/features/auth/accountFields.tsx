import { useId, type ComponentProps } from 'react'
import { DesignButton } from '@/shared/ui/design-primitives'
import loginIcon from '@/assets/figma/auth-login.svg'

export function AccountField({
    label,
    className = '',
    ...props
}: ComponentProps<'input'> & { label: string }) {
    const id = useId()
    return (
        <label className={`account-field ${className}`} htmlFor={id}>
            <span>{label}</span>
            <input id={id} {...props} />
        </label>
    )
}
export function AccountSubmit({ children, ...props }: ComponentProps<typeof DesignButton>) {
    return (
        <DesignButton type="submit" className="account-submit" {...props}>
            <span>{children}</span>
            <img src={loginIcon} alt="" width={24} height={24} />
        </DesignButton>
    )
}
export function passwordError(value: string): string | null {
    if (value.length < 4 || new TextEncoder().encode(value).length > 72)
        return 'Use at least 4 characters and no more than 72 UTF-8 bytes for your password.'
    return null
}
export function accountError(error: unknown): string {
    if (error instanceof Error) {
        if (error.message === '账号已创建，请稍后登录')
            return 'Your account was created. Please log in when the service is available.'
        return error.message
    }
    return 'The request could not be completed. Try again.'
}
