import { NativeModules, Platform } from 'react-native';
import { getAndroidLocationAccess } from './locationPermissions';
import { getIOSLocationAccess } from './iosLocationPermissions';
import { validCoordinates, type Coordinates } from './discover';

export class DiscoverLocationError extends Error {
  constructor(public code: 'blocked' | 'unavailable' | 'failed') {
    super(code);
  }
}

export async function getDiscoverLocation(): Promise<Coordinates> {
  const native = NativeModules.NativeLocation;
  if (typeof native?.getCurrentPosition !== 'function') {
    throw new DiscoverLocationError('unavailable');
  }
  if (Platform.OS === 'android') {
    const access = await getAndroidLocationAccess(true);
    if (access === 'blocked') throw new DiscoverLocationError('blocked');
    if (access === 'denied') throw new DiscoverLocationError('failed');
  } else if (Platform.OS === 'ios') {
    const access = await getIOSLocationAccess();
    if (access === 'blocked') throw new DiscoverLocationError('blocked');
    if (access === 'unavailable')
      throw new DiscoverLocationError('unavailable');
  } else {
    throw new DiscoverLocationError('unavailable');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      native.getCurrentPosition({ timeoutMs: 8000, maxAgeMs: 60000 }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DiscoverLocationError('failed')),
          10000,
        );
      }),
    ]);
    const result = { lat: position?.latitude, lng: position?.longitude };
    if (!validCoordinates(result)) throw new DiscoverLocationError('failed');
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
