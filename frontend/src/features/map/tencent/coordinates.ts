import L from 'leaflet'
import geometry from './mainland-coverage.json'
import type { LatLng } from '../coords'

// Same mainland coverage and MIT-licensed approximation as the native apps.
// See LICENSE.txt. Storage, API calls, camera and picked points remain WGS84.
type Edge = { x: number; y: number; nextX: number; nextY: number }
const strips = new Map<number, Edge[]>()
for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1]!,
                b = ring[i]!
            if (a[1] === b[1]) continue
            const edge = { x: a[0]!, y: a[1]!, nextX: b[0]!, nextY: b[1]! }
            for (
                let strip = Math.floor(Math.min(edge.y, edge.nextY));
                strip <= Math.floor(Math.max(edge.y, edge.nextY));
                strip++
            ) {
                const entries = strips.get(strip) ?? []
                entries.push(edge)
                strips.set(strip, entries)
            }
        }
    }
}

export function inMainland(point: LatLng): boolean {
    if (point.lat < 18 || point.lat > 54 || point.lng < 73 || point.lng > 136) return false
    let inside = false
    for (const edge of strips.get(Math.floor(point.lat)) ?? []) {
        if (edge.y > point.lat === edge.nextY > point.lat) continue
        const crossing =
            ((edge.nextX - edge.x) * (point.lat - edge.y)) / (edge.nextY - edge.y) + edge.x
        if (point.lng < crossing) inside = !inside
    }
    return inside
}

function forward(point: LatLng): LatLng {
    const x = point.lng - 105,
        y = point.lat - 35
    const wave = ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
    let lat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    lat += wave + ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
    lat += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3
    let lng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    lng += wave + ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
    lng += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3
    const rad = (point.lat / 180) * Math.PI,
        ee = 0.00669342162296594323
    const magic = 1 - ee * Math.sin(rad) ** 2,
        root = Math.sqrt(magic)
    return {
        lat: point.lat + (lat * 180) / (((6378245 * (1 - ee)) / (magic * root)) * Math.PI),
        lng: point.lng + (lng * 180) / ((6378245 / root) * Math.cos(rad) * Math.PI),
    }
}

export function toTencent(point: LatLng): LatLng {
    return inMainland(point) ? forward(point) : point
}

export function fromTencent(point: LatLng): LatLng {
    let candidate = point
    for (let i = 0; i < 8; i++) {
        const projected = forward(candidate)
        const latError = projected.lat - point.lat,
            lngError = projected.lng - point.lng
        candidate = { lat: candidate.lat - latError, lng: candidate.lng - lngError }
        if (Math.max(Math.abs(latError), Math.abs(lngError)) < 1e-9) break
    }
    return inMainland(candidate) ? candidate : point
}

export const tencentCrs: L.CRS & { projection: L.Projection } = {
    ...L.CRS.EPSG3857,
    code: 'GCJ02:3857',
    projection: {
        ...L.Projection.SphericalMercator,
        project(point: L.LatLng) {
            // Preserve Leaflet's world wrapping while testing mainland coverage.
            const wrapped = point.wrap(),
                converted = toTencent(wrapped)
            return L.Projection.SphericalMercator.project(
                L.latLng(converted.lat, converted.lng + point.lng - wrapped.lng),
            )
        },
        unproject(point: L.Point) {
            const projected = L.Projection.SphericalMercator.unproject(point)
            const wrapped = projected.wrap(),
                converted = fromTencent(wrapped)
            return L.latLng(converted.lat, converted.lng + projected.lng - wrapped.lng)
        },
    },
}
