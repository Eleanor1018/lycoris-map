import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import axios from 'axios'
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    MenuItem,
    Select,
    Skeleton,
    TextField,
} from '@mui/material'
import ExploreOutlined from '@mui/icons-material/ExploreOutlined'
import DirectionsOutlined from '@mui/icons-material/DirectionsOutlined'
import ArrowOutward from '@mui/icons-material/ArrowOutward'
import PhotoOutlined from '@mui/icons-material/PhotoOutlined'
import Close from '@mui/icons-material/Close'
import AccessibleForward from '@mui/icons-material/AccessibleForward'
import LocalHospitalOutlined from '@mui/icons-material/LocalHospitalOutlined'
import BabyChangingStation from '@mui/icons-material/BabyChangingStation'
import PlaceOutlined from '@mui/icons-material/PlaceOutlined'
import { useLanguage } from '../i18n/LanguageProvider'
import { toBackendAssetUrl } from '../config/runtime'
import {
    CATEGORIES,
    filterDiscover,
    formatDistance,
    parseSavedOrigin,
} from '../lib/discover'
import type {
    Coordinates,
    DiscoverCategory,
    DiscoverMarker,
    DiscoverResult,
} from '../lib/discover'
import '../styles/discover.css'

const categoryLabels: Record<DiscoverCategory, string> = {
    all: '全部',
    accessible_toilet: '无障碍卫生间',
    friendly_clinic: '友好医疗机构',
    baby_room: '母婴室',
    self_definition: '自定义',
}
const radii = [1000, 3000, 5000, 10000, 50000]
const noMarkers: DiscoverMarker[] = []
function initialOrigin(): Coordinates {
    try {
        const saved = parseSavedOrigin(localStorage.getItem('map.lastView'))
        if (saved) return saved
    } catch {
        /* Browsing remains available without storage. */
    }
    return { lat: 39.9042, lng: 116.4074 }
}
function CategoryIcon({ category }: { category: DiscoverCategory }) {
    switch (category) {
        case 'accessible_toilet':
            return <AccessibleForward />
        case 'friendly_clinic':
            return <LocalHospitalOutlined />
        case 'baby_room':
            return <BabyChangingStation />
        case 'self_definition':
            return <PlaceOutlined />
        default:
            return <ExploreOutlined />
    }
}
function PlacePhoto({
    marker,
    onOpen,
}: {
    marker: DiscoverResult
    onOpen: (marker: DiscoverResult) => void
}) {
    const { t } = useLanguage()
    const url = toBackendAssetUrl(marker.markImage?.trim())
    const [failedUrl, setFailedUrl] = useState<string>()
    return url && url !== failedUrl ? (
        <button
            className="discover-photo"
            onClick={() => onOpen(marker)}
            aria-label={t('查看{0}的照片', { 0: marker.title })}
        >
            <img
                src={url}
                alt={marker.title}
                loading="lazy"
                onError={() => setFailedUrl(url)}
            />
            <span className="discover-photo-label">
                <PhotoOutlined fontSize="small" />
                {t('查看照片')}
            </span>
        </button>
    ) : (
        <div
            className="discover-photo discover-photo-empty"
            role="img"
            aria-label={t('暂无照片')}
        >
            <CategoryIcon category={marker.category} />
            <span>{t('暂无照片')}</span>
        </div>
    )
}

