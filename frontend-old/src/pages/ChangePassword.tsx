import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import axios from 'axios'

export default function ChangePassword() {
    const navigate = useNavigate()
    const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' })
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const fieldSx = {
        '& .MuiOutlinedInput-root': {
            borderRadius: 3,
        },
    }
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setSuccess('')
        if (!form.oldPassword || !form.newPassword) {
            setError('请填写完整')
            return
        }
        if (form.newPassword !== form.confirm) {
            setError('两次新密码不一致')
            return
        }

        try {
            const res = await axios.post(
                '/api/me/password',
                { oldPassword: form.oldPassword, newPassword: form.newPassword },
                { withCredentials: true }
            )
            if (res.data?.code === 0) {
                setSuccess('修改成功')
                setTimeout(() => navigate('/me'), 800)
            } else {
                setError(res.data?.message || '修改失败')
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e, '修改失败'))
        }
    }

    return (
        <Box
            sx={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                px: { xs: 1, md: 2 },
                py: { xs: 4, md: 7 },
            }}
        >
            <IconButton
                onClick={() => navigate('/me')}
                aria-label="back"
                sx={{
                    position: 'absolute',
                    top: { xs: 16, md: 20 },
                    left: { xs: 12, md: 20 },
                    color: '#744988',
                }}
            >
                <ArrowBackIcon />
            </IconButton>
            <Typography
                variant="h5"
                sx={{
                    fontWeight: 800,
                    fontSize: {xs: 32, md: 44},
                    py: 2,
                }}
            >
                修改密码
            </Typography>
            <Stack
                component="form"
                onSubmit={handleSubmit}
                spacing={3}
                sx={{
                    width: { xs: 320, md: 420 },
                    p: { xs: 2.5, md: 3 },
                    borderRadius: 4,
                    border: '1px solid rgba(116, 73, 136, 0.12)',
                    bgcolor: '#fff',
                    boxShadow: '0 12px 30px rgba(116, 73, 136, 0.08)',
                }}
            >

                {error && <Alert severity="error">{error}</Alert>}
                {success && <Alert severity="success">{success}</Alert>}

                <TextField
                    label="原密码"
                    type="password"
                    value={form.oldPassword}
                    onChange={(e) => setForm((s) => ({ ...s, oldPassword: e.target.value }))}
                    autoComplete="current-password"
                    sx={fieldSx}
                />
                <TextField
                    label="新密码"
                    type="password"
                    value={form.newPassword}
                    onChange={(e) => setForm((s) => ({ ...s, newPassword: e.target.value }))}
                    autoComplete="new-password"
                    sx={fieldSx}
                />
                <TextField
                    label="确认新密码"
                    type="password"
                    value={form.confirm}
                    onChange={(e) => setForm((s) => ({ ...s, confirm: e.target.value }))}
                    autoComplete="new-password"
                    sx={fieldSx}
                />
                <Button
                    disableElevation={true}
                    type="submit"
                    variant="contained"
                    sx={{
                        fontSize: {xs: 14, md: 17},
                        textTransform: 'none',
                        borderRadius: 999,
                        bgcolor: '#b784a7',
                        '&:hover': { bgcolor: '#b784a7', opacity: 0.9 },
                    }}
                    >
                    保存
                </Button>
            </Stack>
        </Box>
    )
}
