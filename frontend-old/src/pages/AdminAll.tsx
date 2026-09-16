import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
    Box,
    Typography,
    Stack,
    Paper,
    Button,
    Chip,
    Divider,
    CircularProgress,
    Pagination,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import MarkerFormDialog, { type DraftMarker } from '../components/MarkerFormDialog'
import AdminNav from '../components/AdminNav'
import { adminContainedButtonSx, adminOutlinedButtonSx, adminPaginationSx } from '../styles/adminButtons'

type AdminMarker = {
    id: number
    lat: number
    lng: number
    category: string
    title: string
    description?: string
    sourceLanguage?: 'zh' | 'en'
    isPublic: boolean
    isActive: boolean
    openTimeStart?: string | null
    openTimeEnd?: string | null
    markImage?: string | null
    username: string
    userPublicId?: string | null
    reviewStatus?: string
    lastEditedBy?: string
    lastEditedByOwner?: boolean
}

const categoryLabel: Record<string, string> = {
    accessible_toilet: '无障碍卫生间',
    friendly_clinic: '友好医疗机构',
    baby_room: '母婴室',
    self_definition: '自定义',
}

const toDraft = (marker: AdminMarker): DraftMarker => ({
    language: marker.sourceLanguage ?? 'zh',
    tempId: String(marker.id),
    lat: marker.lat,
    lng: marker.lng,
    category: marker.category as DraftMarker['category'],
    title: marker.title,
    description: marker.description ?? '',
    isPublic: marker.isPublic,
    openTimeStart: marker.openTimeStart ?? '',
    openTimeEnd: marker.openTimeEnd ?? '',
    markImage: marker.markImage ?? undefined,
})

export default function AdminAll() {
    const PAGE_SIZE = 10
    const navigate = useNavigate()
    const [markers, setMarkers] = useState<AdminMarker[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(1)

    const [draft, setDraft] = useState<DraftMarker | null>(null)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [markImageFile, setMarkImageFile] = useState<File | null>(null)
    const getErrorMessage = (err: unknown, fallback: string) => {
        if (typeof err === 'object' && err !== null && 'response' in err) {
            const response = (err as { response?: { data?: unknown } }).response
            const data = response?.data
            if (typeof data === 'string') return data
            if (data && typeof data === 'object' && 'message' in data) {
                const msg = (data as { message?: unknown }).message
                if (typeof msg === 'string') return msg
            }
        }
        return fallback
    }

    const filteredMarkers = useMemo(() => markers, [markers])
    const pagedMarkers = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE
        return filteredMarkers.slice(start, start + PAGE_SIZE)
    }, [filteredMarkers, page, PAGE_SIZE])

    const loadAll = useCallback(async () => {
        setLoading(true)
        try {
            const res = await axios.get<AdminMarker[]>('/api/admin/markers/all', { withCredentials: true })
            setMarkers(res.data || [])
            setError(null)
        } catch (e: unknown) {
            setError(getErrorMessage(e, '无法加载点位列表'))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadAll()
    }, [loadAll])

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredMarkers.length / PAGE_SIZE))
        if (page > maxPage) setPage(maxPage)
    }, [filteredMarkers.length, page, PAGE_SIZE])

    const openEditor = (marker: AdminMarker) => {
        setEditingId(marker.id)
        setDraft(toDraft(marker))
        setMarkImageFile(null)
    }

    const handleSave = async () => {
        if (!draft || !editingId) return
        try {
            const res = await axios.patch<AdminMarker>(
                `/api/admin/markers/${editingId}`,
                {
                    category: draft.category,
                    title: draft.title,
                    description: draft.description,
                    language: draft.language,
                    isPublic: draft.isPublic,
                    openTimeStart: draft.openTimeStart || '',
                    openTimeEnd: draft.openTimeEnd || '',
                },
                { withCredentials: true }
            )
            setMarkers((prev) => prev.map((m) => (m.id === editingId ? res.data : m)))
            setEditingId(null)
            setDraft(null)
        } catch (e: unknown) {
            setError(getErrorMessage(e, '保存失败'))
        }
    }

    const handleDelete = async () => {
        if (!editingId) return
        try {
            await axios.delete(`/api/admin/markers/${editingId}`, { withCredentials: true })
            setMarkers((prev) => prev.filter((m) => m.id !== editingId))
            setEditingId(null)
            setDraft(null)
        } catch (e: unknown) {
            setError(getErrorMessage(e, '删除失败'))
        }
    }

    return (
        <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, overflowX: 'hidden' }}>
            <Stack spacing={2} sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    管理后台 · 全量点位
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    所有点位均可在这里编辑或删除。
                </Typography>
                <AdminNav />
                <Divider />

                {loading ? (
                    <Stack alignItems="center" sx={{ py: 6 }}>
                        <CircularProgress />
                    </Stack>
                ) : error ? (
                    <Stack spacing={2}>
                        <Paper sx={{ p: 2, bgcolor: '#fff3f3', border: '1px solid #f5c2c2' }}>
                            <Typography color="error">{String(error)}</Typography>
                        </Paper>
                        {String(error).includes('二级密码') ? (
                            <Button variant="contained" onClick={() => navigate('/admin')} sx={adminContainedButtonSx}>
                                去管理入口验证二级密码
                            </Button>
                        ) : null}
                    </Stack>
                ) : (
                    <Stack spacing={2}>
                        {pagedMarkers.map((item) => (
                            <Paper key={item.id} sx={{ p: 2, borderRadius: 2 }}>
                                <Stack spacing={1.2}>
                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                            {item.title}
                                        </Typography>
                                        <Chip size="small" label={item.category} />
                                        <Chip size="small" label={`状态: ${item.reviewStatus ?? '未知'}`} />
                                        {item.lastEditedByOwner === false ? (
                                            <Chip size="small" color="warning" label="非本人编辑" />
                                        ) : null}
                                    </Stack>
                                    <Typography variant="body2" color="text.secondary">
                                        {item.description || '（无描述）'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        坐标：{item.lat.toFixed(6)}, {item.lng.toFixed(6)} ·
                                        提交者：{item.username}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        编辑人：{item.lastEditedBy || item.username}
                                        {item.lastEditedByOwner === false ? '（非本人编辑）' : ''}
                                    </Typography>
                                    {item.lastEditedByOwner === false ? (
                                        <Typography variant="caption" color="warning.main">
                                            审核备注：非本人编辑
                                        </Typography>
                                    ) : null}
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                        <Button variant="outlined" onClick={() => openEditor(item)} sx={adminOutlinedButtonSx}>
                                            编辑
                                        </Button>
                                        <Button variant="text" color="error" onClick={() => openEditor(item)}>
                                            删除
                                        </Button>
                                    </Stack>
                                </Stack>
                            </Paper>
                        ))}
                        {filteredMarkers.length > PAGE_SIZE ? (
                            <Pagination
                                count={Math.max(1, Math.ceil(filteredMarkers.length / PAGE_SIZE))}
                                page={page}
                                onChange={(_, p) => setPage(p)}
                                color="primary"
                                sx={adminPaginationSx}
                            />
                        ) : null}
                    </Stack>
                )}
            </Stack>

            <MarkerFormDialog
                open={Boolean(draft)}
                draft={draft}
                editingId={editingId}
                canDelete={true}
                categoryLabel={categoryLabel}
                markImageFile={markImageFile}
                setDraft={setDraft}
                onClose={() => {
                    setDraft(null)
                    setEditingId(null)
                }}
                onSave={handleSave}
                onDelete={handleDelete}
                onMarkImageChange={setMarkImageFile}
            />
        </Box>
    )
}
