import { MapShell } from '@/layouts/MapShell'
import type { DesignSample } from '@/layouts/types'
import desktop from '@/assets/figma/fixtures/desktop-map.png'
import mobile from '@/assets/figma/fixtures/mobile-map.png'
import desktopPin from '@/assets/figma/fixtures/desktop-pin.svg'
import mobilePin from '@/assets/figma/fixtures/mobile-pin.svg'
import desktopPlace from '@/assets/figma/fixtures/desktop-place.svg'
import mobilePlace from '@/assets/figma/fixtures/mobile-place.svg'
import desktopPhoto from '@/assets/figma/fixtures/desktop-photo.png'
import mobilePhoto from '@/assets/figma/fixtures/mobile-photo.jpg'
const sample: DesignSample = {
    account: { name: 'Nora', handle: 'Nora1018' },
    place: {
        bookmarkTitle: '600, South Wanping Road.',
        title: '600 South Wanping Road, Shanghai,  Accessible Toilet',
        distance: '1.1km',
        hours: '09:00-21:00',
        description:
            "Sip handcrafted cocktails and enjoy waterfront views at NYC's favorite floating restaurant.",
        desktopDescription:
            "Sip handcrafted cocktails and enjoy\nwaterfront views at NYC's favorite\nfloating...",
        desktopPhoto,
        mobilePhoto,
    },
    maps: { desktop, mobile, desktopPin, mobilePin, desktopPlace, mobilePlace },
}
export default function DesignPage() {
    return <MapShell sample={sample} />
}
