export type MapSource = 'osm' | 'tianditu'

export const osmTileUrl = '/tiles/osm/{z}/{x}/{y}.png'

export const mapSourceNames: Record<MapSource, string> = {
    osm: 'OSM',
    tianditu: '天地图',
}

export function tiandituApiKey(): string {
    return (import.meta.env.VITE_TIANDITU_API_KEY ?? '').trim()
}

export function isMapSourceAvailable(source: MapSource): boolean {
    return source === 'osm' || tiandituApiKey().length > 0
}

export function tiandituTileUrl(layer: 'vec' | 'cva'): string {
    // Both layers use the same Web Mercator tile matrix as Leaflet/OSM.
    return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(tiandituApiKey())}`
}
