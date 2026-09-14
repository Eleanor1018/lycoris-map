import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Icon,
  IconButton,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestJson, isAbortError } from '../lib/http';
import { buildDirectionsUrls } from '../lib/markerLinks';
import {
  CATEGORIES,
  filterDiscover,
  formatDistance,
  parseSavedOrigin,
} from '../lib/discover';
import type {
  Coordinates,
  DiscoverCategory,
  DiscoverMarker,
  DiscoverResult,
} from '../lib/discover';
import {
  DiscoverLocationError,
  getDiscoverLocation,
} from '../lib/discoverLocation';
import { toBackendAssetUrl } from '../config/runtime';
import { useLanguage } from '../i18n/useLanguage';
import { translate as t } from '../i18n/messages';
import { colors } from '../theme/colors';

const labels: Record<DiscoverCategory, string> = {
  all: '全部',
  accessible_toilet: '无障碍卫生间',
  friendly_clinic: '友好医疗机构',
  baby_room: '母婴室',
  self_definition: '自定义',
};
const icons: Record<DiscoverCategory, string> = {
  all: 'compass-outline',
  accessible_toilet: 'wheelchair-accessibility',
  friendly_clinic: 'hospital-building',
  baby_room: 'baby-carriage',
  self_definition: 'map-marker-outline',
};
const radii = [1000, 3000, 5000, 10000, 50000];
type Origin = Coordinates & { source: 'saved' | 'default' | 'gps' };
type Target = { markerId: number; lat?: number; lng?: number; title?: string };
type Props = {
  isActive?: boolean;
  onOpenMarker: (target: Target) => void;
  onOpenMap: () => void;
};

function PlacePhoto({
  marker,
  onOpen,
}: {
  marker: DiscoverResult;
  onOpen: () => void;
}) {
  const uri = toBackendAssetUrl(marker.markImage?.trim());
  const [failed, setFailed] = useState<string>();
  if (!uri || failed === uri)
    return (
      <View
        style={[styles.photo, styles.photoEmpty]}
        accessibilityLabel={t('暂无照片')}
      >
        <Icon source={icons[marker.category]} size={48} color="#aa95b3" />
        <Text style={styles.muted}>{t('暂无照片')}</Text>
      </View>
    );
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t('查看{0}的照片', { 0: marker.title })}
    >
      <Image
        source={{ uri }}
        style={styles.photo}
        resizeMode="cover"
        onError={() => setFailed(uri)}
      />
      <View style={styles.photoLabel}>
        <Icon source="image-outline" size={16} />
        <Text style={styles.small}>{t('查看照片')}</Text>
      </View>
    </Pressable>
  );
}

