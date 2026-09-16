import { Dialog } from 'radix-ui'
import { useAccountFlow } from './AccountFlow'
import { useMobileLayout } from '@/layouts/useMobileLayout'
import { DesignButton } from '@/shared/ui/design-primitives'
import { AuthForm } from './AuthForm'
import closeIcon from '@/assets/figma/auth-close.svg'
import './account.css'
import { ProfilePanel, MyPlacesPanel } from '@/features/profile/ProfilePanel'
import type { PlaceBrowse } from '@/features/places/usePlaceBrowse'
import type { Marker } from '@/shared/api/markers'

export function AccountDialog({
    browse,
    onSelect,
}: {
    browse: PlaceBrowse
    onSelect: (place: Marker, focus: string) => void
}) {
    const flow = useAccountFlow(),
        mobile = useMobileLayout()
    if (!flow) return null
    const view = flow.view
    const title =
        view === 'register'
            ? 'Register'
            : view === 'login'
              ? 'Login'
              : view === 'password'
                ? 'Change Password'
                : view === 'created'
                  ? 'My Places'
                  : 'Account'
    return (
        <Dialog.Root
            open={view !== null}
            onOpenChange={(open) => {
                if (!open) flow.close()
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className="account-overlay" />
                <Dialog.Content
                    className={`account-dialog ${mobile ? 'account-mobile' : 'account-desktop'} account-${view}`}
                    data-account-dialog
                    aria-describedby={undefined}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        document.getElementById('account-title')?.focus()
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        flow.restoreFocus()
                    }}
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                >
                    <Dialog.Close asChild>
                        <DesignButton
                            className={mobile ? 'account-sheet-handle' : 'account-close'}
                            aria-label="Close account window"
                        >
                            {mobile ? (
                                <span />
                            ) : (
                                <img src={closeIcon} alt="" width={24} height={24} />
                            )}
                        </DesignButton>
                    </Dialog.Close>
                    <div className="account-dialog-scroll">
                        <div className="account-dialog-inner">
                            <Dialog.Title id="account-title" tabIndex={-1}>
                                {title}
                            </Dialog.Title>
                            {(view === 'login' || view === 'register') && (
                                <AuthForm
                                    key={view}
                                    register={view === 'register'}
                                    mobile={mobile}
                                />
                            )}
                            {(view === 'profile' || view === 'password') && (
                                <ProfilePanel password={view === 'password'} />
                            )}
                            {view === 'created' && (
                                <MyPlacesPanel
                                    browse={browse}
                                    mobile={mobile}
                                    onSelect={onSelect}
                                />
                            )}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
