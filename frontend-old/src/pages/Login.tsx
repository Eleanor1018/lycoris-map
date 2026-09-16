import axios from 'axios'
import { useState, type FormEvent } from 'react'
import {useNavigate, Link as RouterLink} from "react-router-dom";
import { Alert, Button, TextField, Typography } from '@mui/material'
import {useAuth, type Me} from "../auth/AuthProvider.tsx";
import AuthPageShell from '../components/AuthPageShell'

type LoginResponse = {
    code: number
    data?: Me | null
    message?: string
}

export default function Login(){
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

    const [loginForm, setLoginForm] = useState({
        username: "",
        password: "",
    })
    const [errorMessage, setErrorMessage] = useState('');
    const navigate = useNavigate();
    const {refresh, setUser} = useAuth();
    const fieldSx = {
        '& .MuiOutlinedInput-root': {
            borderRadius: 999,
            bgcolor: 'rgba(255, 255, 255, 0.86)',
            '& fieldset': {
                borderColor: 'rgba(90, 56, 80, 0.22)',
            },
            '&:hover fieldset': {
                borderColor: 'rgba(90, 56, 80, 0.42)',
            },
            '&.Mui-focused fieldset': {
                borderColor: 'var(--ly-color-lilac)',
                borderWidth: 2,
            },
        },
        '& .MuiInputLabel-root.Mui-focused': {
            color: 'var(--ly-color-ink)',
        },
    }

    const handleLogin = async ( e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErrorMessage('');
        try{
            const response = await axios.post<LoginResponse>('/api/login', loginForm, {withCredentials: true});
            if (response.data.code === 0) {
                if (response.data.data) {
                    setUser(response.data.data);
                    void refresh();
                } else {
                    await refresh();
                }
                navigate('/');
            }
            else{
                setErrorMessage(response.data.message ?? 'login failed.');
            }
        }catch(err: unknown){
            const errorMSG = getErrorMessage(err, 'login failed.')
            setErrorMessage(errorMSG);
        }
    }

    return(
        <AuthPageShell
            title="登录"
            onSubmit={handleLogin}
            footer={
                <Typography variant="body2" sx={{ color: '#1d1b20', textAlign: 'center' }}>
                    没有账号？ <RouterLink to="/register">去注册</RouterLink>
                </Typography>
            }
        >
                {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

                <TextField
                    label="用户名或邮箱"
                    value={loginForm.username}
                    onChange={(e) => setLoginForm((prev) => ({...prev, username: e.target.value}))}
                    autoComplete="username"
                    sx={fieldSx}
                />

                <TextField
                    label="密码"
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((prev) => ({...prev, password: e.target.value}))}
                    autoComplete="current-password"
                    sx={fieldSx}
                />

                <Button
                    disableElevation={true}
                    type="submit"
                    variant="contained"
                    sx={{
                        height: 54,
                        fontSize: {xs: 17, md: 18},
                        fontWeight: 700,
                        textTransform: 'none',
                        borderRadius: 999,
                        border: '1px solid var(--ly-color-ink)',
                        bgcolor: 'var(--ly-color-lilac)',
                        color: 'var(--ly-color-ink)',
                        '&:hover': { bgcolor: '#c8afff' },
                    }}
                >
                    登录
                </Button>
        </AuthPageShell>

    )

}

