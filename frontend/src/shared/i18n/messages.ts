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

    /* S1 development map spike (/__dev/map-spike); replaced by S2/S4 flows. */
    'spike.title': { zh: '地图生命周期验证（开发）', en: 'Map lifecycle spike (dev)' },
    'spike.notProduction': {
        zh: 'S1 开发验证入口，不是产品页面，S2/S4 会替换为正式地图与账号流程。',
        en: 'S1 development-only entry, not a product screen. S2/S4 replace it with the real map and account flows.',
    },
    'spike.markerCount': { zh: '当前点位数', en: 'Markers rendered' },
    'spike.controlMarker': { zh: '控制点位 ID', en: 'Control marker id' },
    'spike.controlTitle': { zh: '当前标题', en: 'Current title' },
    'spike.controlActive': { zh: '当前 isActive', en: 'Current isActive' },
    'spike.controlVersion': { zh: 'version（应保持不变）', en: 'version (must stay fixed)' },
    'spike.updateCost': {
        zh: '本次更新耗时（合成样本）',
        en: 'Last update cost (synthetic sample)',
    },
    'spike.syntheticNotice': {
        zh: '本页显示的 200 个点位是固定合成样本，仅用于验证地图生命周期，不代表真实设施或历史数据。',
        en: 'The 200 points on this page are a fixed synthetic sample used only to verify map lifecycle. They are not real facilities or historical data.',
    },
    'spike.toggleLanguage': { zh: '切换语言', en: 'Toggle language' },
    'spike.togglePanel': { zh: '显示/隐藏面板', en: 'Show/hide panel' },
    'spike.updateFirst': { zh: '更新首个点位字段', en: 'Update first marker fields' },
    'spike.removeHalf': { zh: '移除一半点位', en: 'Remove half the markers' },
    'spike.restoreAll': { zh: '恢复全部点位', en: 'Restore all markers' },
    'spike.resetView': { zh: '回到初始视图', en: 'Reset to initial view' },
    'spike.showPanel': { zh: '显示开发面板', en: 'Show dev panel' },

    /* S1 QA browser diagnostics (/__dev/qa); replaced by S2/S4 flows. */
    'qa.title': { zh: 'S1 浏览器诊断（开发）', en: 'S1 browser diagnostics (dev)' },
    'qa.notProduction': {
        zh: '本页是 S1 本机诊断工具，不是产品界面；正式账号 UI 在 S4，视觉验收在 S2。',
        en: 'This is an S1 local diagnostics page, not product UI. Real account UI is S4 and visual acceptance is S2.',
    },
    'qa.viewport375': { zh: '375 × 812 预览', en: '375 × 812 preview' },
    'qa.viewport1440': { zh: '1440 × 1024 预览', en: '1440 × 1024 preview' },
    'qa.viewportNote': {
        zh: 'iframe 使用真实 CSS 视口尺寸，用于响应式检查；这不是 iPhone 设备模拟，也不缩放截图冒充手机视口。',
        en: 'Iframes use real CSS viewport sizes for responsive checks. This is not iPhone device emulation and does not scale screenshots to fake a phone viewport.',
    },
    'qa.sessionTitle': { zh: '开发会话诊断', en: 'Dev session diagnostics' },
    'qa.sessionNote': {
        zh: '仅用于验证 transport 与本机会话：不注册账号、不改密码、不保存或打印密码，登录后立即清空密码输入框。',
        en: 'Verifies transport and the local session only: no registration, no password change, and the password is never stored, printed or persisted. The field is cleared right after submit.',
    },
    'qa.username': { zh: '用户名或邮箱', en: 'Username or email' },
    'qa.password': { zh: '密码（仅本次提交使用）', en: 'Password (used for this submit only)' },
    'qa.login': { zh: '登录', en: 'Log in' },
    'qa.logout': { zh: '退出登录', en: 'Log out' },
    'qa.checkMe': { zh: '检查 /api/me', en: 'Check /api/me' },
    'qa.avatar': { zh: '读取头像 Blob', en: 'Fetch avatar Blob' },
    'qa.uploadAvatar': { zh: '上传合成头像', en: 'Upload synthetic avatar' },
    'qa.sessionState': { zh: '当前会话', en: 'Session state' },
    'qa.signedOut': { zh: '未登录', en: 'Signed out' },
    'qa.signedIn': { zh: '已登录为 {publicId}', en: 'Signed in as {publicId}' },
    'qa.authEpochLabel': { zh: 'authEpoch', en: 'authEpoch' },
    'qa.me401': { zh: '/api/me 返回 401，会话已清除', en: '/api/me returned 401, session cleared' },
    'qa.result': { zh: '结果', en: 'Result' },
    'qa.avatarPreview': { zh: '头像预览', en: 'Avatar preview' },
    'qa.privateCacheCleared': {
        zh: '已清除该账号的私有查询缓存（公开数据保留）',
        en: 'Cleared this account\u2019s private query cache (public data kept)',
    },
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
