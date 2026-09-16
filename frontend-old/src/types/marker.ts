export type MarkerCategory =
    | 'accessible_toilet'
    | 'friendly_clinic'
    | 'baby_room'
    | 'self_definition'

export type MapMarker = {
    id: string
    lat: number
    lng: number
    category: MarkerCategory
    title: string
    description: string
    isPublic: boolean
    isActive: boolean
    openTimeStart?: string | null
    openTimeEnd?: string | null
    markImage: string
    createdAt: number
}