export default function Discover() {
    const { language, t } = useLanguage()
    const [origin] = useState(initialOrigin)
    const [category, setCategory] = useState<DiscoverCategory>('all')
    const [radius, setRadius] = useState(5000)
    const [query, setQuery] = useState('')
    const [response, setResponse] = useState<{
        key: string
        markers: DiscoverMarker[]
        error: boolean
    }>({ key: '', markers: [], error: false })
    const [retry, setRetry] = useState(0)
    const [photo, setPhoto] = useState<DiscoverResult | null>(null)
    const requestKey = `${origin.lat}:${origin.lng}:${category}:${radius}:${language}:${retry}`
    const loading = response.key !== requestKey
    const error = !loading && response.error
    const markers = loading ? noMarkers : response.markers
    useEffect(() => {
        const controller = new AbortController()
        let active = true
        const selected = category === 'all' ? CATEGORIES : [category]
        void Promise.all(
            selected.map(async (item) => {
                const response = await axios.get<DiscoverMarker[]>(
                    '/api/markers/nearby',
                    {
                        params: {
                            lat: origin.lat,
                            lng: origin.lng,
                            category: item,
                            radius,
                            lang: language,
                        },
                        signal: controller.signal,
                        withCredentials: true,
                        timeout: 12000,
                    }
                )
                if (!Array.isArray(response.data))
                    throw new Error('Invalid places response')
                return response.data
            })
        )
            .then((groups) => {
                if (active)
                    setResponse({
                        key: requestKey,
                        markers: groups.flat(),
                        error: false,
                    })
            })
            .catch((reason: unknown) => {
                if (active && !axios.isCancel(reason))
                    setResponse({ key: requestKey, markers: [], error: true })
            })
        return () => {
            active = false
            controller.abort()
        }
    }, [origin.lat, origin.lng, category, radius, language, requestKey])

    const results = useMemo(
        () =>
            filterDiscover(markers, origin, {
                radius,
                category,
                photosOnly: false,
                query,
            }),
        [markers, origin, radius, category, query]
    )
    const reset = () => {
        setCategory('all')
        setRadius(5000)
        setQuery('')
    }
    return (
        <section className="discover-page">
            <div className="discover-results-heading">
                <h1>{t('附近点位')}</h1>
                <div className="discover-controls">
                    <TextField
                        className="discover-search"
                        size="small"
                        label={t('在结果中搜索')}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <FormControl className="discover-category" size="small">
                        <Select
                            value={category}
                            onChange={(event) =>
                                setCategory(
                                    event.target.value as DiscoverCategory
                                )
                            }
                            inputProps={{ 'aria-label': t('点位类别') }}
                        >
                            {(['all', ...CATEGORIES] as DiscoverCategory[]).map(
                                (item) => (
                                    <MenuItem key={item} value={item}>
                                        {t(categoryLabels[item])}
                                    </MenuItem>
                                )
                            )}
                        </Select>
                    </FormControl>
                </div>
            </div>
            {loading ? (
                <div aria-label={t('正在寻找附近点位…')} aria-busy="true">
                    {[0, 1, 2].map((item) => (
                        <Skeleton
                            key={item}
                            variant="rounded"
                            height={230}
                            sx={{ mb: 2.5, borderRadius: 5 }}
                        />
                    ))}
                </div>
            ) : error ? (
                <div className="discover-empty" role="alert">
                    <ExploreOutlined />
                    <h3>{t('暂时没能加载点位')}</h3>
                    <p>{t('请检查网络连接，再试一次。')}</p>
                    <Button
                        variant="contained"
                        onClick={() => setRetry((value) => value + 1)}
                    >
                        {t('重新加载')}
                    </Button>
                </div>
            ) : results.length === 0 ? (
                <div className="discover-empty">
                    <ExploreOutlined />
                    <h3>{t('这里暂时没有符合条件的点位')}</h3>
                    <p>{t('试试扩大距离，或减少一些筛选条件。')}</p>
                    <Box
                        sx={{
                            display: 'flex',
                            gap: 1,
                            flexWrap: 'wrap',
                            justifyContent: 'center',
                        }}
                    >
                        <Button variant="outlined" onClick={reset}>
                            {t('重置筛选')}
                        </Button>
                        {radius < 50000 && (
                            <Button
                                variant="contained"
                                onClick={() =>
                                    setRadius(
                                        radii.find((value) => value > radius) ??
                                            50000
                                    )
                                }
                            >
                                {t('扩大范围')}
                            </Button>
                        )}
                    </Box>
                </div>
            ) : (
                <ol className="discover-list">
                    {results.map((marker) => (
                        <li
                            key={marker.id}
                            data-testid="discover-card"
                            data-marker-id={marker.id}
                            data-distance={marker.distance}
                        >
                            <article className="discover-card">
                                <PlacePhoto marker={marker} onOpen={setPhoto} />
                                <div className="discover-card-content">
                                    <div className="discover-card-meta">
                                        <Chip
                                            size="small"
                                            icon={
                                                <CategoryIcon
                                                    category={marker.category}
                                                />
                                            }
                                            label={t(
                                                categoryLabels[marker.category]
                                            )}
                                        />
                                        <strong>
                                            {formatDistance(marker.distance)}
                                            <small>{t('直线距离')}</small>
                                        </strong>
                                    </div>
                                    <h3>
                                        <RouterLink
                                            to={`/maps?markerId=${marker.id}&lang=${language}`}
                                        >
                                            {marker.title}
                                        </RouterLink>
                                    </h3>
                                    {marker.description && (
                                        <p className="discover-description">
                                            {marker.description}
                                        </p>
                                    )}
                                    {marker.openTimeStart &&
                                        marker.openTimeEnd && (
                                            <p className="discover-hours">
                                                {t('开放时间')} ·{' '}
                                                {marker.openTimeStart.slice(
                                                    0,
                                                    5
                                                )}
                                                –
                                                {marker.openTimeEnd.slice(0, 5)}
                                            </p>
                                        )}
                                    {marker.contentLanguage &&
                                        marker.contentLanguage !== language && (
                                            <p className="discover-hours">
                                                {t('显示原文')}
                                            </p>
                                        )}
                                    <div className="discover-card-actions">
                                        <Button
                                            variant="contained"
                                            disableElevation
                                            component="a"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                                                `${marker.lat},${marker.lng}`
                                            )}&travelmode=walking`}
                                            startIcon={<DirectionsOutlined />}
                                        >
                                            {t('导航')}
                                        </Button>
                                        <Button
                                            component={RouterLink}
                                            to={`/maps?markerId=${marker.id}&lang=${language}`}
                                            endIcon={<ArrowOutward />}
                                        >
                                            {t('在地图上查看')}
                                        </Button>
                                    </div>
                                </div>
                            </article>
                        </li>
                    ))}
                </ol>
            )}
            <Dialog
                open={Boolean(photo)}
                onClose={() => setPhoto(null)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle sx={{ pr: 7 }}>
                    {photo?.title}
                    <IconButton
                        aria-label={t('关闭照片')}
                        onClick={() => setPhoto(null)}
                        sx={{ position: 'absolute', top: 8, right: 8 }}
                    >
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    {photo && (
                        <Box
                            component="img"
                            src={toBackendAssetUrl(photo.markImage)}
                            alt={photo.title}
                            sx={{
                                width: '100%',
                                maxHeight: '70vh',
                                objectFit: 'contain',
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </section>
    )
}
