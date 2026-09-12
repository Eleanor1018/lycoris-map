export type Coordinates = { lat: number; lng: number };

export type DiscoverCategory =
  | 'all'
  | 'accessible_toilet'
  | 'friendly_clinic'
  | 'baby_room'
  | 'self_definition';

export const CATEGORIES: readonly Exclude<DiscoverCategory, 'all'>[] = [
  'accessible_toilet',
  'friendly_clinic',
  'baby_room',
  'self_definition',
];

export type DiscoverMarker = Coordinates & {
  id: number;
  title: string;
  description?: string;
  category: Exclude<DiscoverCategory, 'all'>;
  markImage?: string | null;
  isPublic: boolean;
  isActive: boolean;
  openTimeStart?: string | null;
  openTimeEnd?: string | null;
  contentLanguage?: string;
};

export type DiscoverResult = DiscoverMarker & { distance: number };

const EARTH_RADIUS = 6371000;
const CATEGORY_SET = new Set<string>(CATEGORIES);

export function validCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  let dLng = toRadians(b.lng - a.lng);
  if (dLng > Math.PI) dLng -= 2 * Math.PI;
  else if (dLng < -Math.PI) dLng += 2 * Math.PI;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  let h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  h = Math.min(1, Math.max(0, h));
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS * c;
}

export function filterDiscover(
  markers: DiscoverMarker[],
  origin: Coordinates,
  options: {
    radius: number;
    category: DiscoverCategory;
    photosOnly: boolean;
    query: string;
  },
): DiscoverResult[] {
  if (
    !validCoordinates(origin) ||
    !Number.isFinite(options.radius) ||
    options.radius <= 0
  )
    return [];
  const { radius, category, photosOnly, query } = options;
  const normalizedQuery =
    typeof query === 'string' ? query.trim().toLowerCase() : '';
  const seen = new Set<number>();
  const results: DiscoverResult[] = [];

  for (const marker of markers) {
    if (!marker || !validCoordinates(marker)) continue;
    if (!Number.isSafeInteger(marker.id) || marker.id <= 0) continue;
    if (marker.isPublic !== true || marker.isActive !== true) continue;
    if (typeof marker.title !== 'string') continue;
    if (!CATEGORY_SET.has(marker.category)) continue;
    if (category !== 'all' && marker.category !== category) continue;
    if (
      photosOnly &&
      (typeof marker.markImage !== 'string' || !marker.markImage.trim())
    )
      continue;
    if (seen.has(marker.id)) continue;

    if (normalizedQuery) {
      const title =
        typeof marker.title === 'string' ? marker.title.toLowerCase() : '';
      const description =
        typeof marker.description === 'string'
          ? marker.description.toLowerCase()
          : '';
      if (
        !title.includes(normalizedQuery) &&
        !description.includes(normalizedQuery)
      )
        continue;
    }

    const distance = distanceMeters(origin, marker);
    if (!Number.isFinite(distance) || distance > radius) continue;

    seen.add(marker.id);
    results.push({ ...marker, distance });
  }

  return results.sort((a, b) => a.distance - b.distance || a.id - b.id);
}

export function parseSavedOrigin(
  raw: string | null,
  native?: boolean,
): Coordinates | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const source = parsed as Record<string, unknown>;
  const candidate = native
    ? { lat: source.latitude, lng: source.longitude }
    : { lat: source.lat, lng: source.lng };
  if (!validCoordinates(candidate)) return null;
  return { lat: candidate.lat as number, lng: candidate.lng as number };
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) {
    const rounded = Math.min(999, Math.round(meters));
    return `${rounded} m`;
  }
  const km = meters / 1000;
  if (km < 10) {
    const text = km.toFixed(1);
    return text === '10.0' ? '10 km' : `${text} km`;
  }
  return `${Math.round(km)} km`;
}
