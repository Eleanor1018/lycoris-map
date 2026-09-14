import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DiscoverScreen } from '../src/screens/DiscoverScreen';
import { requestJson } from '../src/lib/http';
import {
  DiscoverLocationError,
  getDiscoverLocation,
} from '../src/lib/discoverLocation';
import { setLanguagePreference } from '../src/i18n/language';
import type { DiscoverMarker } from '../src/lib/discover';

jest.mock('../src/lib/http', () => ({
  requestJson: jest.fn(),
  isAbortError: (error: { name?: string } | null) =>
    error?.name === 'AbortError',
}));
jest.mock('../src/lib/discoverLocation', () => ({
  ...jest.requireActual('../src/lib/discoverLocation'),
  getDiscoverLocation: jest.fn(),
}));

const requestJsonMock = requestJson as jest.Mock;
const locationMock = getDiscoverLocation as jest.Mock;
const SAVED_KEY = '@lycoris/mapViewport/v1';
const place = (over: Partial<DiscoverMarker> = {}): DiscoverMarker => ({
  id: 1,
  lat: 39.9042,
  lng: 116.4074,
  title: '友好诊所',
  description: '入口在左侧',
  category: 'friendly_clinic',
  markImage: '/uploads/a.jpg',
  isPublic: true,
  isActive: true,
  ...over,
});
let screen: ReactTestRenderer.ReactTestRenderer;
const onOpenMarker = jest.fn();
const onOpenMap = jest.fn();

const textOf = (children: unknown): string =>
  typeof children === 'string' || typeof children === 'number'
    ? String(children)
    : Array.isArray(children)
    ? children.map(textOf).join('')
    : '';
const hasText = (text: string) =>
  screen.root.findAll(node => textOf(node.props.children) === text).length > 0;
const pressText = async (label: string) => {
  const target = screen.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(
      node =>
        node.findAll(inner => textOf(inner.props.children) === label).length > 0,
    );
  expect(target).toBeDefined();
  await ReactTestRenderer.act(async () => {
    await target!.props.onPress();
  });
  await ReactTestRenderer.act(async () => {});
};
const cardOrder = () => [
  ...new Set(
    screen.root
      .findAll(
        node =>
          typeof node.props.testID === 'string' &&
          node.props.testID.startsWith('discover-card-'),
      )
      .map(node => node.props.testID as string),
  ),
];
const render = async () => {
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(
      <DiscoverScreen onOpenMarker={onOpenMarker} onOpenMap={onOpenMap} />,
    );
  });
  await ReactTestRenderer.act(async () => {});
};

beforeEach(async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await AsyncStorage.clear();
  await setLanguagePreference('zh');
  requestJsonMock.mockReset().mockResolvedValue([place()]);
  locationMock
    .mockReset()
    .mockRejectedValue(new DiscoverLocationError('unavailable'));
  onOpenMarker.mockClear();
  onOpenMap.mockClear();
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => screen?.unmount());
  await setLanguagePreference('zh');
  jest.restoreAllMocks();
});

test('uses the saved native map centre for nearby requests and lists nearest first', async () => {
  await AsyncStorage.setItem(
    SAVED_KEY,
    JSON.stringify({ latitude: 22.3, longitude: 114.2, zoom: 12 }),
  );
  requestJsonMock.mockResolvedValue([
    place({ id: 1, lat: 22.32, lng: 114.2, title: '较远' }),
    place({ id: 2, lat: 22.31, lng: 114.2, title: '较近' }),
  ]);
  await render();
  const urls = requestJsonMock.mock.calls.map(([path]) => String(path));
  expect(urls.some(url => url.includes('/api/markers/nearby?'))).toBe(true);
  expect(urls.some(url => url.includes('lat=22.3&lng=114.2'))).toBe(true);
  expect(cardOrder()).toEqual(['discover-card-2', 'discover-card-1']);
  expect(hasText('较近')).toBe(true);
  expect(hasText('较远')).toBe(true);
});

