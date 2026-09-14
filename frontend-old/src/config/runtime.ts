const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? '')

const isAbsoluteUrl = (value: string) => /^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')

export const toBackendAssetUrl = (value?: string | null): string | undefined => {
    if (!value) return undefined
    if (isAbsoluteUrl(value)) return value
    if (!API_BASE_URL) return value
    if (value.startsWith('/')) return `${API_BASE_URL}${value}`
    return `${API_BASE_URL}/${value}`
}
