import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import DirectionsOutlinedIcon from '@mui/icons-material/DirectionsOutlined'
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined'
import { useLanguage } from '../i18n/LanguageProvider'

export default function MarkerActions({ id, lat, lng }: { id: number; lat: number; lng: number }) {
    const { language, t } = useLanguage()
    const [message, setMessage] = useState('')
    const [manualCopyOpen, setManualCopyOpen] = useState(false)
    // Do not put marker text or private metadata in a shared URL.
    const url = new URL('/maps', window.location.origin)
    url.searchParams.set('markerId', String(id))
    url.searchParams.set('lang', language)
    const shareUrl = url.toString()
    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl)
            setMessage(t('链接已复制'))
            setManualCopyOpen(false)
        } catch {
            setMessage('')
            setManualCopyOpen(true)
        }
    }
    const share = async () => {
        if (!navigator.share) { await copyLink(); return }
        try {
            await navigator.share({ title: 'Lycoris', url: shareUrl })
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            await copyLink()
        }
    }
    return <>
        <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
            <Button component="a" size="small" variant="outlined" target="_blank" rel="noopener noreferrer"
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=walking`}
                startIcon={<DirectionsOutlinedIcon />} sx={{ borderRadius: 999, textTransform: 'none' }}>{t('导航')}</Button>
            <Button size="small" variant="outlined" startIcon={<ShareOutlinedIcon />} onClick={() => void share()}
                sx={{ borderRadius: 999, textTransform: 'none' }}>{t('分享')}</Button>
        </Stack>
        {message && <Alert severity="success" sx={{ mt: 1 }} onClose={() => setMessage('')}>{message}</Alert>}
        <Dialog open={manualCopyOpen} onClose={() => setManualCopyOpen(false)} fullWidth maxWidth="sm">
            <DialogTitle>{t('复制链接')}</DialogTitle>
            <DialogContent>
                <Alert severity="info" sx={{ mb: 2 }}>{t('无法复制链接，请手动复制。')}</Alert>
                <TextField fullWidth value={shareUrl} label={t('复制链接')} slotProps={{ input: { readOnly: true } }}
                    onFocus={(event) => event.target.select()} />
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setManualCopyOpen(false)}>{t('取消')}</Button>
                <Button onClick={() => void copyLink()}>{t('复制链接')}</Button>
            </DialogActions>
        </Dialog>
    </>
}
