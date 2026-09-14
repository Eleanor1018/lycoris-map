import { useState } from 'react'
import axios from 'axios'
import { Box, Button, Divider, Paper, Stack, TextField, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import AdminNav from '../components/AdminNav'
import { adminContainedButtonSx, adminOutlinedButtonSx } from '../styles/adminButtons'

export default function AdminEntry() {
    const navigate = useNavigate()
    const [passcode, setPasscode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

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

    const handleVerify = async () => {
        if (!passcode.trim()) {
            setError('请输入二级密码')
            return
        }
        try {
            setLoading(true)
            await axios.post('/api/admin/verify', { passcode }, { withCredentials: true })
            setError(null)
            navigate('/admin/review')
        } catch (e: unknown) {
            setError(getErrorMessage(e, '二级密码验证失败'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 4 }, overflowX: 'hidden' }}>
            <Stack spacing={2} sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    管理后台入口
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    如果二级验证已开启，请先在这里验证；临时停用时，管理员账号可直接进入后台页面。
                </Typography>
                <AdminNav />
                <Divider />

                <Paper sx={{ p: 2, borderRadius: 2 }}>
                    <Stack spacing={2}>
                        <TextField
                            type="password"
                            label="二级密码"
                            value={passcode}
                            onChange={(e) => setPasscode(e.target.value)}
                            fullWidth
                        />
                        {error ? (
                            <Typography color="error" variant="body2">
                                {error}
                            </Typography>
                        ) : null}
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Button variant="contained" onClick={() => void handleVerify()} disabled={loading} sx={{ ...adminContainedButtonSx, width: { xs: '100%', sm: 'auto' } }}>
                                {loading ? '验证中...' : '验证并进入审核中心'}
                            </Button>
                            <Button variant="outlined" onClick={() => navigate('/admin/review')} sx={{ ...adminOutlinedButtonSx, width: { xs: '100%', sm: 'auto' } }}>
                                直接去审核中心
                            </Button>
                            <Button variant="outlined" onClick={() => navigate('/admin/all')} sx={{ ...adminOutlinedButtonSx, width: { xs: '100%', sm: 'auto' } }}>
                                直接去全量点位
                            </Button>
                            <Button variant="outlined" onClick={() => navigate('/admin/usr')} sx={{ ...adminOutlinedButtonSx, width: { xs: '100%', sm: 'auto' } }}>
                                直接去用户管理
                            </Button>
                        </Stack>
                    </Stack>
                </Paper>
            </Stack>
        </Box>
    )
}
