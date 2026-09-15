import { devMessages } from './devMessages'
export type Language = 'zh' | 'en'
const productMessages = {
    'app.brand': { zh: '夏水仙', en: 'Lycoris' },
    'app.tagline': {
        zh: '无障碍与友好设施地图',
        en: 'A map of accessible and friendly places',
    },
    'language.label': { zh: '语言', en: 'Language' },
    'language.zh': { zh: '简体中文', en: '简体中文' },
    'language.en': { zh: 'English', en: 'English' },

    /* S1 development map spike (/__dev/map-spike); replaced by S2/S4 flows. */
} as const
export type MessageKey = keyof typeof productMessages | keyof typeof devMessages
export const messages: Partial<Record<MessageKey, { zh: string; en: string }>> = {
    ...productMessages,
    ...(import.meta.env.DEV ? devMessages : {}),
}
export function translate(
    language: Language,
    key: MessageKey,
    values?: Record<string, string | number>,
): string {
    const template = messages[key]?.[language] ?? key
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = values?.[name]
        return value === undefined ? match : String(value)
    })
}
