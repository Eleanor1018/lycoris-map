import { Avatar, Button, IconButton } from '@mui/material'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import chisatoAvatar from '../../chisato.png'
import { useLanguage } from '../i18n/LanguageProvider'

type AuthButtonsProps = {
    isLoggedIn: boolean
    avatarUrl?: string
}

export default function AuthButtons({ isLoggedIn, avatarUrl }: AuthButtonsProps) {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const resolvedAvatarUrl = avatarUrl || chisatoAvatar

    if (isLoggedIn) {
        return (
            <IconButton
                onClick={() => navigate('/me')}
                size="small"
                sx={{
                    p: 0,
                    width: 54,
                    height: 54,
                    bgcolor: 'transparent',
                    overflow: 'hidden',
                    '&:hover': { bgcolor: 'transparent', opacity: 0.92 },
                }}
                aria-label={t('个人中心')}
            >
                <Avatar src={resolvedAvatarUrl} sx={{ width: 54, height: 54, bgcolor: 'transparent' }}>
                    <PersonOutlineIcon sx={{ color: 'var(--ly-color-ink)' }} />
                </Avatar>
            </IconButton>
        )
    }

    return (
        <Button
            component={RouterLink}
            to="/login"
            variant="contained"
            disableElevation
            sx={{
                minWidth: 148,
                height: 54,
                px: 2.75,
                borderRadius: 999,
                bgcolor: 'var(--ly-color-lilac)',
                color: 'var(--ly-color-ink)',
                fontFamily: 'var(--ly-font-body)',
                fontSize: { md: 18, lg: 20 },
                fontWeight: 700,
                textTransform: 'none',
                '&:hover': { bgcolor: '#c8afff' },
            }}
        >
            {t('登录')} / {t('注册')}
        </Button>
    )
}
