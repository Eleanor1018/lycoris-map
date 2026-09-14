export type Language = 'zh' | 'en'

/** Typed zh/en message table. `zh` is the source of truth for keys. */
export const messages = {
    'app.brand': { zh: '夏水仙', en: 'Lycoris' },
    'app.tagline': {
        zh: '无障碍与友好设施地图',
        en: 'A map of accessible and friendly places',
    },
    'app.stageNotice': {
        zh: '工程基础阶段（S1）：界面外壳与后端连通性验证，完整页面将在后续阶段还原。',
        en: 'Engineering foundation (S1): shell and backend connectivity only. Full pages arrive in later stages.',
    },
    'backend.checking': { zh: '正在检查后端连接…', en: 'Checking backend connection…' },
    'backend.ready': { zh: '后端已就绪', en: 'Backend ready' },
    'backend.liveOnly': {
        zh: '后端进程存活，但依赖未就绪',
        en: 'Backend process is alive, but dependencies are not ready',
    },
    'backend.unreachable': { zh: '无法连接后端', en: 'Backend unreachable' },
    'backend.retry': { zh: '重试', en: 'Retry' },
    'backend.detail.postgres': { zh: '数据库', en: 'Database' },
    'backend.detail.redis': { zh: '缓存', en: 'Cache' },
    'backend.detail.unknown': { zh: '未知', en: 'Unknown' },
    'backend.error.network': {
        zh: '本机后端未运行或不可访问（默认 http://127.0.0.1:8080）。',
        en: 'The local backend is not running or not reachable (default http://127.0.0.1:8080).',
    },
    'backend.error.status': {
        zh: '后端返回状态 {status}。',
        en: 'The backend answered with status {status}.',
    },
    'language.label': { zh: '语言', en: 'Language' },
    'language.zh': { zh: '简体中文', en: '简体中文' },
    'language.en': { zh: 'English', en: 'English' },
} as const

export type MessageKey = keyof typeof messages

export function translate(
    language: Language,
    key: MessageKey,
    values?: Record<string, string | number>,
): string {
    const template = messages[key][language]
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = values?.[name]
        return value === undefined ? match : String(value)
    })
}
