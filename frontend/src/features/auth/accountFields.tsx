import { useUi } from '@/shared/i18n/ui'
import { useId, type ComponentProps } from 'react'
import { DesignButton } from '@/shared/ui/design-primitives'
import loginIcon from '@/assets/figma/auth-login.svg'

export function AccountField({
    label,
    className = '',
    ...props
}: ComponentProps<'input'> & { label: string }) {
    const ui = useUi()
    const id = useId()
    return (
        <label className={`account-field ${className}`} htmlFor={id}>
            <span>{ui.message(label)}</span>
            <input
                id={id}
                {...props}
                placeholder={
                    props.placeholder ? (ui.message(props.placeholder) ?? undefined) : undefined
                }
            />
        </label>
    )
}
export function AccountSubmit({ children, ...props }: ComponentProps<typeof DesignButton>) {
    const ui = useUi()
    return (
        <DesignButton type="submit" className="account-submit" {...props}>
            <span>{typeof children === 'string' ? ui.message(children) : children}</span>
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