test('view on map forwards the exact marker id, coordinates and title', async () => {
  requestJsonMock.mockResolvedValue([place({ id: 71, title: '目标点' })]);
  await render();
  await pressText('在地图上查看');
  expect(onOpenMarker).toHaveBeenCalledWith({
    markerId: 71,
    lat: 39.9042,
    lng: 116.4074,
    title: '目标点',
  });
});

test('directions tries the geo URL then the web directions fallback', async () => {
  requestJsonMock.mockResolvedValue([place({ id: 71, title: '目标点' })]);
  const openURL = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('no map app'))
    .mockResolvedValueOnce(undefined);
  await render();
  await pressText('导航');
  expect(openURL.mock.calls[0][0]).toMatch(/^geo:39\.9042,116\.4074\?q=/);
  expect(openURL.mock.calls[1][0]).toContain(
    'https://www.google.com/maps/dir/?api=1&destination=39.9042%2C116.4074',
  );
  expect(hasText('暂时无法打开导航，请稍后重试。')).toBe(false);
});

test('blocked location shows a recoverable notice and keeps the saved origin', async () => {
  await AsyncStorage.setItem(
    SAVED_KEY,
    JSON.stringify({ latitude: 10, longitude: 20, zoom: 12 }),
  );
  requestJsonMock.mockResolvedValue([]);
  locationMock.mockRejectedValue(new DiscoverLocationError('blocked'));
  await render();
  await pressText('使用我的位置');
  expect(
    hasText('暂时无法获取定位。你可以重试，或在地图上移动到想探索的区域后返回。'),
  ).toBe(true);
  expect(hasText('打开设置')).toBe(true);
  expect(hasText('上次查看的地图位置')).toBe(true);
  expect(hasText('10.0000, 20.0000')).toBe(true);
  const lastUrl = String(requestJsonMock.mock.calls.at(-1)?.[0]);
  expect(lastUrl).toContain('lat=10&lng=20');
});

test('denied location shows the same recoverable notice without the settings action', async () => {
  locationMock.mockRejectedValue(new DiscoverLocationError('failed'));
  await render();
  await pressText('使用我的位置');
  expect(
    hasText('暂时无法获取定位。你可以重试，或在地图上移动到想探索的区域后返回。'),
  ).toBe(true);
  expect(hasText('打开设置')).toBe(false);
});

test('a failed nearby request offers retry and recovers with results', async () => {
  requestJsonMock.mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(hasText('暂时没能加载点位')).toBe(true);
  expect(cardOrder()).toEqual([]);
  requestJsonMock.mockResolvedValue([place()]);
  await pressText('重新加载');
  expect(hasText('暂时没能加载点位')).toBe(false);
  expect(cardOrder()).toEqual(['discover-card-1']);
  expect(hasText('友好诊所')).toBe(true);
});

test('a late response from the previous language is ignored', async () => {
  const pending: Array<(value: DiscoverMarker[]) => void> = [];
  requestJsonMock.mockImplementation(
    () => new Promise(resolve => pending.push(resolve)),
  );
  await render();
  expect(pending).toHaveLength(4);
  await ReactTestRenderer.act(async () => {
    await setLanguagePreference('en');
  });
  expect(pending.length).toBeGreaterThan(4);
  const stale = pending.slice(0, 4);
  const fresh = pending.slice(4);
  await ReactTestRenderer.act(async () => {
    stale.forEach(resolve => resolve([place({ id: 1, title: 'Stale result' })]));
  });
  expect(hasText('Stale result')).toBe(false);
  await ReactTestRenderer.act(async () => {
    fresh.forEach(resolve => resolve([place({ id: 2, title: 'Fresh result' })]));
  });
  await ReactTestRenderer.act(async () => {});
  expect(hasText('Fresh result')).toBe(true);
  expect(hasText('Stale result')).toBe(false);
});
