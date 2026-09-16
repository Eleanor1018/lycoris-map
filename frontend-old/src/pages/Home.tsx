import { useEffect, useState } from 'react'
import { Alert, Box, Button, Snackbar, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../auth/AuthProvider'
import EditProfileDialog from '../components/EditProfileDialog'

const desktopPinPath =
    'M1217 443C1244.84 443 1268.68 433.052 1288.51 413.155C1308.34 393.258 1318.25 369.34 1318.25 341.4C1318.25 313.46 1308.34 289.542 1288.51 269.645C1268.68 249.748 1244.84 239.8 1217 239.8C1189.16 239.8 1165.32 249.748 1145.49 269.645C1125.66 289.542 1115.75 313.46 1115.75 341.4C1115.75 369.34 1125.66 393.258 1145.49 413.155C1165.32 433.052 1189.16 443 1217 443ZM1217 816.38C1319.94 721.553 1396.3 635.405 1446.08 557.935C1495.86 480.465 1520.75 411.673 1520.75 351.56C1520.75 259.273 1491.43 183.708 1432.79 124.865C1374.15 66.0217 1302.22 36.6 1217 36.6C1131.78 36.6 1059.85 66.0217 1001.21 124.865C942.57 183.708 913.25 259.273 913.25 351.56C913.25 411.673 938.141 480.465 987.922 557.935C1037.7 635.405 1114.06 721.553 1217 816.38ZM1217 951C1081.16 835.007 979.695 727.268 912.617 627.785C845.539 528.302 812 436.227 812 351.56C812 224.56 852.711 123.383 934.133 48.03C1015.55 -27.3233 1109.84 -65 1217 -65C1324.16 -65 1418.45 -27.3233 1499.87 48.03C1581.29 123.383 1622 224.56 1622 351.56C1622 436.227 1588.46 528.302 1521.38 627.785C1454.3 727.268 1352.84 835.007 1217 951Z'

const mobilePinPath =
    'M319 562C333.025 562 345.031 556.987 355.019 546.96C365.006 536.933 370 524.88 370 510.8C370 496.72 365.006 484.667 355.019 474.64C345.031 464.613 333.025 459.6 319 459.6C304.975 459.6 292.969 464.613 282.981 474.64C272.994 484.667 268 496.72 268 510.8C268 524.88 272.994 536.933 282.981 546.96C292.969 556.987 304.975 562 319 562ZM319 750.16C370.85 702.373 409.313 658.96 434.388 619.92C459.463 580.88 472 546.213 472 515.92C472 469.413 457.231 431.333 427.694 401.68C398.156 372.027 361.925 357.2 319 357.2C276.075 357.2 239.844 372.027 210.306 401.68C180.769 431.333 166 469.413 166 515.92C166 546.213 178.538 580.88 203.613 619.92C228.688 658.96 267.15 702.373 319 750.16ZM319 818C250.575 759.547 199.469 705.253 165.681 655.12C131.894 604.987 115 558.587 115 515.92C115 451.92 135.506 400.933 176.519 362.96C217.531 324.987 265.025 306 319 306C372.975 306 420.469 324.987 461.481 362.96C502.494 400.933 523 451.92 523 515.92C523 558.587 506.106 604.987 472.319 655.12C438.531 705.253 387.425 759.547 319 818Z'

function HomePinBackdrop() {
    return (
        <>
            <Box
                component="svg"
                viewBox="0 0 1440 1024"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
                sx={{
                    display: { xs: 'none', md: 'block' },
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                }}
            >
                <path d={desktopPinPath} fill="var(--ly-color-pin)" fillOpacity="0.2" />
            </Box>
            <Box
                component="svg"
                viewBox="0 0 402 874"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
                sx={{
                    display: { xs: 'block', md: 'none' },
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                }}
            >
                <path d={mobilePinPath} fill="var(--ly-color-pin)" fillOpacity="0.2" />
            </Box>
        </>
    )
}

export default function Home() {
    const { user, refresh } = useAuth()
    const [editOpen, setEditOpen] = useState(false)
    const [nickname, setNickname] = useState('')
    const [pronouns, setPronouns] = useState('')
    const [signature, setSignature] = useState('')
    const [avatarFile, setAvatarFile] = useState<File | null>(null)
    const [saveOpen, setSaveOpen] = useState(false)

    useEffect(() => {
        if (!user) return
        const shouldOpen = window.localStorage.getItem('onboarding.editProfileAfterRegister') === '1'
        if (!shouldOpen) return
        window.localStorage.removeItem('onboarding.editProfileAfterRegister')
        const timer = window.setTimeout(() => {
            setNickname(user.nickname || user.username || '')
            setPronouns(user.pronouns || '')
            setSignature(user.signature || '')
            setAvatarFile(null)
            setEditOpen(true)
        }, 0)
        return () => window.clearTimeout(timer)
    }, [user])

    return (
        <>
            <Box
                component="section"
                sx={{
                    position: 'relative',
                    overflow: { xs: 'visible', md: 'hidden' },
                    minHeight: 'calc(100svh - var(--nav-height, 94px))',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: { xs: 'center', md: 'flex-end' },
                    alignItems: 'flex-start',
                    px: { xs: '26px', md: 'clamp(40px, 4.7vw, 68px)' },
                    py: { xs: 3, md: 'clamp(72px, 7.2vw, 104px)' },
                    background: 'linear-gradient(180deg, #f6f6f6 0%, #f6f6f6 58%, #f8ebff 100%)',
                }}
            >
                <HomePinBackdrop />
                <Box
                    sx={{
                        position: 'relative',
                        zIndex: 1,
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        maxWidth: { xs: 350, md: 1180 },
                        transform: 'none',
                    }}
                >
                    <Typography
                        component="h1"
                        aria-label="Trans Support Together"
                        sx={{
                            m: 0,
                            color: '#000',
                            fontFamily: 'var(--ly-font-display)',
                            fontSize: { xs: 'clamp(3.15rem, 13.6vw, 4rem)', md: 'clamp(5.6rem, 7.5vw, 7.25rem)' },
                            fontWeight: 500,
                            lineHeight: { xs: 0.82, md: 0.78 },
                            letterSpacing: { xs: '-0.085em', md: '-0.08em' },
                            textTransform: 'uppercase',
                            userSelect: 'none',
                        }}
                    >
                        <Box component="span" sx={{ display: 'block' }}>TRANS-</Box>
                        <Box component="span" sx={{ display: 'block' }}>SUPPORT</Box>
                        <Box component="span" sx={{ display: 'block' }}>TOGETHER</Box>
                    </Typography>

                    <Typography
                        component="p"
                        sx={{
                            mt: { xs: 3, md: 6 },
                            mb: 0,
                            color: '#000',
                            fontFamily: 'var(--ly-font-body)',
                            fontSize: { xs: '1.2rem', md: '1.42rem' },
                            fontWeight: 400,
                            lineHeight: { xs: 1.45, md: 1.6 },
                            letterSpacing: '-0.01em',
                        }}
                    >
                        <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                            欢迎来到夏水仙，一个为跨性别者提供无障碍设施信息和互助信息的平台
                        </Box>
                        <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>
                            欢迎来到夏水仙
                            <br />
                            一个为跨性别者提供
                            <br />
                            无障碍设施信息和互助信息的平台
                        </Box>
                    </Typography>

                    <Button
                        disableElevation
                        component={RouterLink}
                        variant="contained"
                        to="/maps"
                        sx={{
                            mt: { xs: 7, md: 4 },
                            alignSelf: { xs: 'flex-end', md: 'flex-start' },
                            width: 176,
                            height: 53,
                            borderRadius: 999,
                            border: '1px solid var(--ly-color-ink)',
                            bgcolor: 'var(--ly-color-lilac)',
                            color: 'var(--ly-color-ink)',
                            fontFamily: 'var(--ly-font-body)',
                            fontSize: { xs: 22, md: 24 },
                            fontWeight: 700,
                            textTransform: 'none',
                            '&:hover': {
                                bgcolor: '#c8afff',
                            },
                        }}
                    >
                        进入地图
                    </Button>
                </Box>
            </Box>
            <EditProfileDialog
                open={editOpen}
                nickname={nickname}
                pronouns={pronouns}
                signature={signature}
                avatarFile={avatarFile}
                onNicknameChange={setNickname}
                onPronounsChange={setPronouns}
                onSignatureChange={setSignature}
                onAvatarChange={setAvatarFile}
                onClose={() => setEditOpen(false)}
                onSave={async () => {
                    await axios.patch(
                        '/api/me',
                        { nickname, pronouns, signature },
                        { withCredentials: true }
                    )
                    if (avatarFile) {
                        const form = new FormData()
                        form.append('file', avatarFile)
                        await axios.post('/api/me/avatar', form, { withCredentials: true })
                    }
                    await refresh()
                    setEditOpen(false)
                    setSaveOpen(true)
                }}
            />
            <Snackbar
                open={saveOpen}
                autoHideDuration={2200}
                onClose={() => setSaveOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="success" variant="filled" onClose={() => setSaveOpen(false)}>
                    欢迎加入，资料保存成功
                </Alert>
            </Snackbar>
        </>
    )
}
