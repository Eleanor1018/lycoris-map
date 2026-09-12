import { useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import axios from 'axios'
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Skeleton,
    Switch,
    TextField,
} from '@mui/material'
import ExploreOutlined from '@mui/icons-material/ExploreOutlined'
import MyLocationOutlined from '@mui/icons-material/MyLocationOutlined'
import TuneOutlined from '@mui/icons-material/TuneOutlined'
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
    validCoordinates,
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
type Origin = Coordinates & { source: 'saved' | 'default' | 'gps' }
function initialOrigin(): Origin {
    try {
        const saved = parseSavedOrigin(localStorage.getItem('map.lastView'))
        if (saved) return { ...saved, source: 'saved' }
    } catch {
        /* Browsing remains available without storage. */
    }
    return { lat: 39.9042, lng: 116.4074, source: 'default' }
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
    const [origin, setOrigin] = useState<Origin>(initialOrigin)
    const [category, setCategory] = useState<DiscoverCategory>('all')
    const [radius, setRadius] = useState(5000)
    const [photosOnly, setPhotosOnly] = useState(false)
    const [query, setQuery] = useState('')
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [response, setResponse] = useState<{
        key: string
        markers: DiscoverMarker[]
        error: boolean
    }>({ key: '', markers: [], error: false })
    const [retry, setRetry] = useState(0)
    const [locating, setLocating] = useState(false)
    const [locationError, setLocationError] = useState(false)
    const [photo, setPhoto] = useState<DiscoverResult | null>(null)
    const locationSequence = useRef(0)
    const locationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined
    )
    const requestKey = `${origin.lat}:${origin.lng}:${category}:${radius}:${language}:${retry}`
    const loading = response.key !== requestKey
    const error = !loading && response.error
    const markers = loading ? noMarkers : response.markers
    useEffect(
        () => () => {
            locationSequence.current += 1
            clearTimeout(locationTimer.current)
        },
        []
    )

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
                photosOnly,
                query,
            }),
        [markers, origin, radius, category, photosOnly, query]
    )
    const reset = () => {
        setCategory('all')
        setRadius(5000)
        setPhotosOnly(false)
        setQuery('')
    }
    const locate = () => {
        const sequence = ++locationSequence.current
        clearTimeout(locationTimer.current)
        setLocationError(false)
        if (!navigator.geolocation) {
            setLocationError(true)
            return
        }
        setLocating(true)
        const fail = () => {
            if (sequence !== locationSequence.current) return
            locationSequence.current += 1
            clearTimeout(locationTimer.current)
            setLocating(false)
            setLocationError(true)
        }
        locationTimer.current = setTimeout(fail, 12000)
        try {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    if (sequence !== locationSequence.current) return
                    const next = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    }
                    if (!validCoordinates(next)) {
                        fail()
                        return
                    }
                    clearTimeout(locationTimer.current)
                    locationSequence.current += 1
                    setOrigin({ ...next, source: 'gps' })
                    setLocating(false)
                },
                fail,
                { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
            )
        } catch {
            fail()
        }
    }
    const originLabel =
        origin.source === 'gps'
            ? '当前位置'
            : origin.source === 'saved'
            ? '上次查看的地图位置'
            : '默认地图区域：北京'
    const filterSummary = `${t(categoryLabels[category])} · ${
        radius / 1000
    } km${photosOnly ? ` · ${t('仅看有图')}` : ''}`

    return (
        <section className="discover-page">
            <div className="discover-heading">
                <div>
                    <span className="discover-eyebrow">
                        <ExploreOutlined fontSize="small" /> LYCORIS /{' '}
                        {t('发现')}
                    </span>
                    <h1>{t('发现附近')}</h1>
                    <p>{t('看看附近的点位，找到适合你的目的地。')}</p>
                </div>
                <Button
                    variant="contained"
                    disableElevation
                    startIcon={
                        locating ? (
                            <CircularProgress size={18} color="inherit" />
                        ) : (
                            <MyLocationOutlined />
                        )
                    }
                    onClick={locate}
                    disabled={locating}
                    sx={{ borderRadius: 99, minHeight: 46, px: 2.5 }}
                >
                    {locating ? t('定位中…') : t('使用我的位置')}
                </Button>
            </div>
            <div className="discover-origin">
                <PlaceOutlined fontSize="small" />
                <div>
                    <strong>{t(originLabel)}</strong>
                    <span>
                        {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)} ·{' '}
                        {t('以此位置计算直线距离')}
                    </span>
                </div>
                <Button
                    component={RouterLink}
                    to="/maps"
                    endIcon={<ArrowOutward />}
                    sx={{ minHeight: 44, flexShrink: 0 }}
                >
                    {t('更换位置')}
                </Button>
            </div>
            {locationError && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    {t(
                        '暂时无法获取定位。你可以重试，或在地图上移动到想探索的区域后返回。'
                    )}
                </Alert>
            )}
            <div className="discover-layout">
                <aside className="discover-filters" aria-label={t('筛选点位')}>
                    <button
                        className="discover-filter-toggle"
                        aria-expanded={filtersOpen}
                        aria-controls="discover-filter-body"
                        onClick={() => setFiltersOpen(!filtersOpen)}
                    >
                        <TuneOutlined />
                        <span>
                            {t('筛选')}
                            <small>{filterSummary}</small>
                        </span>
                        <span>{filtersOpen ? '−' : '+'}</span>
                    </button>
                    <div
                        id="discover-filter-body"
                        className={`discover-filter-body ${
                            filtersOpen ? 'is-open' : ''
                        }`}
                    >
                        <div className="discover-filter-title">
                            <h2>{t('筛选点位')}</h2>
                            <Button onClick={reset} sx={{ minHeight: 44 }}>
                                {t('重置')}
                            </Button>
                        </div>
                        <p className="discover-field-label">{t('点位类别')}</p>
                        <div className="discover-categories">
                            {(['all', ...CATEGORIES] as DiscoverCategory[]).map(
                                (item) => (
                                    <Button
                                        key={item}
                                        startIcon={
                                            <CategoryIcon category={item} />
                                        }
                                        aria-pressed={category === item}
                                        className={
                                            category === item ? 'selected' : ''
                                        }
                                        onClick={() => setCategory(item)}
                                    >
                                        {t(categoryLabels[item])}
                                    </Button>
                                )
                            )}
                        </div>
                        <FormControl fullWidth size="small" sx={{ mt: 3 }}>
                            <InputLabel id="discover-radius-label">
                                {t('距离范围')}
                            </InputLabel>
                            <Select
                                labelId="discover-radius-label"
                                label={t('距离范围')}
                                value={radius}
                                onChange={(event) =>
                                    setRadius(Number(event.target.value))
                                }
                                inputProps={{
                                    'data-testid': 'discover-radius',
                                }}
                                sx={{ minHeight: 44 }}
                            >
                                {radii.map((value) => (
                                    <MenuItem key={value} value={value}>
                                        {value / 1000} km
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControlLabel
                            sx={{ ml: 0, mt: 1.5, minHeight: 44 }}
                            control={
                                <Switch
                                    checked={photosOnly}
                                    onChange={(_, checked) =>
                                        setPhotosOnly(checked)
                                    }
                                />
                            }
                            label={t('仅看有图')}
                        />
                        <p className="discover-filter-note">
                            {t('距离按直线计算，实际路线请以导航为准。')}
                        </p>
                    </div>
                </aside>
                <div className="discover-results">
                    <div className="discover-results-heading">
                        <div aria-live="polite">
                            <h2>{t('附近点位')}</h2>
                            <span>
                                {loading
                                    ? t('正在寻找附近点位…')
                                    : error
                                    ? t('加载失败')
                                    : t('{0} 个结果 · 由近到远', {
                                          0: results.length,
                                      })}
                            </span>
                        </div>
                        <TextField
                            size="small"
                            label={t('在结果中搜索')}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            sx={{ width: { xs: '100%', sm: 240 } }}
                        />
                    </div>
                    {loading ? (
                        <div
                            aria-label={t('正在寻找附近点位…')}
                            aria-busy="true"
                        >
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
                                                radii.find(
                                                    (value) => value > radius
                                                ) ?? 50000
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
                                        <PlacePhoto
                                            marker={marker}
                                            onOpen={setPhoto}
                                        />
                                        <div className="discover-card-content">
                                            <div className="discover-card-meta">
                                                <Chip
                                                    size="small"
                                                    icon={
                                                        <CategoryIcon
                                                            category={
                                                                marker.category
                                                            }
                                                        />
                                                    }
                                                    label={t(
                                                        categoryLabels[
                                                            marker.category
                                                        ]
                                                    )}
                                                />
                                                <strong>
                                                    {formatDistance(
                                                        marker.distance
                                                    )}
                                                    <small>
                                                        {t('直线距离')}
                                                    </small>
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
                                                        {marker.openTimeEnd.slice(
                                                            0,
                                                            5
                                                        )}
                                                    </p>
                                                )}
                                            {marker.contentLanguage &&
                                                marker.contentLanguage !==
                                                    language && (
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
                                                    startIcon={
                                                        <DirectionsOutlined />
                                                    }
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
                </div>
            </div>
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
