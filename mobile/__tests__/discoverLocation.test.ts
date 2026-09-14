import { NativeModules, Platform } from 'react-native';
import { getDiscoverLocation } from '../src/lib/discoverLocation';
import { getAndroidLocationAccess } from '../src/lib/locationPermissions';
import { getIOSLocationAccess } from '../src/lib/iosLocationPermissions';

jest.mock('../src/lib/locationPermissions', () => ({ getAndroidLocationAccess: jest.fn() }));
jest.mock('../src/lib/iosLocationPermissions', () => ({ getIOSLocationAccess: jest.fn() }));
const androidAccess = jest.mocked(getAndroidLocationAccess);
const iosAccess = jest.mocked(getIOSLocationAccess);
const previousOS = Platform.OS;
const previousNative = NativeModules.NativeLocation;

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  androidAccess.mockResolvedValue('approximate');
  iosAccess.mockResolvedValue('precise');
  NativeModules.NativeLocation = { getCurrentPosition: jest.fn().mockResolvedValue({ latitude: 31.2, longitude: 121.4 }) };
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
  NativeModules.NativeLocation = previousNative;
  jest.clearAllMocks();
  jest.useRealTimers();
});

test('uses approximate Android location without requiring precise access', async () => {
  await expect(getDiscoverLocation()).resolves.toEqual({ lat: 31.2, lng: 121.4 });
  expect(androidAccess).toHaveBeenCalledWith(true);
  expect(NativeModules.NativeLocation.getCurrentPosition).toHaveBeenCalledWith({ timeoutMs: 8000, maxAgeMs: 60000 });
});
test.each(['denied', 'blocked'] as const)('does not call native location with %s access', async access => {
  androidAccess.mockResolvedValue(access);
  await expect(getDiscoverLocation()).rejects.toMatchObject({ code: access === 'blocked' ? 'blocked' : 'failed' });
  expect(NativeModules.NativeLocation.getCurrentPosition).not.toHaveBeenCalled();
});
test('handles a build without native location', async () => {
  NativeModules.NativeLocation = undefined;
  await expect(getDiscoverLocation()).rejects.toMatchObject({ code: 'unavailable' });
  expect(androidAccess).not.toHaveBeenCalled();
});
test('rejects invalid native coordinates', async () => {
  NativeModules.NativeLocation.getCurrentPosition.mockResolvedValue({ latitude: null, longitude: 121.4 });
  await expect(getDiscoverLocation()).rejects.toMatchObject({ code: 'failed' });
});
test('lets Core Location request first-time iOS access, and supports approximate access', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  for (const access of ['notDetermined', 'approximate'] as const) {
    iosAccess.mockResolvedValue(access);
    await expect(getDiscoverLocation()).resolves.toEqual({ lat: 31.2, lng: 121.4 });
  }
  expect(androidAccess).not.toHaveBeenCalled();
});
test('directs blocked iOS access to settings without starting another request', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  iosAccess.mockResolvedValue('blocked');
  await expect(getDiscoverLocation()).rejects.toMatchObject({ code: 'blocked' });
  expect(NativeModules.NativeLocation.getCurrentPosition).not.toHaveBeenCalled();
});
test('times out even if the native implementation never settles', async () => {
  jest.useFakeTimers();
  NativeModules.NativeLocation.getCurrentPosition.mockReturnValue(new Promise(() => {}));
  const check = expect(getDiscoverLocation()).rejects.toMatchObject({ code: 'failed' });
  await jest.advanceTimersByTimeAsync(10001);
  await check;
  expect(jest.getTimerCount()).toBe(0);
});
