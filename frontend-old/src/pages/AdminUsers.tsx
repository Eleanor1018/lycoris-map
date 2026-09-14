import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    Pagination,
    Paper,
    Stack,
    TextField,
    Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import AdminNav from '../components/AdminNav'
import { adminContainedButtonSx, adminOutlinedButtonSx, adminPaginationSx } from '../styles/adminButtons'

type AdminUser = {
    id: number
    publicId?: string | null
    username: string
    nickname?: string | null
    email?: string | null
    role?: string | null
    deleted?: boolean
    deletedAt?: string | null
}

type AdminUserPage = {
    page: number
    size: number
    totalPages: number
    totalElements: number
    items: AdminUser[]
}

export default function AdminUsers() {
    const navigate = useNavigate()
    const PAGE_SIZE = 10
    const [qInput, setQInput] = useState('')
    const [query, setQuery] = useState('')
    const [page, setPage] = useState(1)
    const [result, setResult] = useState<AdminUserPage>({
        page: 0,
        size: PAGE_SIZE,
        totalPages: 0,
        totalElements: 0,
        items: [],
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

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

    const loadUsers = useCallback(async () => {
        try {
            setLoading(true)
            const res = await axios.get<AdminUserPage>('/api/admin/users', {
                params: { page: page - 1, size: PAGE_SIZE, q: query.trim() || undefined },
                withCredentials: true,
            })
            setResult(res.data)
            setError(null)
        } catch (e: unknown) {
            setError(getErrorMessage(e, '加载用户列表失败'))
        } finally {
            setLoading(false)
        }
    }, [page, query])

    useEffect(() => {
        void loadUsers()
    }, [loadUsers])

    const resetPassword = async (user: AdminUser) => {
        if (user.deleted) {
            setError('已删除用户不能重置密码')
            return
        }
        try {
            await axios.post(`/api/admin/users/${user.id}/reset-password`, null, { withCredentials: true })
            setError(null)
            alert(`已将用户 ${user.username} 重置为默认密码`)
        } catch (e: unknown) {
            setError(getErrorMessage(e, '重置密码失败'))
        }
    }

    const deleteUser = async (user: AdminUser) => {
        if (user.deleted) {
            setError('该用户已是删除状态')
            return
        }
        const ok = window.confirm(`确定删除用户 ${user.username} 吗？`)
        if (!ok) return
        try {
            await axios.delete(`/api/admin/users/${user.id}`, { withCredentials: true })
            if (result.items.length === 1 && page > 1) {
                setPage(page - 1)
            } else {
                void loadUsers()
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e, '删除用户失败'))
        }
    }

    const restoreUser = async (user: AdminUser) => {
        if (!user.deleted) {
            setError('该用户无需恢复')
            return
        }
        const ok = window.confirm(`确定恢复用户 ${user.username} 吗？`)
        if (!ok) return
        try {
            await axios.post(`/api/admin/users/${user.id}/restore`, null, { withCredentials: true })
            if (result.items.length === 1 && page > 1) {
                setPage(page - 1)
            } else {
                void loadUsers()
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e, '恢复用户失败'))
        }
    }

    const onSearch = () => {
        setPage(1)
        setQuery(qInput)
    }

    return (
        <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, overflowX: 'hidden' }}>
            <Stack spacing={2} sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    管理后台 · 用户管理
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    支持查询用户、删除用户、恢复用户、重置默认密码。
                </Typography>
                <AdminNav />
                <Divider />

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                        size="small"
                        label="搜索用户名/昵称/邮箱"
                        value={qInput}
                        onChange={(e) => setQInput(e.target.value)}
                        fullWidth
                    />
                    <Button variant="contained" onClick={onSearch} sx={adminContainedButtonSx}>
                        查询
                    </Button>
                </Stack>

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
                        {result.items.length === 0 ? (
                            <Paper sx={{ p: 2 }}>
                                <Typography color="text.secondary">没有找到用户</Typography>
                            </Paper>
                        ) : (
                            result.items.map((user) => (
                                <Paper key={user.id} sx={{ p: 2, borderRadius: 2 }}>
                                    <Stack spacing={1.2}>
                                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                {user.username}
                                            </Typography>
                                            <Chip size="small" label={user.role || 'USER'} />
                                            {user.deleted ? <Chip size="small" color="warning" label="已删除" /> : null}
                                        </Stack>
                                        <Typography variant="body2" color="text.secondary">
                                            昵称：{user.nickname || '（空）'}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            邮箱：{user.email || '（空）'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            ID：{user.id} · PublicID：{user.publicId || '（空）'}
                                        </Typography>
                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                            <Button
                                                variant="outlined"
                                                onClick={() => void resetPassword(user)}
                                                disabled={Boolean(user.deleted)}
                                                sx={adminOutlinedButtonSx}
                                            >
                                                重置默认密码
                                            </Button>
                                            <Button
                                                variant="text"
                                                color="error"
                                                onClick={() => void deleteUser(user)}
                                                disabled={Boolean(user.deleted)}
                                            >
                                                删除用户
                                            </Button>
                                            <Button
                                                variant="text"
                                                color="success"
                                                onClick={() => void restoreUser(user)}
                                                disabled={!user.deleted}
                                            >
                                                恢复用户
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </Paper>
                            ))
                        )}
                        <Pagination
                            count={Math.max(1, result.totalPages)}
                            page={Math.min(page, Math.max(1, result.totalPages))}
                            onChange={(_, p) => setPage(p)}
                            color="primary"
                            sx={adminPaginationSx}
                        />
                    </Stack>
                )}
            </Stack>
        </Box>
    )
}
