export type MapSource = 'osm' | 'tianditu' | 'tencent'

export const osmTileUrl = '/tiles/osm/{z}/{x}/{y}.png'

export const mapSourceNames: Record<MapSource, string> = {
    osm: 'OSM',
    tianditu: '天地图',
    tencent: '腾讯地图',
}

export function tiandituApiKey(): string {
    return (import.meta.env.VITE_TIANDITU_API_KEY ?? '').trim()
}

export function isMapSourceAvailable(source: MapSource): boolean {
    if (source === 'osm') return true
    return (source === 'tianditu' ? tiandituApiKey() : tencentApiKey()).length > 0
}

export function tencentApiKey(): string {
    return (import.meta.env.VITE_TENCENT_MAP_KEY ?? '').trim()
}

export function tiandituTileUrl(layer: 'vec' | 'cva'): string {
    // Both layers use the same Web Mercator tile matrix as Leaflet/OSM.
    return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(tiandituApiKey())}`
}
