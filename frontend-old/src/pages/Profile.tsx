import { useLanguage } from '../i18n/LanguageProvider'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Avatar,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Box,
    Button,
    IconButton,
    Snackbar,
    Alert,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    Typography,
} from '@mui/material'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { useAuth } from '../auth/AuthProvider'
import axios from 'axios'
import EditProfileDialog from '../components/EditProfileDialog'
import chisatoAvatar from '../../chisato.png'

type MarkerRow = {
    id: number
    title: string
    category: string
    updatedAt: string
    lat?: number
    lng?: number
}

type MarkerApiRow = {
    id: number
    title: string
    category: string
    updatedAt?: string
    createdAt?: string
    lat?: number
    lng?: number
}

const categoryLabelMap: Record<string, string> = {
    accessible_toilet: '无障碍卫生间',
    friendly_clinic: '友好医疗机构',
    baby_room: '母婴室',
    self_definition: '自定义',
    safe_place: '自定义',
    dangerous_place: '自定义',
}
//560px, 68vh, 700px
export default function Profile() {
    const { language, t } = useLanguage()
    const desktopCardHeight = 'clamp(560px, 68vh, 68vh)'
    const rowsPerPage = 3
    const { user, logout, refresh } = useAuth()
    const navigate = useNavigate()
    const [createdPage, setCreatedPage] = useState(0)
    const [favoritePage, setFavoritePage] = useState(0)
    const [editOpen, setEditOpen] = useState(false)
    const [nickname, setNickname] = useState('')
    const [pronouns, setPronouns] = useState('')
    const [signature, setSignature] = useState('')
    const [avatarFile, setAvatarFile] = useState<File | null>(null)
    const [saveOpen, setSaveOpen] = useState(false)
    const [jumpDialogOpen, setJumpDialogOpen] = useState(false)
    const [jumpNoPrompt, setJumpNoPrompt] = useState(() => {
        if (typeof window === 'undefined') return false
        return window.localStorage.getItem('profile.skipMapJumpConfirm') === '1'
    })
    const [pendingJumpMarker, setPendingJumpMarker] = useState<MarkerRow | null>(null)
    const rowClickTimerRef = useRef<number | null>(null)

    const [createdRows, setCreatedRows] = useState<MarkerRow[]>([])
    const [favoriteRows, setFavoriteRows] = useState<MarkerRow[]>([])
    const createdSlice = createdRows.slice(createdPage * rowsPerPage, (createdPage + 1) * rowsPerPage)
    const favoriteSlice = favoriteRows.slice(favoritePage * rowsPerPage, (favoritePage + 1) * rowsPerPage)

    useEffect(() => {
        if (!user) return
        const controller = new AbortController()
        const loadMarkers = async () => {
            try {
                const [createdRes, favRes] = await Promise.all([
                    axios.get('/api/markers/me/created', { withCredentials: true, params: { lang: language }, signal: controller.signal }),
                    axios.get('/api/markers/me/favorites/details', { withCredentials: true, params: { lang: language }, signal: controller.signal }),
                ])

                if (controller.signal.aborted) return
                const created = ((createdRes.data ?? []) as MarkerApiRow[]).map((m) => ({
                    id: m.id,
                    title: m.title,
                    category: t(categoryLabelMap[m.category] ?? m.category),
                    updatedAt: (m.updatedAt ?? m.createdAt ?? '').toString().slice(0, 10),
                    lat: typeof m.lat === 'number' ? m.lat : undefined,
                    lng: typeof m.lng === 'number' ? m.lng : undefined,
                }))
                const favorites = ((favRes.data ?? []) as MarkerApiRow[]).map((m) => ({
                    id: m.id,
                    title: m.title,
                    category: t(categoryLabelMap[m.category] ?? m.category),
                    updatedAt: (m.updatedAt ?? m.createdAt ?? '').toString().slice(0, 10),
                    lat: typeof m.lat === 'number' ? m.lat : undefined,
                    lng: typeof m.lng === 'number' ? m.lng : undefined,
                }))
                setCreatedRows(created)
                setFavoriteRows(favorites)
                setCreatedPage(0)
                setFavoritePage(0)
            } catch {
                if (controller.signal.aborted) return
                setCreatedRows([])
                setFavoriteRows([])
                setCreatedPage(0)
                setFavoritePage(0)
            }
        }

        void loadMarkers()
        return () => controller.abort()
    }, [user, language, t])

    const goToMapMarker = (row: MarkerRow) => {
        const params = new URLSearchParams({
            markerId: String(row.id),
            lang: language,
        })
        navigate(`/maps?${params.toString()}`)
    }

    const onMarkerRowClick = (row: MarkerRow) => {
        if (jumpNoPrompt) {
            goToMapMarker(row)
            return
        }
        setPendingJumpMarker(row)
        setJumpDialogOpen(true)
    }

    const handleJumpConfirm = () => {
        if (!pendingJumpMarker) return
        if (typeof window !== 'undefined') {
            if (jumpNoPrompt) {
                window.localStorage.setItem('profile.skipMapJumpConfirm', '1')
            } else {
                window.localStorage.removeItem('profile.skipMapJumpConfirm')
            }
        }
        const next = pendingJumpMarker
        setJumpDialogOpen(false)
        setPendingJumpMarker(null)
        goToMapMarker(next)
    }

    const handleRowClick = (row: MarkerRow) => {
        if (rowClickTimerRef.current != null) {
            window.clearTimeout(rowClickTimerRef.current)
        }
        rowClickTimerRef.current = window.setTimeout(() => {
            onMarkerRowClick(row)
            rowClickTimerRef.current = null
        }, 220)
    }

    const handleRowDoubleClick = (row: MarkerRow) => {
        if (rowClickTimerRef.current != null) {
            window.clearTimeout(rowClickTimerRef.current)
            rowClickTimerRef.current = null
        }
        goToMapMarker(row)
    }

    const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, row: MarkerRow) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onMarkerRowClick(row)
    }

    const getRowAriaLabel = (row: MarkerRow) =>
        t("点位 {0}，类型 {1}，更新于 {2}。按回车键查看地图位置。", { 0: row.title, 1: row.category, 2: row.updatedAt || t("未知") })

    useEffect(() => {
        return () => {
            if (rowClickTimerRef.current != null) {
                window.clearTimeout(rowClickTimerRef.current)
            }
        }
    }, [])

    return (
        <Box
            sx={{
                minHeight: 'calc(100vh - 64px)',
                display: 'flex',
                alignItems: { xs: 'stretch', md: 'center' },
                px: { xs: 2, md: 4 },
                py: { xs: 2, md: 4 },
                overflowX: 'hidden',
                background:
                    'linear-gradient(180deg, rgba(252,248,255,0.9) 0%, rgba(248,250,255,0.9) 60%, #fff 100%)',
            }}
        >
            <Box sx={{ width: '100%', maxWidth: 1200, minWidth: 0, mx: 'auto', display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '320px 1fr' } }}>
                {/* Left profile panel */}
                <Paper
                    sx={{
                        p: 3,
                        borderRadius: 4,
                        minHeight: { xs: 460, md: desktopCardHeight },
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <IconButton
                        aria-label={t("编辑资料")}
                        onClick={() => {
                            setNickname(user?.nickname || user?.username || '')
                            setPronouns(user?.pronouns || '')
                            setSignature(user?.signature || '')
                            setAvatarFile(null)
                            setEditOpen(true)
                        }}
                        sx={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            color: '#744988',
                            bgcolor: 'rgba(116, 73, 136, 0.10)',
                            '&:hover': { bgcolor: 'rgba(116, 73, 136, 0.18)' },
                        }}
                    >
                        <EditRoundedIcon fontSize="small" />
                    </IconButton>
                    <Stack
                        spacing={3}
                        alignItems="center"
                        justifyContent="center"
                        sx={{ minHeight: { xs: 'auto', md: 'calc(clamp(560px, 68vh, 68vh) - 48px)' } }}
                    >
                        <Avatar
                            src={user?.avatarUrl || chisatoAvatar}
                            sx={{
                                width: 140,
                                height: 140,
                                border: '4px solid #f2e6f7',
                                boxShadow: '0 10px 24px rgba(116, 73, 136, 0.15)',
                            }}
                        />
                        <Stack spacing={0.5} alignItems="center">
                            <Typography variant="h6" fontWeight={800}>
                                {user?.nickname || user?.username || 'Eleanor'}
                            </Typography>
                            <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                @{user?.username?.toLowerCase?.() ?? 'eleanor'}
                                {user?.pronouns ? ` · ${user.pronouns}` : ''}
                            </Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ textAlign: 'center', opacity: 0.8 }}>
                            {user?.signature || 'Default signature'}
                        </Typography>
                        <Button
                            onClick={() => navigate('/me/password')}
                            variant="outlined"
                            sx={{
                                borderRadius: 999,
                                px: 3,
                                color: '#744988',
                                borderColor: '#d7c0e5',
                                '&:hover': { borderColor: '#744988', bgcolor: 'rgba(116, 73, 136, 0.08)' },
                            }}
                        >
                            {t("修改密码")}</Button>
                        <Button
                            onClick={async () => {
                                await logout()
                                navigate('/')
                            }}
                            variant="contained"
                            sx={{
                                borderRadius: 999,
                                px: 3,
                                bgcolor: '#e07a7a',
                                '&:hover': { bgcolor: '#d86a6a' },
                            }}
                        >
                            {t("退出登录")}</Button>
                    </Stack>
                </Paper>

                {/* Right content */}
                <Paper
                    sx={{
                        p: 2.5,
                        py: { xs: 3, md: 4 },
                        borderRadius: 4,
                        minHeight: { xs: 'auto', md: desktopCardHeight },
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <Typography variant="h6" fontWeight={800}>
                        {t("点位列表")}</Typography>
                    <Typography variant="body2" sx={{ opacity: 0.7, mt: 0.5 }}>
                        {t("点位按“创建 / 收藏”分开展示")}</Typography>
                    <Stack spacing={2} sx={{ mt: 2, flex: 1 }}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                                {t("我创建的点位")}</Typography>
                            <TableContainer sx={{ maxHeight: { xs: 180, md: 205 } }}>
                                <Table size="small" stickyHeader sx={{ tableLayout: 'fixed' }}>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ width: '58%' }}>{t("名称")}</TableCell>
                                            <TableCell sx={{ width: '22%' }}>{t("类型")}</TableCell>
                                            <TableCell align="right" sx={{ width: '20%' }}>{t("更新")}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {createdRows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} align="center">{t("暂无创建点位")}</TableCell>
                                            </TableRow>
                                        ) : (
                                            createdSlice.map((row) => (
                                                <TableRow
                                                    key={`created-${row.id}`}
                                                    hover
                                                    onClick={() => handleRowClick(row)}
                                                    onDoubleClick={() => handleRowDoubleClick(row)}
                                                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                                                    tabIndex={0}
                                                    role="button"
                                                    aria-label={getRowAriaLabel(row)}
                                                    sx={{
                                                        cursor: 'pointer',
                                                        '&:focus-visible': {
                                                            outline: '2px solid #744988',
                                                            outlineOffset: '-2px',
                                                        },
                                                    }}
                                                >
                                                    <TableCell>{row.title}</TableCell>
                                                    <TableCell>{row.category}</TableCell>
                                                    <TableCell align="right">{row.updatedAt}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                        {createdRows.length > 0 &&
                                            Array.from({ length: Math.max(0, rowsPerPage - createdSlice.length) }).map((_, idx) => (
                                                <TableRow key={`created-empty-${idx}`} sx={{ height: 37 }}>
                                                    <TableCell colSpan={3} />
                                                </TableRow>
                                            ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            <TablePagination
                                component="div"
                                count={createdRows.length}
                                page={createdPage}
                                onPageChange={(_, page) => setCreatedPage(page)}
                                rowsPerPage={rowsPerPage}
                                rowsPerPageOptions={[3]}
                                sx={{ mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}
                            />
                        </Box>

                        <Box>
                            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                                {t("我收藏的点位")}</Typography>
                            <TableContainer sx={{ maxHeight: { xs: 180, md: 205 } }}>
                                <Table size="small" stickyHeader sx={{ tableLayout: 'fixed' }}>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ width: '58%' }}>{t("名称")}</TableCell>
                                            <TableCell sx={{ width: '22%' }}>{t("类型")}</TableCell>
                                            <TableCell align="right" sx={{ width: '20%' }}>{t("更新")}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {favoriteRows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} align="center">{t("暂无收藏点位")}</TableCell>
                                            </TableRow>
                                        ) : (
                                            favoriteSlice.map((row) => (
                                                <TableRow
                                                    key={`fav-${row.id}`}
                                                    hover
                                                    onClick={() => handleRowClick(row)}
                                                    onDoubleClick={() => handleRowDoubleClick(row)}
                                                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                                                    tabIndex={0}
                                                    role="button"
                                                    aria-label={getRowAriaLabel(row)}
                                                    sx={{
                                                        cursor: 'pointer',
                                                        '&:focus-visible': {
                                                            outline: '2px solid #744988',
                                                            outlineOffset: '-2px',
                                                        },
                                                    }}
                                                >
                                                    <TableCell>{row.title}</TableCell>
                                                    <TableCell>{row.category}</TableCell>
                                                    <TableCell align="right">{row.updatedAt}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                        {favoriteRows.length > 0 &&
                                            Array.from({ length: Math.max(0, rowsPerPage - favoriteSlice.length) }).map((_, idx) => (
                                                <TableRow key={`fav-empty-${idx}`} sx={{ height: 37 }}>
                                                    <TableCell colSpan={3} />
                                                </TableRow>
                                            ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            <TablePagination
                                component="div"
                                count={favoriteRows.length}
                                page={favoritePage}
                                onPageChange={(_, page) => setFavoritePage(page)}
                                rowsPerPage={rowsPerPage}
                                rowsPerPageOptions={[3]}
                                sx={{ mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}
                            />
                        </Box>
                    </Stack>
                </Paper>
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
            <Dialog open={jumpDialogOpen} onClose={() => setJumpDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ fontWeight: 800 }}>{t("跳转到地图上？")}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ opacity: 0.85 }}>
                        {t("将定位到“")}{pendingJumpMarker?.title ?? t("该点位")}{t("”，并尝试自动打开详情。")}</Typography>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
                        <Checkbox
                            checked={jumpNoPrompt}
                            onChange={(e) => setJumpNoPrompt(e.target.checked)}
                            size="small"
                            sx={{ p: 0.5 }}
                        />
                        <Typography variant="body2">{t("下次不再提示")}</Typography>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 2, pb: 1.5 }}>
                    <Button onClick={() => setJumpDialogOpen(false)} sx={{ borderRadius: 999, textTransform: 'none' }}>
                        {t("取消")}</Button>
                    <Button
                        variant="contained"
                        onClick={handleJumpConfirm}
                        sx={{
                            borderRadius: 999,
                            textTransform: 'none',
                            bgcolor: '#b784a7',
                            '&:hover': { bgcolor: '#a77597' },
                        }}
                    >
                        {t("确定")}</Button>
                </DialogActions>
            </Dialog>
            <Snackbar
                open={saveOpen}
                autoHideDuration={2000}
                onClose={() => setSaveOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="success" variant="filled" onClose={() => setSaveOpen(false)}>
                    {t("保存成功")}</Alert>
            </Snackbar>
        </Box>
    )
}
