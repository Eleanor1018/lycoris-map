import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
    Box,
    Collapse,
    Drawer,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import rehypeRaw from 'rehype-raw'
import Slugger from 'github-slugger'

const mdModules = import.meta.glob<string>('../docs/*.md', { query: '?raw', import: 'default' })

async function loadDoc(slug: string): Promise<string> {
    const key = `../docs/${slug}.md`
    const loader = mdModules[key]
    if (!loader) throw new Error(`Doc not found: ${slug}`)
    return await loader()
}

const drawerWidth = 292
const NAV_OFFSET_VAR = 'var(--nav-height, 96px)'
const NAV_HEIGHT_VAR_MOBILE = 'var(--nav-height, 94px)'

type TocItem = {
    level: 2 | 3 | 4
    text: string
    id: string
}

const headingRegex = /^#{2,4}\s+(.+)$/gm

const sanitizeHeadingText = (raw: string) =>
    raw
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()

const buildToc = (markdown: string): TocItem[] => {
    const items: TocItem[] = []
    const slugger = new Slugger()
    let match: RegExpExecArray | null

    while ((match = headingRegex.exec(markdown)) !== null) {
        const full = match[0]
        const rawText = match[1]
        const level = (full.match(/^#+/)?.[0].length ?? 0) as 2 | 3 | 4
        if (level < 2 || level > 4) continue

        const text = sanitizeHeadingText(rawText)
        if (!text) continue

        const id = slugger.slug(text)

        items.push({ level, text, id })
    }

    return items
}

export default function Documents() {
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))
    const navigate = useNavigate()
    const location = useLocation()
    const { slug } = useParams<{ slug?: string }>()

    const orderedDocs = [
        { slug: 'nora-hrt-guide', title: 'HRT 指南' },
    ]

    // 默认文档：取列表第一篇；如果没有，兜底 intro
    const defaultSlug = orderedDocs[0]?.slug ?? 'intro'
    const activeSlug = slug ?? defaultSlug

    // 手机端 drawer 开关
    const [mobileOpen, setMobileOpen] = useState(false)
    const [hrtOpen, setHrtOpen] = useState(true)

    // markdown 内容
    const [content, setContent] = useState<string>('# Loading...')
    const [err, setErr] = useState<string>('')
    const [tocItems, setTocItems] = useState<TocItem[]>([])
    const fontSize = 16
    const fontScale = fontSize / 16
    const selectedFontFamily = 'var(--ly-font-body)'
    const hrtToggleId = `documents-${activeSlug}-toc-toggle`
    const hrtSectionId = `documents-${activeSlug}-toc-section`

    // 如果访问 /documents（没有 slug），自动跳到默认文档
    useEffect(() => {
        if (!slug) {
            navigate(`/documents/${defaultSlug}`, { replace: true })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, defaultSlug])

    // 根据 activeSlug 加载 markdown
    useEffect(() => {
        let alive = true
        setErr('')
        setContent('# Loading...')

        loadDoc(activeSlug)
            .then((md) => {
                if (!alive) return
                setContent(md)
                setTocItems(buildToc(md))
            })
            .catch((e) => {
                if (!alive) return
                setErr(String(e?.message ?? e))
                setContent('# 文档加载失败')
                setTocItems([])
            })

        return () => {
            alive = false
        }
    }, [activeSlug])

    useEffect(() => {
        if (!location.hash) return
        const id = decodeURIComponent(location.hash.replace('#', ''))
        if (!id) return
        const el = document.getElementById(id)
        if (!el) return
        const handle = window.setTimeout(() => {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 0)
        return () => window.clearTimeout(handle)
    }, [location.hash, content])

    // Drawer 内部内容（菜单）
    const drawer = useMemo(
        () => (
            <Box sx={{ width: '100%', px: 1.25, py: 1 }}>
                <List dense disablePadding>
                    <ListItemButton
                        onClick={() => setHrtOpen((prev) => !prev)}
                        id={hrtToggleId}
                        aria-expanded={hrtOpen}
                        aria-controls={hrtSectionId}
                        sx={{
                            borderRadius: 999,
                            fontWeight: 700,
                            color: 'var(--ly-color-ink)',
                            bgcolor: 'rgba(208, 188, 255, 0.34)',
                            '&:hover': { bgcolor: 'rgba(208, 188, 255, 0.48)' },
                        }}
                    >
                        <ListItemText
                            primary="雪雁的HRT指南(MTF)"
                            primaryTypographyProps={{ fontSize: 16, fontWeight: 700, lineHeight: 1.55 }}
                        />
                        {hrtOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </ListItemButton>

                    <Collapse in={hrtOpen} timeout="auto" unmountOnExit id={hrtSectionId} aria-labelledby={hrtToggleId}>
                        <Box
                            sx={{
                                mt: 0.5,
                                mb: 0.5,
                                borderRadius: 4,
                                bgcolor: 'rgba(255, 255, 255, 0.48)',
                                px: 0.5,
                                py: 0.5,
                            }}
                        >
                            <List dense disablePadding aria-label="文档目录">
                                {tocItems.map((item) => (
                                    <ListItemButton
                                        key={item.id}
                                        onClick={() => {
                                            const el = document.getElementById(item.id)
                                            if (el) {
                                                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                            }
                                            if (location.hash !== `#${item.id}`) {
                                                navigate(`/documents/${activeSlug}#${item.id}`)
                                            }
                                            if (isMobile) setMobileOpen(false)
                                        }}
                                        sx={{
                                            borderRadius: 999,
                                            px: item.level === 2 ? 2 : item.level === 3 ? 3 : 4,
                                            color: 'var(--ly-color-ink)',
                                            '&:hover': { bgcolor: 'rgba(252, 221, 236, 0.58)' },
                                            '& .MuiListItemText-primary': {
                                                fontSize: item.level === 2 ? 16 : 14,
                                                fontWeight: item.level === 2 ? 700 : 500,
                                                lineHeight: 1.55,
                                            },
                                        }}
                                    >
                                        <ListItemText primary={item.text} />
                                    </ListItemButton>
                                ))}
                            </List>
                        </Box>
                    </Collapse>
                </List>
            </Box>
        ),
        [activeSlug, hrtOpen, hrtSectionId, hrtToggleId, isMobile, navigate, tocItems, location.hash]
    )

    return (
        <Box
            sx={{
                display: { xs: 'block', md: 'grid' },
                gridTemplateColumns: { md: `${drawerWidth}px minmax(0, 1fr)` },
                gap: { md: 3, lg: 4 },
                minHeight: '100vh',
                px: { xs: 0, md: 'clamp(20px, 2.5vw, 36px)' },
                py: { xs: 0, md: 1.5 },
                background: '#fff',
            }}
        >
            {!isMobile && (
                <Box
                    component="aside"
                    sx={{
                        position: 'sticky',
                        top: `calc(${NAV_OFFSET_VAR} + 12px)`,
                        alignSelf: 'start',
                        height: `calc(100vh - ${NAV_OFFSET_VAR} - 24px)`,
                        overflow: 'hidden',
                        borderRadius: 5,
                        border: '2px solid rgba(221, 165, 196, 0.31)',
                        background: '#fff',
                        boxShadow: '0 20px 42px rgba(221, 165, 196, 0.18)',
                        backdropFilter: 'blur(18px)',
                        WebkitBackdropFilter: 'blur(18px)',
                    }}
                >
                    <Box
                        sx={{
                            px: 2.5,
                            pt: 'clamp(34px, 4vw, 56px)',
                            pb: 2,
                            borderBottom: '1px solid rgba(221, 165, 196, 0.28)',
                        }}
                    >
                        <Typography
                            sx={{
                                fontFamily: 'var(--ly-font-logo)',
                                fontWeight: 700,
                                letterSpacing: '-0.02em',
                                color: 'var(--ly-color-ink)',
                                fontSize: 30,
                                lineHeight: 1,
                            }}
                        >
                            Docs
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{ mt: 0.75, color: 'var(--ly-color-muted)' }}
                        >
                            文档目录
                        </Typography>
                    </Box>
                    <Box sx={{ height: 'calc(100% - 78px)', overflowY: 'auto', py: 0.75 }}>
                        {drawer}
                    </Box>
                </Box>
            )}

            {isMobile && (
                <Drawer
                    variant="temporary"
                    open={mobileOpen}
                    onClose={() => setMobileOpen(false)}
                    ModalProps={{ keepMounted: true }}
                    sx={{
                        '& .MuiDrawer-paper': {
                            width: `min(${drawerWidth}px, calc(100vw - 32px))`,
                            boxSizing: 'border-box',
                            borderRadius: '0 28px 28px 0',
                            top: `calc(${NAV_HEIGHT_VAR_MOBILE} + 8px)`,
                            height: `calc(100vh - ${NAV_HEIGHT_VAR_MOBILE} - 24px)`,
                            border: '2px solid rgba(221, 165, 196, 0.31)',
                            borderLeft: 0,
                            background: '#fff',
                        },
                    }}
                >
                    {drawer}
                </Drawer>
            )}

            {isMobile && (
                <IconButton
                    onClick={() => setMobileOpen(true)}
                    aria-label="打开文档目录"
                    sx={{
                        position: 'fixed',
                        right: 16,
                        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                        zIndex: 1300,
                        width: 46,
                        height: 46,
                        bgcolor: '#7a4b8f',
                        color: '#fff',
                        boxShadow: '0 12px 26px rgba(122, 75, 143, 0.34)',
                        '&:hover': { bgcolor: '#6b3f80' },
                    }}
                >
                    <MenuIcon />
                </IconButton>
            )}

            <Box
                component="article"
                sx={{
                    minWidth: 0,
                    width: '100%',
                    px: { xs: 2, md: 0 },
                    pb: { xs: 8, md: 6 },
                    display: 'flex',
                    justifyContent: 'center',
                }}
            >
                <Box
                    sx={{
                        width: '100%',
                        maxWidth: { xs: '100%', md: 900, xl: 980 },
                        px: { xs: 0, md: 'clamp(38px, 5vw, 72px)' },
                        py: { xs: 1.25, md: 'clamp(34px, 4vw, 56px)' },
                        borderRadius: { xs: 0, md: 6 },
                        bgcolor: { xs: 'transparent', md: '#fff' },
                        border: { xs: 'none', md: '1px solid rgba(221, 165, 196, 0.28)' },
                        boxShadow: { xs: 'none', md: '0 22px 60px rgba(90, 56, 80, 0.08)' },
                    }}
                >
                    {err ? (
                        <Typography color="error" sx={{ mb: 2 }}>
                            {err}
                        </Typography>
                    ) : null}

                    <Box
                        sx={{
                            fontSize,
                            fontFamily: selectedFontFamily,
                            lineHeight: 1.78,
                            maxWidth: '100%',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word',
                            color: '#111827',
                            '& h1': { fontSize: { xs: `${Math.round(28 * fontScale)}px`, md: `${Math.round(38 * fontScale)}px` }, lineHeight: 1.16, mb: 2.2, letterSpacing: '-0.035em' },
                            '& h2': { fontSize: { xs: `${Math.round(22 * fontScale)}px`, md: `${Math.round(28 * fontScale)}px` }, lineHeight: 1.22, mt: 4, mb: 1.4, scrollMarginTop: 110, letterSpacing: '-0.02em' },
                            '& h3': { fontSize: { xs: `${Math.round(18 * fontScale)}px`, md: `${Math.round(21 * fontScale)}px` }, lineHeight: 1.35, mt: 2.5, mb: 1, scrollMarginTop: 110 },
                            '& h4': { scrollMarginTop: 90 },
                            '& p': { my: 1.25, fontSize: `${fontSize}px`, maxWidth: '100%', overflowWrap: 'anywhere' },
                            '& li': { my: 0.65, fontSize: `${fontSize}px`, maxWidth: '100%', overflowWrap: 'anywhere' },
                            '& ul, & ol': { pl: { xs: 2.4, md: 3.5 } },
                            '& code': {
                                fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
                                fontSize: '0.92em',
                                whiteSpace: 'pre-wrap',
                                bgcolor: 'rgba(122, 75, 143, 0.08)',
                                borderRadius: 1,
                                px: 0.45,
                            },
                            '& pre': {
                                maxWidth: '100%',
                                overflowX: 'auto',
                                whiteSpace: 'pre',
                                p: 2,
                                borderRadius: 3,
                                bgcolor: 'rgba(17, 24, 39, 0.04)',
                            },
                            '& table': {
                                display: 'block',
                                maxWidth: '100%',
                                overflowX: 'auto',
                            },
                            '& img': {
                                width: { xs: '260px', md: '500px', xl: '600px' },
                                maxWidth: '100%',
                                height: 'auto',
                                display: 'block',
                                margin: '12px auto',
                            },
                        }}
                    >
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSlug]}>
                            {content}
                        </ReactMarkdown>
                    </Box>
                </Box>
            </Box>
        </Box>
    )
}
