import {
  CATEGORIES,
  distanceMeters,
  filterDiscover,
  formatDistance,
  parseSavedOrigin,
  validCoordinates,
  type Coordinates,
  type DiscoverMarker,
} from '../src/lib/discover';

const marker = (over: Partial<DiscoverMarker> = {}): DiscoverMarker => ({
  id: 1,
  lat: 0,
  lng: 0,
  title: 'Clinic',
  description: 'help',
  category: 'friendly_clinic',
  markImage: 'photo.jpg',
  isPublic: true,
  isActive: true,
  ...over,
});

const options = (over: Partial<Parameters<typeof filterDiscover>[2]> = {}) => ({
  radius: 5000,
  category: 'all' as const,
  photosOnly: false,
  query: '',
  ...over,
});

const ids = (result: ReturnType<typeof filterDiscover>) =>
  result.map(r => r.id);

describe('validCoordinates', () => {
  it('accepts legal finite numbers only', () => {
    expect(validCoordinates({ lat: 0, lng: 0 })).toBe(true);
    expect(validCoordinates({ lat: -90, lng: 180 })).toBe(true);
  });
  it('rejects null, strings, coercion, non-finite and out of bounds', () => {
    for (const bad of [
      null,
      '0,0',
      { lat: '1', lng: 2 },
      { lat: NaN, lng: 0 },
      { lat: 0, lng: Infinity },
      { lat: 91, lng: 0 },
      { lat: 0, lng: 181 },
    ]) {
      expect(validCoordinates(bad)).toBe(false);
    }
  });
});

describe('distanceMeters', () => {
  it('is zero for identical points and PI*R for antipodes', () => {
    expect(distanceMeters({ lat: 12, lng: 34 }, { lat: 12, lng: 34 })).toBe(0);
    expect(
      distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }),
    ).toBeCloseTo(Math.PI * 6371000, 0);
  });
  it('takes the short anti-meridian route (~23km, not the long way)', () => {
    const d = distanceMeters({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(d).toBeGreaterThan(22000);
    expect(d).toBeLessThan(23000);
  });
});

describe('filterDiscover', () => {
  it('enforces the radius boundary inclusively', () => {
    const origin: Coordinates = { lat: 0, lng: 0 };
    const near = marker({ id: 1, lat: 0, lng: 0.01 }); // ~1113m
    const far = marker({ id: 2, lat: 0, lng: 0.05 }); // ~5566m
    expect(
      ids(filterDiscover([near, far], origin, options({ radius: 1113 }))),
    ).toEqual([1]);
    expect(
      ids(filterDiscover([near, far], origin, options({ radius: 2000 }))),
    ).toEqual([1]);
    expect(
      ids(filterDiscover([near, far], origin, options({ radius: 1000 }))),
    ).toEqual([]);
  });

  it('sorts nearest first and breaks ties by ascending id', () => {
    const origin: Coordinates = { lat: 0, lng: 0 };
    const tiedHigh = marker({ id: 9, lat: 0.01, lng: 0 });
    const tiedLow = marker({ id: 3, lat: 0.01, lng: 0 });
    const closest = marker({ id: 5, lat: 0.001, lng: 0 });
    expect(
      ids(filterDiscover([tiedHigh, closest, tiedLow], origin, options())),
    ).toEqual([5, 3, 9]);
  });

  it('dedupes repeated ids keeping the first', () => {
    const origin: Coordinates = { lat: 0, lng: 0 };
    const first = marker({ id: 7, lng: 0.001, title: 'first' });
    const dupe = marker({ id: 7, lng: 0.002, title: 'dupe' });
    const result = filterDiscover([first, dupe], origin, options());
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('first');
  });

  it('rejects private, inactive, unknown category, invalid coords and non-finite ids', () => {
    const origin: Coordinates = { lat: 0, lng: 0 };
    const kept = marker({ id: 1 });
    const rejected = [
      marker({ id: 2, isPublic: false }),
      marker({ id: 3, isActive: false }),
      marker({ id: 4, category: 'bogus' as DiscoverMarker['category'] }),
      marker({ id: 5, lat: 120 }),
      marker({ id: Number.NaN }),
    ];
    expect(ids(filterDiscover([kept, ...rejected], origin, options()))).toEqual(
      [1],
    );
  });

  it('applies category, photosOnly and case-insensitive trimmed query filters', () => {
    const origin: Coordinates = { lat: 0, lng: 0 };
    const toilet = marker({
      id: 1,
      category: 'accessible_toilet',
      title: 'Accessible Toilet',
    });
    const clinic = marker({
      id: 2,
      category: 'friendly_clinic',
      title: 'Clinic',
      markImage: null,
    });
    const noPhoto = marker({ id: 3, title: 'Baby Room', markImage: undefined });
    const list = [toilet, clinic, noPhoto];
    expect(
      ids(
        filterDiscover(
          list,
          origin,
          options({ category: 'accessible_toilet' }),
        ),
      ),
    ).toEqual([1]);
    expect(
      ids(filterDiscover(list, origin, options({ photosOnly: true }))),
    ).toEqual([1]);
    expect(
      ids(filterDiscover(list, origin, options({ query: '  CLINIC ' }))),
    ).toEqual([2]);
    expect(
      ids(filterDiscover(list, origin, options({ query: 'help' }))),
    ).toEqual([1, 2, 3]);
  });

  it('returns no results for an invalid origin', () => {
    expect(filterDiscover([marker()], { lat: NaN, lng: 0 }, options())).toEqual(
      [],
    );
  });

  it('exposes the four categories', () => {
    expect(CATEGORIES).toEqual([
      'accessible_toilet',
      'friendly_clinic',
      'baby_room',
      'self_definition',
    ]);
  });
});

describe('parseSavedOrigin', () => {
  it('reads web and native shapes', () => {
    expect(parseSavedOrigin('{"lat":1.5,"lng":2.5,"zoom":12}')).toEqual({
      lat: 1.5,
      lng: 2.5,
    });
    expect(
      parseSavedOrigin('{"latitude":3.5,"longitude":4.5,"zoom":9}', true),
    ).toEqual({ lat: 3.5, lng: 4.5 });
  });
  it('rejects corrupt, null, scalar-string and incomplete storage payloads', () => {
    expect(parseSavedOrigin('not json')).toBeNull();
    expect(parseSavedOrigin('null')).toBeNull();
    expect(parseSavedOrigin('"1,2"')).toBeNull();
    expect(parseSavedOrigin('{"lat":1.5}')).toBeNull();
    expect(parseSavedOrigin(null)).toBeNull();
    expect(parseSavedOrigin('{"latitude":1,"longitude":2}')).toBeNull();
  });
});

describe('formatDistance', () => {
  it('formats meter and kilometre boundaries consistently', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(230)).toBe('230 m');
    expect(formatDistance(999.9)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1200)).toBe('1.2 km');
    expect(formatDistance(9999)).toBe('10 km');
    expect(formatDistance(12000)).toBe('12 km');
  });
});