export function DiscoverScreen({
  isActive = true,
  onOpenMarker,
  onOpenMap,
}: Props) {
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const [origin, setOrigin] = useState<Origin>({
    lat: 39.9042,
    lng: 116.4074,
    source: 'default',
  });
  const [ready, setReady] = useState(false);
  const lastSaved = useRef<string | null | undefined>(undefined);
  const [category, setCategory] = useState<DiscoverCategory>('all');
  const [radius, setRadius] = useState(5000);
  const [photosOnly, setPhotosOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [markers, setMarkers] = useState<DiscoverMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedLanguage, setLoadedLanguage] = useState(language);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<
    'blocked' | 'failed' | null
  >(null);
  const [actionError, setActionError] = useState(false);
  const [photo, setPhoto] = useState<DiscoverResult | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    if (!isActive) return;
    let active = true;
    setReady(false);
    setLocating(false);
    AsyncStorage.getItem('@lycoris/mapViewport/v1')
      .then(raw => {
        if (!active) return;
        if (raw !== lastSaved.current) {
          const saved = parseSavedOrigin(raw, true);
          setOrigin(
            saved
              ? { ...saved, source: 'saved' }
              : { lat: 39.9042, lng: 116.4074, source: 'default' },
          );
          lastSaved.current = raw;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      sequence.current += 1;
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !ready) return;
    const controller = new AbortController();
    let active = true;
    setMarkers([]);
    setLoading(true);
    setError(false);
    const categories = category === 'all' ? CATEGORIES : [category];
    Promise.all(
      categories.map(async item => {
        const params = `lat=${origin.lat}&lng=${origin.lng}&radius=${radius}&category=${item}`;
        const rows = await requestJson<DiscoverMarker[]>(
          `/api/markers/nearby?${params}`,
          { signal: controller.signal, language },
        );
        if (!Array.isArray(rows)) throw new Error('Invalid places response');
        return rows;
      }),
    )
      .then(groups => {
        if (active) {
          setMarkers(groups.flat());
          setLoadedLanguage(language);
        }
      })
      .catch(reason => {
        if (active && !isAbortError(reason)) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    isActive,
    ready,
    origin.lat,
    origin.lng,
    radius,
    category,
    language,
    retry,
  ]);

  const results = useMemo(
    () =>
      loadedLanguage === language
        ? filterDiscover(markers, origin, {
            radius,
            category,
            photosOnly,
            query,
          })
        : [],
    [
      markers,
      origin,
      radius,
      category,
      photosOnly,
      query,
      loadedLanguage,
      language,
    ],
  );
  const reset = () => {
    setCategory('all');
    setRadius(5000);
    setPhotosOnly(false);
    setQuery('');
  };
  const locate = async () => {
    const current = ++sequence.current;
    setLocating(true);
    setLocationError(null);
    try {
      const point = await getDiscoverLocation();
      if (current === sequence.current) setOrigin({ ...point, source: 'gps' });
    } catch (reason) {
      if (current === sequence.current)
        setLocationError(
          reason instanceof DiscoverLocationError && reason.code === 'blocked'
            ? 'blocked'
            : 'failed',
        );
    } finally {
      if (current === sequence.current) setLocating(false);
    }
  };
  const directions = async (marker: DiscoverResult) => {
    setActionError(false);
    for (const url of buildDirectionsUrls(marker, Platform.OS)) {
      try {
        await Linking.openURL(url);
        return;
      } catch {
        /* Try the web directions fallback. */
      }
    }
    setActionError(true);
  };
  const originLabel =
    origin.source === 'gps'
      ? '当前位置'
      : origin.source === 'saved'
      ? '上次查看的地图位置'
      : '默认地图区域：北京';
  const waiting = loading || !ready;

  const header = (
    <View>
      <View style={styles.heading}>
        <View style={styles.eyebrow}>
          <Icon source="compass-outline" size={17} color={colors.primary} />
          <Text style={styles.eyebrowText}>LYCORIS / {t('发现')}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {t('发现附近')}
        </Text>
        <Text style={styles.subtitle}>
          {t('看看附近的点位，找到适合你的目的地。')}
        </Text>
        <Button
          mode="contained"
          icon="crosshairs-gps"
          loading={locating}
          disabled={locating || !ready}
          onPress={locate}
          contentStyle={styles.touch}
          style={styles.locate}
        >
          {locating ? t('定位中…') : t('使用我的位置')}
        </Button>
      </View>
      <View style={styles.origin}>
        <View style={styles.flex}>
          <Text style={styles.originTitle}>{t(originLabel)}</Text>
          <Text style={styles.small}>
            {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}
          </Text>
          <Text style={styles.small}>{t('以此位置计算直线距离')}</Text>
        </View>
        <Button onPress={onOpenMap} contentStyle={styles.touch} compact>
          {t('更换位置')}
        </Button>
      </View>
      {locationError && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>
            {t(
              '暂时无法获取定位。你可以重试，或在地图上移动到想探索的区域后返回。',
            )}
          </Text>
          {locationError === 'blocked' && (
            <Button
              onPress={() => {
                Linking.openSettings().catch(() => setActionError(true));
              }}
            >
              {t('打开设置')}
            </Button>
          )}
        </View>
      )}
      {actionError && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text>{t('暂时无法打开导航，请稍后重试。')}</Text>
        </View>
      )}
      <View style={styles.filters}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('筛选点位')}
          accessibilityState={{ expanded: filtersOpen }}
          onPress={() => setFiltersOpen(!filtersOpen)}
          style={styles.filterToggle}
        >
          <Icon source="tune-variant" size={22} color={colors.primary} />
          <View style={styles.flex}>
            <Text style={styles.originTitle}>{t('筛选')}</Text>
            <Text style={styles.small}>
              {t(labels[category])} · {radius / 1000} km
              {photosOnly ? ` · ${t('仅看有图')}` : ''}
            </Text>
          </View>
          <Icon
            source={filtersOpen ? 'chevron-up' : 'chevron-down'}
            size={22}
          />
        </Pressable>
        {filtersOpen && (
          <View style={styles.filterBody}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>{t('点位类别')}</Text>
              <Button onPress={reset}>{t('重置')}</Button>
            </View>
            <View style={styles.chips}>
              {(['all', ...CATEGORIES] as DiscoverCategory[]).map(item => (
                <Chip
                  key={item}
                  icon={icons[item]}
                  selected={category === item}
                  showSelectedCheck={false}
                  accessibilityLabel={t(labels[item])}
                  accessibilityState={{ selected: category === item }}
                  onPress={() => setCategory(item)}
                  style={category === item ? styles.selectedChip : styles.chip}
                  textStyle={styles.chipText}
                >
                  {t(labels[item])}
                </Chip>
              ))}
            </View>
            <Text style={styles.fieldLabel}>{t('距离范围')}</Text>
            <View style={styles.chips}>
              {radii.map(value => (
                <Chip
                  key={value}
                  selected={radius === value}
                  accessibilityLabel={`${value / 1000} km`}
                  accessibilityState={{ selected: radius === value }}
                  onPress={() => setRadius(value)}
                  style={radius === value ? styles.selectedChip : styles.chip}
                >
                  {value / 1000} km
                </Chip>
              ))}
            </View>
            <View style={styles.rowBetween}>
              <Text>{t('仅看有图')}</Text>
              <Switch
                accessibilityLabel={t('仅看有图')}
                value={photosOnly}
                onValueChange={setPhotosOnly}
              />
            </View>
            <Text style={styles.small}>
              {t('距离按直线计算，实际路线请以导航为准。')}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.resultHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('附近点位')}
        </Text>
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          {waiting
            ? t('正在寻找附近点位…')
            : error
            ? t('加载失败')
            : t('{0} 个结果 · 由近到远', { 0: results.length })}
        </Text>
      </View>
      <TextInput
        mode="outlined"
        dense
        label={t('在结果中搜索')}
        value={query}
        onChangeText={setQuery}
        style={styles.search}
      />
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={waiting || error ? [] : results}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        initialNumToRender={6}
        ListEmptyComponent={
          waiting ? (
            <View style={styles.empty}>
              <ActivityIndicator />
              <Text style={styles.muted}>{t('正在寻找附近点位…')}</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon source="compass-outline" size={44} color="#aa95b3" />
              <Text
                accessibilityRole={error ? 'alert' : 'header'}
                style={styles.emptyTitle}
              >
                {t(error ? '暂时没能加载点位' : '这里暂时没有符合条件的点位')}
              </Text>
              <Text style={styles.muted}>
                {t(
                  error
                    ? '请检查网络连接，再试一次。'
                    : '试试扩大距离，或减少一些筛选条件。',
                )}
              </Text>
              {error ? (
                <Button
                  mode="contained"
                  onPress={() => setRetry(value => value + 1)}
                >
                  {t('重新加载')}
                </Button>
              ) : (
                <View style={styles.chips}>
                  <Button mode="outlined" onPress={reset}>
                    {t('重置筛选')}
                  </Button>
                  {radius < 50000 && (
                    <Button
                      mode="contained"
                      onPress={() =>
                        setRadius(radii.find(value => value > radius) ?? 50000)
                      }
                    >
                      {t('扩大范围')}
                    </Button>
                  )}
                </View>
              )}
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.card} testID={`discover-card-${item.id}`}>
            <PlacePhoto marker={item} onOpen={() => setPhoto(item)} />
            <View style={styles.cardBody}>
              <View style={styles.cardMeta}>
                <Text style={styles.badge}>{t(labels[item.category])}</Text>
                <View>
                  <Text style={styles.distance}>
                    {formatDistance(item.distance)}
                  </Text>
                  <Text style={styles.distanceNote}>{t('直线距离')}</Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  onOpenMarker({
                    markerId: item.id,
                    lat: item.lat,
                    lng: item.lng,
                    title: item.title,
                  })
                }
              >
                <Text style={styles.cardTitle}>{item.title}</Text>
              </Pressable>
              {Boolean(item.description) && (
                <Text numberOfLines={2} style={styles.description}>
                  {item.description}
                </Text>
              )}
              {item.openTimeStart && item.openTimeEnd ? (
                <Text style={styles.small}>
                  {t('开放时间')} · {item.openTimeStart.slice(0, 5)}–
                  {item.openTimeEnd.slice(0, 5)}
                </Text>
              ) : null}
              {item.contentLanguage && item.contentLanguage !== language ? (
                <Text style={styles.small}>{t('显示原文')}</Text>
              ) : null}
              <View style={styles.actions}>
                <Button
                  mode="contained"
                  icon="directions"
                  onPress={() => {
                    directions(item);
                  }}
                  contentStyle={styles.touch}
                >
                  {t('导航')}
                </Button>
                <Button
                  onPress={() =>
                    onOpenMarker({
                      markerId: item.id,
                      lat: item.lat,
                      lng: item.lng,
                      title: item.title,
                    })
                  }
                  contentStyle={styles.touch}
                  compact
                >
                  {t('在地图上查看')}
                </Button>
              </View>
            </View>
          </View>
        )}
      />
      <Modal
        visible={Boolean(photo)}
        transparent
        animationType="fade"
        onRequestClose={() => setPhoto(null)}
      >
        <View
          style={[
            styles.photoModal,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{photo?.title}</Text>
            <IconButton
              icon="close"
              iconColor="white"
              accessibilityLabel={t('关闭照片')}
              onPress={() => setPhoto(null)}
            />
          </View>
          {photo && (
            <Image
              source={{ uri: toBackendAssetUrl(photo.markImage) }}
              style={styles.fullPhoto}
              resizeMode="contain"
              accessibilityLabel={photo.title}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: 18, paddingBottom: 24 },
  heading: { paddingTop: 22, paddingBottom: 18 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrowText: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700',
    color: colors.primary,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 10,
    marginBottom: 8,
  },
  subtitle: { fontSize: 13, lineHeight: 21, color: colors.textSecondary },
  locate: { alignSelf: 'flex-start', marginTop: 16 },
  touch: { minHeight: 44 },
  flex: { flex: 1 },
  origin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#eee5f4',
    marginBottom: 16,
  },
  originTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  small: { fontSize: 11, lineHeight: 18, color: colors.textSecondary },
  muted: { fontSize: 12, lineHeight: 20, color: colors.textSecondary },
  notice: {
    padding: 14,
    backgroundColor: '#efeaf5',
    borderRadius: 14,
    marginBottom: 14,
  },
  noticeText: { fontSize: 12, lineHeight: 20 },
  filters: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 18,
  },
  filterToggle: {
    minHeight: 62,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterBody: { padding: 14, paddingTop: 0 },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
  },
  fieldLabel: {
    fontSize: 12,
    marginTop: 20,
    marginBottom: 10,
    color: colors.textSecondary,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#f7f3f9', minHeight: 44, justifyContent: 'center' },
  selectedChip: {
    backgroundColor: '#e7d9ef',
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { fontSize: 12 },
  resultHeading: { marginBottom: 12, gap: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  search: { backgroundColor: '#fff', marginBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  photo: { width: '100%', height: 200, backgroundColor: '#eee5f2' },
  photoEmpty: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  photoLabel: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#fffffff0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardBody: { padding: 18 },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  badge: {
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#f2ecf5',
    color: colors.primary,
    fontSize: 11,
  },
  distance: {
    fontSize: 21,
    fontWeight: '700',
    textAlign: 'right',
    color: colors.textPrimary,
  },
  distanceNote: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  cardTitle: {
    fontSize: 19,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    marginVertical: 10,
  },
  description: {
    fontSize: 13,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: 14,
  },
  empty: {
    paddingVertical: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  photoModal: { flex: 1, backgroundColor: '#171019f5' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20 },
  modalTitle: { color: '#fff', flex: 1, fontSize: 16, lineHeight: 24 },
  fullPhoto: { flex: 1, width: '100%' },
});
