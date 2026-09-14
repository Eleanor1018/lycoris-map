import { useLanguage } from '../i18n/LanguageProvider'
import {
    Alert,
    Button,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import imageCompression from 'browser-image-compression'
import type { Language } from '../i18n/LanguageProvider'
import type { MarkerCategory } from '../types/marker'

export type DraftMarker = {
    tempId: string
    lat: number
    lng: number
    category: MarkerCategory
    title: string
    description: string
    isPublic: boolean
    openTimeStart: string
    openTimeEnd: string
    markImage?: string
    language: Language
    contentLanguage?: Language
    originalTitle?: string
    originalDescription?: string
}

type Props = {
    open: boolean
    draft: DraftMarker | null
    editingId: number | null
    canDelete?: boolean
    categoryLabel: Record<string, string>
    markImageFile: File | null
    setDraft: React.Dispatch<React.SetStateAction<DraftMarker | null>>
    onClose: () => void
    onSave: () => void
    onDelete: () => void
    onMarkImageChange: (file: File | null) => void
    canUploadImage?: boolean
    saving?: boolean
    saveLabel?: string
}

export default function MarkerFormDialog({
    open,
    draft,
    editingId,
    canDelete = true,
    categoryLabel,
    markImageFile,
    setDraft,
    onClose,
    onSave,
    onDelete,
    onMarkImageChange,
    canUploadImage = true,
    saving = false,
    saveLabel,
}: Props) {
    const { language, t } = useLanguage()
    const [imageError, setImageError] = useState('')
    const [imageHint, setImageHint] = useState('')
    const [processingImage, setProcessingImage] = useState(false)
    const [startHourInput, setStartHourInput] = useState('')
    const [startMinuteInput, setStartMinuteInput] = useState('')
    const [endHourInput, setEndHourInput] = useState('')
    const [endMinuteInput, setEndMinuteInput] = useState('')
    const saveDisabled = saving || processingImage
    const displayedSaveLabel = processingImage ? t("处理图片中...") : saveLabel ?? t("保存")

    useEffect(() => {
        if (!open) {
            setImageError('')
            setImageHint('')
            setProcessingImage(false)
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        const start = splitTime(draft?.openTimeStart)
        const end = splitTime(draft?.openTimeEnd)
        setStartHourInput(start.hour)
        setStartMinuteInput(start.minute)
        setEndHourInput(end.hour)
        setEndMinuteInput(end.minute)
    }, [open, draft?.tempId, draft?.openTimeStart, draft?.openTimeEnd])

    const fieldSx = {
        '& .MuiInputLabel-root': {
            color: 'rgba(90, 56, 80, 0.68)',
            fontWeight: 600,
        },
        '& .MuiInputLabel-root.Mui-focused': {
            color: 'var(--ly-color-ink)',
        },
        '& .MuiOutlinedInput-root': {
            borderRadius: '18px',
            bgcolor: 'rgba(255, 255, 255, 0.78)',
            color: 'var(--ly-color-ink)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.72)',
            backdropFilter: 'blur(10px)',
            transition: 'border-color 160ms ease, box-shadow 160ms ease, background 160ms ease',
            '& fieldset': {
                borderColor: 'rgba(90, 56, 80, 0.16)',
            },
            '&:hover fieldset': {
                borderColor: 'rgba(236, 167, 206, 0.72)',
            },
            '&.Mui-focused': {
                bgcolor: 'rgba(255, 255, 255, 0.92)',
                boxShadow: '0 0 0 4px rgba(208, 188, 255, 0.26)',
            },
            '&.Mui-focused fieldset': {
                borderColor: 'var(--ly-color-lilac)',
                borderWidth: 1.5,
            },
        },
    }
    const MAX_MARKER_IMAGE_SIZE = 5 * 1024 * 1024

    const splitTime = (value?: string) => {
        if (!value || !/^\d{2}:\d{2}$/.test(value)) return { hour: '', minute: '' }
        const [hour, minute] = value.split(':')
        return { hour, minute }
    }

    const normalizePart = (value: string, max: number) => {
        if (!value) return ''
        const digits = value.replace(/\D/g, '').slice(0, 2)
        if (!digits) return ''
        const n = Number(digits)
        if (!Number.isFinite(n)) return ''
        return String(Math.max(0, Math.min(max, n))).padStart(2, '0')
    }

    const commitTime = (
        key: 'openTimeStart' | 'openTimeEnd',
        hour: string,
        minute: string
    ) => {
        setDraft((d) => {
            if (!d) return d
            return { ...d, [key]: hour.length === 2 && minute.length === 2 ? `${hour}:${minute}` : '' }
        })
    }

    const handlePartChange = (
        key: 'openTimeStart' | 'openTimeEnd',
        part: 'hour' | 'minute',
        rawValue: string
    ) => {
        const digits = rawValue.replace(/\D/g, '').slice(0, 2)
        if (key === 'openTimeStart') {
            if (part === 'hour') {
                setStartHourInput(digits)
                commitTime(key, digits, startMinuteInput)
            } else {
                setStartMinuteInput(digits)
                commitTime(key, startHourInput, digits)
            }
        } else {
            if (part === 'hour') {
                setEndHourInput(digits)
                commitTime(key, digits, endMinuteInput)
            } else {
                setEndMinuteInput(digits)
                commitTime(key, endHourInput, digits)
            }
        }
    }

    const handlePartBlur = (
        key: 'openTimeStart' | 'openTimeEnd',
        part: 'hour' | 'minute',
        rawValue: string
    ) => {
        const normalized = normalizePart(rawValue, part === 'hour' ? 23 : 59)
        if (key === 'openTimeStart') {
            if (part === 'hour') {
                setStartHourInput(normalized)
                commitTime(key, normalized, startMinuteInput)
            } else {
                setStartMinuteInput(normalized)
                commitTime(key, startHourInput, normalized)
            }
        } else {
            if (part === 'hour') {
                setEndHourInput(normalized)
                commitTime(key, normalized, endMinuteInput)
            } else {
                setEndMinuteInput(normalized)
                commitTime(key, endHourInput, normalized)
            }
        }
    }

    return (
        <Dialog
            open={open}
            onClose={saving ? undefined : onClose}
            maxWidth="sm"
            fullWidth
            disableScrollLock
            slotProps={{
                backdrop: {
                    sx: {
                        bgcolor: 'rgba(90, 56, 80, 0.16)',
                        backdropFilter: 'blur(5px)',
                    },
                },
            }}
            PaperProps={{
                sx: {
                    borderRadius: '28px',
                    border: '1px solid rgba(236, 167, 206, 0.56)',
                    color: 'var(--ly-color-ink)',
                    background: '#fff',
                    boxShadow: '0 26px 70px rgba(90, 56, 80, 0.22), 0 8px 24px rgba(236, 167, 206, 0.22)',
                    overflow: 'hidden',
                    touchAction: { xs: 'pan-y', sm: 'auto' },
                    overscrollBehavior: 'contain',
                },
            }}
        >
            <DialogTitle
                sx={{
                    fontWeight: 800,
                    textAlign: 'center',
                    fontSize: { xs: 22, md: 26 },
                    color: 'var(--ly-color-ink)',
                    pt: { xs: 3, md: 3.5 },
                    pb: 1,
                    letterSpacing: '-0.02em',
                    background:
                        'radial-gradient(circle at 50% 0%, rgba(252, 221, 236, 0.8), rgba(252, 221, 236, 0) 58%)',
                }}
            >
                {editingId ? t("编辑点位") : t("新增点位")}
            </DialogTitle>
            <DialogContent
                sx={{
                    px: { xs: 2.5, md: 4 },
                    pb: { xs: 3, md: 3.5 },
                    overscrollBehavior: 'contain',
                    WebkitOverflowScrolling: 'touch',
                }}
            >
                <Typography
                    variant="body2"
                    sx={{
                        color: 'rgba(90, 56, 80, 0.68)',
                        mt: 0.5,
                        textAlign: 'center',
                        fontWeight: 600,
                    }}
                >
                    {draft ? `${draft.lat.toFixed(6)}, ${draft.lng.toFixed(6)}` : ''}
                </Typography>

                <Divider sx={{ my: 1.8, borderColor: 'rgba(236, 167, 206, 0.34)' }} />

                <Stack spacing={2}>
                    <Alert severity="info">
                        <Typography variant="body2" fontWeight={700}>
                            {t('编写语言：{language}', { language: t((draft?.language ?? language) === 'en' ? '英文' : '中文') })}
                        </Typography>
                        {t('标题和描述将保存为当前语言，其他语言内容会保留。')}
                        {draft?.contentLanguage && draft.contentLanguage !== language &&
                            <Typography variant="body2">{t('请将原文翻译为当前语言后保存。')}</Typography>}
                    </Alert>
                    <FormControl fullWidth>
                        <InputLabel id="cat-label">{t("类别")}</InputLabel>
                        <Select
                            labelId="cat-label"
                            label={t("类别")}
                            value={draft?.category ?? 'accessible_toilet'}
                            disabled={saving}
                            sx={fieldSx}
                            onChange={(e) =>
                                setDraft((d) => (d ? { ...d, category: e.target.value as MarkerCategory } : d))
                            }
                        >
                            {Object.entries(categoryLabel).map(([k, v]) => (
                                <MenuItem key={k} value={k}>
                                    {v}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <TextField
                        label={t("标题")}
                        value={draft?.title ?? ''}
                        disabled={saving}
                        onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                        placeholder={t("例如：地铁站A口无障碍卫生间")}
                        fullWidth
                        sx={fieldSx}
                    />

                    <TextField
                        label={t("描述")}
                        value={draft?.description ?? ''}
                        disabled={saving}
                        onChange={(e) => setDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                        placeholder={t("例如：入口在XX旁边，晚上关闭时间…")}
                        fullWidth
                        multiline
                        minRows={4}
                        sx={fieldSx}
                    />

                    <Button
                        variant="outlined"
                        component="label"
                        disabled={!canUploadImage || saving}
                        sx={{
                            borderRadius: 999,
                            textTransform: 'none',
                            py: 1.15,
                            borderColor: 'rgba(208, 188, 255, 0.85)',
                            bgcolor: 'rgba(208, 188, 255, 0.28)',
                            color: 'var(--ly-color-ink)',
                            fontWeight: 700,
                            boxShadow: '0 10px 22px rgba(208, 188, 255, 0.2)',
                            '&:hover': {
                                borderColor: 'rgba(236, 167, 206, 0.92)',
                                bgcolor: 'rgba(252, 221, 236, 0.48)',
                            },
                            '&.Mui-disabled': {
                                color: 'rgba(90, 56, 80, 0.42)',
                                borderColor: 'rgba(90, 56, 80, 0.12)',
                                bgcolor: 'rgba(255, 255, 255, 0.44)',
                            },
                        }}
                    >
                        {canUploadImage ? t("选择图片（可选）") : t("仅创建者可上传图片")}
                            <input
                                type="file"
                                accept="image/*"
                                hidden
                                disabled={!canUploadImage || saving}
                                onChange={async (e) => {
                                    const f = e.target.files?.[0] ?? null
                                    if (!f) {
                                        setImageError('')
                                        setImageHint('')
                                        setProcessingImage(false)
                                        onMarkImageChange(null)
                                        return
                                    }

                                    setImageError('')
                                    setImageHint('')
                                    setProcessingImage(true)

                                    try {
                                        let nextFile = f
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
                                            nextFile = new File([converted], safeName, { type: 'image/jpeg' })
                                        }

                                        if (nextFile.size > MAX_MARKER_IMAGE_SIZE) {
                                            const compressed = await imageCompression(nextFile, {
                                                maxSizeMB: 3,
                                                maxWidthOrHeight: 2048,
                                                useWebWorker: true,
                                                initialQuality: 0.85,
                                            })
                                            nextFile = new File([compressed], nextFile.name, {
                                                type: compressed.type || nextFile.type,
                                            })
                                        }

                                        if (nextFile.size > MAX_MARKER_IMAGE_SIZE) {
                                            throw new Error(t("图片处理后仍超过 5MB"))
                                        }

                                        if (nextFile !== f) {
                                            setImageHint(
                                                t("已自动处理图片（{0}MB → {1}MB）", { 0: (f.size / 1024 / 1024).toFixed(2), 1: (nextFile.size / 1024 / 1024).toFixed(2) })
                                            )
                                        }

                                        onMarkImageChange(nextFile)
                                    } catch (err: unknown) {
                                        const message = err instanceof Error ? err.message : t("图片处理失败，请换一张图片试试")
                                        setImageError(message)
                                        onMarkImageChange(null)
                                        e.currentTarget.value = ''
                                    } finally {
                                        setProcessingImage(false)
                                    }
                                }}
                            />
                        </Button>
                    {processingImage ? (
                        <Alert
                            severity="info"
                            icon={<CircularProgress size={16} color="inherit" />}
                            sx={{ borderRadius: 2 }}
                        >
                            {t("正在处理图片，请稍候...")}</Alert>
                    ) : null}
                    {imageHint ? (
                        <Alert severity="success" sx={{ borderRadius: 2 }}>
                            {imageHint}
                        </Alert>
                    ) : null}
                    {imageError ? (
                        <Alert severity="warning" sx={{ borderRadius: 2 }}>
                            {imageError}
                        </Alert>
                    ) : null}
                    {markImageFile ? (
                        <Typography variant="body2" sx={{ opacity: 0.7 }}>
                            {t("已选择：")}{markImageFile.name}
                        </Typography>
                    ) : null}

                    <FormControlLabel
                        control={
                            <Switch
                                checked={Boolean(draft?.isPublic)}
                                disabled={saving}
                                sx={{
                                    '& .MuiSwitch-switchBase.Mui-checked': {
                                        color: 'var(--ly-color-lilac)',
                                        '& + .MuiSwitch-track': {
                                            bgcolor: 'rgba(208, 188, 255, 0.72)',
                                        },
                                    },
                                    '& .MuiSwitch-track': {
                                        bgcolor: 'rgba(90, 56, 80, 0.24)',
                                    },
                                }}
                                onChange={(e) =>
                                    setDraft((d) => (d ? { ...d, isPublic: e.target.checked } : d))
                                }
                            />
                        }
                        label={t("公开共享")}
                    />

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2} alignItems="stretch">
                        <Stack spacing={1} sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {t("可用开始时间")}</Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <TextField
                                    label={t("时")}
                                    value={startHourInput}
                                    disabled={saving}
                                    onChange={(e) => handlePartChange('openTimeStart', 'hour', e.target.value)}
                                    onBlur={(e) => handlePartBlur('openTimeStart', 'hour', e.target.value)}
                                    inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 2 }}
                                    placeholder="00"
                                    sx={{ ...fieldSx, width: 90 }}
                                />
                                <Typography sx={{ opacity: 0.7 }}>:</Typography>
                                <TextField
                                    label={t("分")}
                                    value={startMinuteInput}
                                    disabled={saving}
                                    onChange={(e) => handlePartChange('openTimeStart', 'minute', e.target.value)}
                                    onBlur={(e) => handlePartBlur('openTimeStart', 'minute', e.target.value)}
                                    inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 2 }}
                                    placeholder="00"
                                    sx={{ ...fieldSx, width: 90 }}
                                />
                            </Stack>
                        </Stack>

                        <Stack spacing={1} sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {t("可用结束时间")}</Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <TextField
                                    label={t("时")}
                                    value={endHourInput}
                                    disabled={saving}
                                    onChange={(e) => handlePartChange('openTimeEnd', 'hour', e.target.value)}
                                    onBlur={(e) => handlePartBlur('openTimeEnd', 'hour', e.target.value)}
                                    inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 2 }}
                                    placeholder="00"
                                    sx={{ ...fieldSx, width: 90 }}
                                />
                                <Typography sx={{ opacity: 0.7 }}>:</Typography>
                                <TextField
                                    label={t("分")}
                                    value={endMinuteInput}
                                    disabled={saving}
                                    onChange={(e) => handlePartChange('openTimeEnd', 'minute', e.target.value)}
                                    onBlur={(e) => handlePartBlur('openTimeEnd', 'minute', e.target.value)}
                                    inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 2 }}
                                    placeholder="00"
                                    sx={{ ...fieldSx, width: 90 }}
                                />
                            </Stack>
                        </Stack>
                    </Stack>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {t("两项都留空表示全天可用；若填写需同时填写开始和结束时间（每日重复）。")}</Typography>

                    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 0.5 }}>
                        <Button
                            onClick={onClose}
                            disabled={saving}
                            sx={{
                                borderRadius: 999,
                                textTransform: 'none',
                                color: 'rgba(90, 56, 80, 0.76)',
                                fontWeight: 700,
                                '&:hover': { bgcolor: 'rgba(252, 221, 236, 0.38)' },
                            }}
                        >
                            {t("取消")}</Button>
                        {editingId && canDelete ? (
                            <Button
                                color="error"
                                onClick={onDelete}
                                disabled={saving}
                                sx={{
                                    borderRadius: 999,
                                    textTransform: 'none',
                                    fontWeight: 700,
                                    bgcolor: 'rgba(255, 235, 238, 0.84)',
                                    '&:hover': { bgcolor: 'rgba(255, 205, 210, 0.86)' },
                                }}
                            >
                                {t("删除")}</Button>
                        ) : null}
                        <Button
                            variant="contained"
                            onClick={onSave}
                            disabled={saveDisabled}
                            sx={{
                                borderRadius: 999,
                                textTransform: 'none',
                                color: 'var(--ly-color-ink)',
                                bgcolor: 'var(--ly-color-lilac)',
                                fontWeight: 800,
                                boxShadow: '0 12px 24px rgba(208, 188, 255, 0.36)',
                                '&:hover': { bgcolor: '#c8afff', boxShadow: '0 14px 28px rgba(208, 188, 255, 0.44)' },
                            }}
                        >
                            {saveDisabled ? displayedSaveLabel : t("保存")}
                        </Button>
                    </Stack>
                </Stack>
            </DialogContent>
        </Dialog>
    )
}
