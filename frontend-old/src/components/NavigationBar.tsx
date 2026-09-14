import { useLanguage } from '../i18n/LanguageProvider'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import AuthButtons from './AuthButtons.tsx'
import LanguageSelector from './LanguageSelector'
import {
    AppBar,
    Toolbar,
    Box,
    Button,
    Stack,
    IconButton,
    Drawer,
    Divider,
    List,
    ListItemButton,
    ListItemText,
    Typography,
    Avatar,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'

import { useAuth } from '../auth/AuthProvider.tsx'
import chisatoAvatar from '../../chisato.png'

type NavItem = { label: string; to: string }
const drawerEdgePadding = 'calc(16px + max(env(safe-area-inset-top, 0px), env(safe-area-inset-bottom, 0px)))'

export default function NavigationBar() {
    const { t } = useLanguage()
    const location = useLocation()
    const navigate = useNavigate()
    const { isLoggedIn, user, logout } = useAuth()
    const navShellRef = useRef<HTMLDivElement | null>(null)
    const [navOpen, setNavOpen] = useState(false)

    const navItems: NavItem[] = useMemo(
        () => [
            { label: t("地图"), to: '/maps' },
            { label: t("发现"), to: '/discover' },
            { label: t("关于"), to: '/about' },
        ],
        [t]
    )

    const mobileAvatarUrl = isLoggedIn ? user?.avatarUrl || chisatoAvatar : undefined
    const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`)
    const closeNavMenu = () => setNavOpen(false)

    useEffect(() => {
        const el = navShellRef.current
        if (!el) return

        const update = () => {
            const height = Math.round(el.getBoundingClientRect().height)
            if (height > 0) {
                document.documentElement.style.setProperty('--nav-height', `${height}px`)
                document.documentElement.style.setProperty('--nav-offset', `${height}px`)
            }
        }

        update()
        if (typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver(update)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    return (
        <>
        <AppBar
            position="fixed"
            elevation={0}
            sx={{
                bgcolor: 'transparent',
                color: 'var(--ly-color-ink)',
                boxShadow: 'none',
                pointerEvents: 'none',
                zIndex: (theme) => theme.zIndex.appBar,
                top: 0,
                left: 0,
                right: 0,
            }}
        >
            <Box
                ref={navShellRef}
                sx={{
                    px: { xs: 1.5, md: 'clamp(20px, 2.5vw, 36px)' },
                    pt: { xs: 1, md: 1.5 },
                    pb: { xs: 1.25, md: 1.75 },
                    width: '100%',
                    boxSizing: 'border-box',
                    pointerEvents: 'none',
                }}
            >
                <Toolbar
                    disableGutters
                    sx={{
                        minHeight: { xs: 70, md: 82 },
                        width: '100%',
                        maxWidth: '100%',
                        mx: 'auto',
                        px: { xs: 2, md: 3, lg: 4 },
                        gap: { xs: 1, md: 2.4 },
                        display: { xs: 'grid', md: 'flex' },
                        gridTemplateColumns: { xs: '54px minmax(0, 1fr) 54px', md: 'none' },
                        alignItems: 'center',
                        position: 'relative',
                        pointerEvents: 'auto',
                        borderRadius: 999,
                        border: '2px solid rgba(221, 165, 196, 0.31)',
                        background: {
                            xs: 'rgba(255, 255, 255, 0.48)',
                            md: 'rgba(230, 203, 255, 0.26)',
                        },
                        boxShadow: '0 20px 42px rgba(221, 165, 196, 0.24)',
                        backdropFilter: 'blur(22px)',
                        WebkitBackdropFilter: 'blur(22px)',
                    }}
                >
                    <IconButton
                        onClick={() => setNavOpen((prev) => !prev)}
                        sx={{
                            display: { xs: 'inline-flex', md: 'none' },
                            width: 54,
                            height: 54,
                            gridColumn: { xs: 1, md: 'auto' },
                            justifySelf: { xs: 'start', md: 'auto' },
                            p: 0,
                            bgcolor: 'var(--ly-color-lilac)',
                            color: '#1d1b20',
                            '&:hover': { bgcolor: '#c8afff' },
                        }}
                        aria-label={isLoggedIn ? t("打开个人导航菜单") : t("打开登录导航菜单")}
                        aria-expanded={navOpen}
                    >
                        <Avatar
                            src={mobileAvatarUrl}
                            sx={{
                                width: isLoggedIn ? 54 : 44,
                                height: isLoggedIn ? 54 : 44,
                                bgcolor: isLoggedIn ? 'transparent' : 'var(--ly-color-lilac)',
                                color: 'var(--ly-color-ink)',
                                border: 0,
                            }}
                        >
                            <PersonOutlineIcon />
                        </Avatar>
                    </IconButton>

                    <Box
                        component={RouterLink}
                        to="/"
                        aria-label={t("返回首页")}
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            textDecoration: 'none',
                            color: '#000',
                            position: 'static',
                            gridColumn: { xs: 2, md: 'auto' },
                            justifySelf: { xs: 'center', md: 'auto' },
                        }}
                    >
                        <Typography
                            component="span"
                            sx={{
                                fontFamily: 'var(--ly-font-logo)',
                                fontWeight: 700,
                                fontSize: { xs: 36, md: 34, lg: 36 },
                                lineHeight: 1,
                                letterSpacing: '-0.03em',
                            }}
                        >
                            Lycoris
                        </Typography>
                    </Box>

                    <Box
                        aria-hidden="true"
                        sx={{
                            display: { xs: 'none', md: 'block' },
                            flex: '0 0 auto',
                            width: { md: '25.4px', lg: '35px' },
                            height: 1,
                            pointerEvents: 'none',
                        }}
                    />

                    <Stack
                        direction="row"
                        spacing={{ md: 2.5, lg: 4 }}
                        sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}
                    >
                        {navItems.map((item) => {
                            const active = isActive(item.to)
                            return (
                                <Button
                                    key={item.to}
                                    component={RouterLink}
                                    to={item.to}
                                    variant="text"
                                    sx={{
                                        fontFamily: 'var(--ly-font-body)',
                                        fontSize: { md: 19, lg: 21 },
                                        fontWeight: 700,
                                        textTransform: 'none',
                                        borderRadius: 999,
                                        px: 1,
                                        color: 'var(--ly-color-ink)',
                                        bgcolor: active ? 'rgba(208, 188, 255, 0.42)' : 'transparent',
                                        '&:hover': {
                                            bgcolor: 'rgba(208, 188, 255, 0.36)',
                                        },
                                    }}
                                >
                                    {item.label}
                                </Button>
                            )
                        })}
                    </Stack>

                    <Box sx={{ display: { xs: 'none', md: 'block' }, flex: 1 }} />

                    <Box sx={{ display: { xs: 'none', md: 'flex' } }}><LanguageSelector /></Box>
                    <IconButton
                        aria-label={t("打开搜索页")}
                        onClick={() => navigate('/search')}
                        sx={{
                            display: { xs: navOpen ? 'none' : 'inline-flex', md: 'inline-flex' },
                            width: 54,
                            height: 54,
                            gridColumn: { xs: 3, md: 'auto' },
                            justifySelf: { xs: 'end', md: 'auto' },
                            position: 'static',
                            pointerEvents: 'auto',
                            bgcolor: '#f4b3cc',
                            color: '#1d1b20',
                            '&:hover': { bgcolor: '#efa7c5' },
                        }}
                    >
                        <SearchIcon />
                    </IconButton>

                    <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
                        <AuthButtons isLoggedIn={isLoggedIn} avatarUrl={user?.avatarUrl} />
                    </Box>
                </Toolbar>
            </Box>

            <Drawer
                anchor="left"
                open={navOpen}
                onClose={closeNavMenu}
                PaperProps={{
                    sx: {
                        width: 'min(360px, 100vw)',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 0,
                        background: 'linear-gradient(180deg, #f6f6f6 0%, #f8ebff 100%)',
                    },
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexShrink: 0,
                        px: 2.5,
                        pt: drawerEdgePadding,
                        pb: 2,
                        borderBottom: '1px solid rgba(221, 165, 196, 0.36)',
                    }}
                >
                    <Typography
                        sx={{
                            fontFamily: 'var(--ly-font-logo)',
                            fontWeight: 700,
                            fontSize: 32,
                            letterSpacing: '-0.03em',
                            color: '#000',
                        }}
                    >
                        Lycoris
                    </Typography>
                    <IconButton onClick={closeNavMenu} aria-label={t("关闭导航菜单")}>
                        <CloseIcon />
                    </IconButton>
                </Box>

                <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                    {!isLoggedIn ? (
                        <List sx={{ px: 2, py: 1.5 }}>
                            <ListItemButton
                                onClick={() => {
                                    closeNavMenu()
                                    navigate('/login')
                                }}
                                sx={{ borderRadius: 999 }}
                            >
                                <ListItemText primary={t("登录")} primaryTypographyProps={{ fontWeight: 700, fontSize: 15 }} />
                            </ListItemButton>
                            <ListItemButton
                                onClick={() => {
                                    closeNavMenu()
                                    navigate('/register')
                                }}
                                sx={{ borderRadius: 999 }}
                            >
                                <ListItemText primary={t("注册")} primaryTypographyProps={{ fontWeight: 700, fontSize: 15 }} />
                            </ListItemButton>
                        </List>
                    ) : (
                        <List sx={{ px: 2, py: 1.5 }}>
                            <ListItemButton
                                onClick={() => {
                                    closeNavMenu()
                                    navigate('/me')
                                }}
                                sx={{ borderRadius: 999 }}
                            >
                                <ListItemText primary={t("个人中心")} primaryTypographyProps={{ fontWeight: 700, fontSize: 15 }} />
                            </ListItemButton>
                            <ListItemButton
                                onClick={async () => {
                                    closeNavMenu()
                                    await logout()
                                    navigate('/maps')
                                }}
                                sx={{ borderRadius: 999 }}
                            >
                                <ListItemText primary={t("退出登录")} primaryTypographyProps={{ fontWeight: 700, fontSize: 15 }} />
                            </ListItemButton>
                        </List>
                    )}

                    <Divider />

                    <List sx={{ px: 2, py: 1.5 }}>
                        {navItems.map((item) => (
                            <ListItemButton
                                key={item.to}
                                selected={isActive(item.to)}
                                onClick={() => {
                                    closeNavMenu()
                                    navigate(item.to)
                                }}
                                sx={{
                                    borderRadius: 999,
                                    color: 'var(--ly-color-ink)',
                                    '&.Mui-selected': {
                                        bgcolor: 'rgba(208, 188, 255, 0.52)',
                                    },
                                }}
                            >
                                <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: 700, fontSize: 15 }} />
                            </ListItemButton>
                        ))}
                    </List>
                </Box>

                <Box sx={{
                    display: 'flex',
                    flexShrink: 0,
                    px: 2.5,
                    pt: 2,
                    pb: drawerEdgePadding,
                }}>
                    <LanguageSelector />
                </Box>
            </Drawer>
        </AppBar>
        </>
    )
}
