import L from 'leaflet'
import pin from '@/assets/figma/map-place.svg'
import pinSvg from '@/assets/figma/map-place.svg?raw'
import type { MarkerCategory } from '@/shared/query/keys'

// Keep the Figma pin's shape, white edge, center and shadow. Only its body changes.
// The blue is the original export; other hues use nearby MUI palette shades:
// https://mui.com/material-ui/customization/color/#color-palette
const colors = {
    accessible_toilet: '#6393F2',
    baby_room: '#FFA726',
    friendly_clinic: '#66BB6A',
    self_definition: '#9575CD',
} satisfies Record<MarkerCategory, string>

function icon(category: MarkerCategory) {
    return L.icon({
        iconUrl:
            category === 'accessible_toilet'
                ? pin
                : `data:image/svg+xml,${encodeURIComponent(
                      pinSvg.replace('fill="#6393F2"', `fill="${colors[category]}"`),
                  )}`,
        iconSize: [27, 43],
        iconAnchor: [13.5, 39],
    })
}

// Reuse icon objects across updates so selecting or translating a marker does
// not recreate its icon. A changed category still updates the existing marker.
export const placeIcons = {
    accessible_toilet: icon('accessible_toilet'),
    baby_room: icon('baby_room'),
    friendly_clinic: icon('friendly_clinic'),
    self_definition: icon('self_definition'),
} satisfies Record<MarkerCategory, L.Icon>

// Coordinate-only links and contribution drafts have no place category yet.
export const locationTargetIcon = placeIcons.accessible_toilet
