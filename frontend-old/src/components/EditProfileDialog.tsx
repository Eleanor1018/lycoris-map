import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogContent,
    Stack,
    TextField,
    Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import imageCompression from 'browser-image-compression'

const MAX_AVATAR_SIZE = 5 * 1024 * 1024
const COMPRESSED_TARGET_MB = 2

type EditProfileDialogProps = {
    open: boolean
    nickname: string
    pronouns: string
    signature: string
    avatarFile: File | null
    onNicknameChange: (value: string) => void
    onPronounsChange: (value: string) => void
    onSignatureChange: (value: string) => void
    onAvatarChange: (file: File | null) => void
    onClose: () => void
    onSave: () => Promise<void>
}

export default function EditProfileDialog({
    open,
    nickname,
    pronouns,
    signature,
    avatarFile,
    onNicknameChange,
    onPronounsChange,
    onSignatureChange,
    onAvatarChange,
    onClose,
    onSave,
}: EditProfileDialogProps) {
    const [avatarError, setAvatarError] = useState('')
    const [avatarHint, setAvatarHint] = useState('')
    const [isCompressing, setIsCompressing] = useState(false)
    useEffect(() => {
        if (!open) {
            setAvatarError('')
            setAvatarHint('')
            setIsCompressing(false)
        }
    }, [open])
    const fieldSx = {
        '& .MuiOutlinedInput-root': {
            borderRadius: 3,
        },
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 4 } }}>
            <DialogContent sx={{ px: { xs: 2.5, md: 4 }, py: 2.5 }}>
                <Stack spacing={2.5}>
                    <Typography
                        variant="h5"
                        sx={{
                            textAlign: 'center',
                            fontWeight: 800,
                            fontSize: { xs: 30, md: 34 },
                            py: 0.5,
                        }}
                    >
                        编辑资料
                    </Typography>

                    <TextField
                        label="昵称"
                        value={nickname}
                        onChange={(e) => onNicknameChange(e.target.value)}
                        fullWidth
                        sx={fieldSx}
                    />

                    <TextField
                        label="称谓（Pronouns）"
                        value={pronouns}
                        onChange={(e) => onPronounsChange(e.target.value)}
                        placeholder="例如 she/her"
                        fullWidth
                        sx={fieldSx}
                    />

                    <TextField
                        label="个性签名"
                        value={signature}
                        onChange={(e) => onSignatureChange(e.target.value)}
                        placeholder="写一点想展示的话"
                        fullWidth
                        multiline
                        minRows={2}
                        sx={fieldSx}
                    />

                    <Box>
                        <Button
                            variant="outlined"
                            component="label"
                            sx={{
                                borderRadius: 999,
                                textTransform: 'none',
                                borderColor: 'rgba(116, 73, 136, 0.5)',
                                color: '#744988',
                            }}
                        >
                            选择头像
                            <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={async (e) => {
                                    const f = e.target.files?.[0] ?? null
                                    if (!f) {
                                        setAvatarError('')
                                        setAvatarHint('')
                                        setIsCompressing(false)
                                        onAvatarChange(null)
                                        return
                                    }

                                    let finalFile = f
                                    setAvatarError('')
                                    setAvatarHint('')
                                    setIsCompressing(true)

                                    try {
                                        const lowerName = f.name.toLowerCase()
                                        const isHeicLike =
                                            f.type === 'image/heic' ||
                                            f.type === 'image/heif' ||
                                            lowerName.endsWith('.heic') ||
                                            lowerName.endsWith('.heif')

                                        if (isHeicLike) {
                                            const { default: heic2any } = await import('heic2any')
                                            const blob = await heic2any({
                                                blob: f,
                                                toType: 'image/jpeg',
                                                quality: 0.92,
                                            })
                                            const converted = Array.isArray(blob) ? blob[0] : blob
                                            const safeName = f.name.replace(/\.(heic|heif)$/i, '.jpg')
                                            finalFile = new File([converted], safeName, { type: 'image/jpeg' })
                                            setAvatarHint('已自动将 HEIC 转换为 JPG')
                                        }
                                    } catch {
                                        setAvatarError('HEIC 图片转换失败，请换一张图片试试。')
                                        onAvatarChange(null)
                                        e.currentTarget.value = ''
                                        setIsCompressing(false)
                                        return
                                    }

                                    if (finalFile.size > MAX_AVATAR_SIZE) {
                                        try {
                                            const compressed = await imageCompression(finalFile, {
                                                maxSizeMB: COMPRESSED_TARGET_MB,
                                                maxWidthOrHeight: 2048,
                                                useWebWorker: true,
                                                initialQuality: 0.85,
                                            })
                                            finalFile = new File([compressed], finalFile.name, {
                                                type: compressed.type || finalFile.type,
                                            })
                                            setAvatarHint(`已自动压缩头像（${(f.size / 1024 / 1024).toFixed(2)}MB → ${(finalFile.size / 1024 / 1024).toFixed(2)}MB）`)
                                        } catch {
                                            setAvatarError('头像压缩失败，请尝试更小的图片。')
                                            onAvatarChange(null)
                                            e.currentTarget.value = ''
                                            setIsCompressing(false)
                                            return
                                        }
                                    }

                                    if (finalFile.size > MAX_AVATAR_SIZE) {
                                        setAvatarError('压缩后仍超过 5MB，请换一张更小的图片。')
                                        onAvatarChange(null)
                                        e.currentTarget.value = ''
                                        setIsCompressing(false)
                                        return
                                    }

                                    onAvatarChange(finalFile)
                                    setIsCompressing(false)
                                }}
                            />
                        </Button>
                        {isCompressing ? (
                            <Alert
                                severity="info"
                                icon={<CircularProgress size={16} color="inherit" />}
                                sx={{ mt: 1, borderRadius: 2 }}
                            >
                                正在压缩头像，请稍候...
                            </Alert>
                        ) : null}
                        {avatarHint ? (
                            <Alert severity="success" sx={{ mt: 1, borderRadius: 2 }}>
                                {avatarHint}
                            </Alert>
                        ) : null}
                        {avatarError ? (
                            <Alert severity="warning" sx={{ mt: 1, borderRadius: 2 }}>
                                {avatarError}
                            </Alert>
                        ) : null}
                        {avatarFile ? (
                            <Alert severity="info" sx={{ mt: 1, borderRadius: 2 }}>
                                已选择：{avatarFile.name}
                            </Alert>
                        ) : null}
                    </Box>

                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button onClick={onClose} disabled={isCompressing} sx={{ borderRadius: 999, textTransform: 'none' }}>
                            取消
                        </Button>
                        <Button
                            variant="contained"
                            onClick={onSave}
                            disabled={isCompressing}
                            sx={{
                                borderRadius: 999,
                                textTransform: 'none',
                                bgcolor: '#b784a7',
                                '&:hover': { bgcolor: '#b784a7', opacity: 0.9 },
                            }}
                        >
                            保存
                        </Button>
                    </Stack>
                </Stack>
            </DialogContent>
        </Dialog>
    )
}
