export const panels = [
    'initial',
    'search',
    'nearby',
    'bookmarks',
    'languages',
    'settings',
    'contribute',
    'contribute-form',
    'details',
] as const
export type Panel = (typeof panels)[number]
export type Snap = 'collapsed' | 'half' | 'full'
/** Only the dynamically imported development page supplies sample data. */
export type DesignSample = {
    account: { name: string; handle: string }
    place: {
        bookmarkTitle: string
        title: string
        distance: string
        hours: string
        description: string
        desktopDescription: string
        desktopPhoto: string
        mobilePhoto: string
    }
    maps: {
        desktop: string
        mobile: string
        desktopPin: string
        mobilePin: string
        desktopPlace: string
        mobilePlace: string
    }
}
export function parsePanel(value: string | null): Panel {
    return panels.find((panel) => panel === value) ?? 'initial'
}
