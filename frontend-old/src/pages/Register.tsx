import { useState, type FormEvent } from 'react'
import axios from "axios";
import {useNavigate, Link as RouterLink} from "react-router-dom";
import {Alert, Button, TextField, Typography} from '@mui/material'
import {useAuth, type Me} from "../auth/AuthProvider.tsx";
import AuthPageShell from '../components/AuthPageShell'

type RegisterResponse = {
    code: number
    data?: Me | null
    message?: string
}

export default function Register() {
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

    const [registerForm, setRegisterForm] = useState({
        username: "",
        nickname: "",
        email: "",
        password: "",
        website: "",
    })
    const [errorMessage, setErrorMessage] = useState('')
    const [password2, setPassword2] = useState("")
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

    const handleRegister = async () => {
        setErrorMessage("");
        if (registerForm.password !== password2) {
            setErrorMessage("两次密码输入不一致");
            return;
        }
        try{
            const response = await axios.post<RegisterResponse>("/api/register", registerForm, {withCredentials: true});
            if (response.data.code === 0) {
                if (response.data.data) {
                    setUser(response.data.data);
                    void refresh();
                } else {
                    await refresh();
                }
                window.localStorage.setItem('onboarding.editProfileAfterRegister', '1')
                navigate('/');
            }
            else{
                setErrorMessage(response.data.message ?? "注册失败，请检查用户名和密码是否正确");
            }

            }
        catch(error: unknown){
            const errorMsg = getErrorMessage(error, "注册失败，请检查用户名和密码是否正确")
            setErrorMessage(errorMsg);
        }

    }

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        void handleRegister()
    }

    return (
        <AuthPageShell
            title="注册"
            onSubmit={handleSubmit}
            maxWidth={540}
            footer={
                <Typography variant="body2" sx={{ color: '#1d1b20', textAlign: 'center' }}>
                    已经有账号？ <RouterLink to="/login">去登录</RouterLink>
                </Typography>
            }
        >
                {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

                <input
                    type="text"
                    name="website"
                    value={registerForm.website}
                    onChange={(e) => setRegisterForm((prev) => ({...prev, website: e.target.value}))}
                    autoComplete="off"
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        left: '-10000px',
                        width: '1px',
                        height: '1px',
                        opacity: 0,
                        pointerEvents: 'none',
                    }}
                />

                <TextField
                    label="用户名"
                    value={registerForm.username}
                    onChange={(e) => setRegisterForm((prev) => ({...prev, username: e.target.value}))}
                    autoComplete="username"
                    sx={fieldSx}
                />

                <TextField
                    label="昵称"
                    value={registerForm.nickname}
                    onChange={(e) => setRegisterForm((prev) => ({...prev, nickname: e.target.value}))}
                    autoComplete="nickname"
                    sx={fieldSx}
                />

                <TextField
                    label="邮箱"
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm((prev) => ({...prev, email: e.target.value}))}
                    autoComplete="email"
                    sx={fieldSx}
                />

                <TextField
                    label="密码"
                    type="password"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm((prev) => ({...prev, password: e.target.value}))}
                    autoComplete="current-password"
                    sx={fieldSx}
                />

                <TextField
                    label="再次输入密码"
                    type="password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
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
                    注册
                </Button>
        </AuthPageShell>

    )
}
