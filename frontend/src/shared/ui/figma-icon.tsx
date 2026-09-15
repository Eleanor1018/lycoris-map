import navSearch from '@/assets/figma/nav-search.svg'
import navBookmarks from '@/assets/figma/nav-bookmarks.svg'
import navContribute from '@/assets/figma/nav-contribute.svg'
import navLanguages from '@/assets/figma/nav-languages.svg'
import navSettings from '@/assets/figma/nav-settings.svg'
import map from '@/assets/figma/map.svg'
import direction from '@/assets/figma/direction.svg'
import plus from '@/assets/figma/plus.svg'
import minusButton from '@/assets/figma/minus-button.svg'
import close from '@/assets/figma/close.svg'
import search from '@/assets/figma/search.svg'
import microphone from '@/assets/figma/microphone.svg'
import accountMore from '@/assets/figma/account-more.svg'
import toilet from '@/assets/figma/toilet.svg'
import nursing from '@/assets/figma/nursing.svg'
import medical from '@/assets/figma/medical.svg'
import check from '@/assets/figma/check.svg'
import chevron from '@/assets/figma/chevron.svg'
import info from '@/assets/figma/info.svg'
import bookmarkFilled from '@/assets/figma/bookmark-filled.svg'
import edit from '@/assets/figma/edit.svg'
import share from '@/assets/figma/share.svg'
import forward from '@/assets/figma/forward.svg'
import mobileMap from '@/assets/figma/mobile-map.svg'
import mobileDirection from '@/assets/figma/mobile-direction.svg'
import radar from '@/assets/figma/radar.svg'
import mobileContribute from '@/assets/figma/mobile-contribute.svg'
import mobileEdit from '@/assets/figma/mobile-edit.svg'
import mobileBookmark from '@/assets/figma/mobile-bookmark.svg'
import mobileShare from '@/assets/figma/mobile-share.svg'
import mobileMicrophone from '@/assets/figma/mobile-microphone.svg'
import mobileChevronDark from '@/assets/figma/mobile-chevron-dark.svg'
import mobileChevronBlue from '@/assets/figma/mobile-chevron-blue.svg'
import upload from '@/assets/figma/upload.svg'
import send from '@/assets/figma/send.svg'
import authLogin from '@/assets/figma/auth-login.svg'

const icons = {
    authLogin,
    navSearch,
    navBookmarks,
    navContribute,
    navLanguages,
    navSettings,
    map,
    direction,
    plus,
    minusButton,
    close,
    search,
    microphone,
    accountMore,
    toilet,
    nursing,
    medical,
    check,
    chevron,
    info,
    bookmarkFilled,
    edit,
    share,
    forward,
    mobileMap,
    mobileDirection,
    radar,
    mobileContribute,
    mobileEdit,
    mobileBookmark,
    mobileShare,
    mobileMicrophone,
    mobileChevronDark,
    mobileChevronBlue,
    upload,
    send,
}
export type FigmaIconName = keyof typeof icons

/** Original Figma exports; intrinsic path bounds remain unchanged. */
export function FigmaIcon({
    name,
    size = 24,
    className = '',
}: {
    name: FigmaIconName
    size?: number
    className?: string
}) {
    return (
        <img
            src={icons[name]}
            alt=""
            aria-hidden="true"
            width={size}
            height={size}
            className={`figma-icon ${className}`}
            draggable={false}
        />
    )
}
