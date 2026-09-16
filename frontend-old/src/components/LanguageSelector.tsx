import { IconButton, Tooltip } from '@mui/material'
import TranslateIcon from '@mui/icons-material/Translate'
import { useLanguage } from '../i18n/LanguageProvider'

export default function LanguageSelector() {
    const { language, setPreference, t } = useLanguage()
    const nextLanguage = language === 'zh' ? 'en' : 'zh'
    const label = t(nextLanguage === 'en' ? '切换到英文' : '切换到中文')

    return (
        <Tooltip title={label}>
            <IconButton aria-label={label}
                onClick={() => setPreference(nextLanguage)}
                sx={{ color: 'var(--ly-color-ink)', width: 44, height: 44, flexShrink: 0 }}>
                <TranslateIcon />
            </IconButton>
        </Tooltip>
    )
}
