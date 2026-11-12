import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { schedulePlacesApi, type SchedulePlacesApi } from '../fill-places/schedulePlacesApi';
import type { PlaceTarget } from './favorites';
import { PlaceRow } from './PlaceRow';
import { placesApi, type Place, type PlacesApi } from './placesApi';

/** 서버 검색어 상한과 같다. */
const MAX_QUERY_LENGTH = 50;

type Props = ({ target: PlaceTarget; scheduleId?: never } | { scheduleId: string; target?: never }) & {
  scheduleApi?: SchedulePlacesApi;
  api?: PlacesApi;
  timeoutMs?: number;
  debounceMs?: number;
};

type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; places: Place[] };

export function PlaceSearchScreen({ target, scheduleId, scheduleApi = schedulePlacesApi, api = placesApi, timeoutMs = REQUEST_TIMEOUT_MS, debounceMs = 300 }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.placeSearch;

  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [searchState, setSearch] = useState<SearchState>({ status: 'idle' });
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState(false);
  const [rejected, setRejected] = useState(false);

  const searchRequest = useRef<AbortController | null>(null);
  const pickRequest = useRef<AbortController | null>(null);
  const retryPick = useRef<(() => void) | null>(null);

  const trimmed = query.trim();
  const search: SearchState = trimmed === '' ? { status: 'idle' } : searchState;

  useEffect(() => {
    if (trimmed === '') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      searchRequest.current = controller;
      setSearch({ status: 'loading' });
      try {
        const places = await requestWithTimeout((signal) => api.searchPlaces(trimmed, signal), timeoutMs, controller);
        if (searchRequest.current === controller) setSearch({ status: 'ready', places });
      } catch {
        if (searchRequest.current === controller) setSearch({ status: 'error' });
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (searchRequest.current === controller) searchRequest.current = null;
    };
  }, [trimmed, attempt, api, timeoutMs, debounceMs]);

  useEffect(
    () => () => {
      const pending = pickRequest.current;
      pickRequest.current = null;
      pending?.abort();
    },
    [],
  );

  useEffect(() => {
    if (search.status === 'error') AccessibilityInfo.announceForAccessibility(t.searchFailed);
  }, [search.status, t.searchFailed]);

  useEffect(() => {
    if (pickError) AccessibilityInfo.announceForAccessibility(rejected ? t.scheduleChanged : t.saveFailed);
  }, [pickError, rejected, t.saveFailed, t.scheduleChanged]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(scheduleId === undefined ? '/setup/places' : '/setup/fill-places');
  }, [router, scheduleId]);

  /** 해당 자리 또는 일정 하나만 저장한다. 일정이 거절되면 목록 확인을 안내한다. */
  const pick = async (place: Place) => {
    if (pickRequest.current) return;
    retryPick.current = () => void pick(place);
    const controller = new AbortController();
    pickRequest.current = controller;
    setPickingId(place.id);
    setPickError(false);
    setRejected(false);
    let leave = false;
    try {
      await requestWithTimeout<unknown>(
        (signal) => scheduleId === undefined ? api.assignPlace(target!, place.id, signal) : scheduleApi.savePlace(scheduleId, { placeId: place.id }, signal),
        timeoutMs, controller,
      );
      leave = pickRequest.current === controller;
    } catch (error) {
      if (pickRequest.current === controller) {
        if (isClientError(error)) {
          if (scheduleId === undefined) leave = true;
          else { retryPick.current = goBack; setPickError(true); setRejected(true); }
        }
        else setPickError(true);
      }
    } finally {
      if (pickRequest.current === controller) {
        pickRequest.current = null;
        setPickingId(null);
      }
    }
    if (leave) goBack();
  };

  const title = scheduleId !== undefined ? t.titleSchedule : target === 'home' ? t.titleHome : target === 'work' ? t.titleWork : t.titleOther;
  const picking = pickingId !== null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SetupHeader step={scheduleId === undefined ? 2 : 3} />
        <Text accessibilityRole="header" style={[styles.title, font(600)]}>
          {title}
        </Text>
        <TextInput
          accessibilityLabel={t.inputLabel}
          autoFocus
          editable={!picking}
          autoCorrect={false}
          maxLength={MAX_QUERY_LENGTH}
          onChangeText={(value) => {
            if (value.trim() === '') setSearch({ status: 'idle' });
            setQuery(value);
          }}
          placeholder={t.inputPlaceholder}
          placeholderTextColor={colors.unchecked}
          returnKeyType="search"
          style={[styles.input, font(400)]}
          value={query}
        />

        {search.status === 'loading' ? (
          <View key="loading" accessible accessibilityRole="progressbar" accessibilityLabel={t.searching} style={styles.statusBox}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : search.status === 'error' ? (
          <View key="error" style={styles.statusBox}>
            <Text style={[styles.errorText, font(500)]}>{t.searchFailed}</Text>
            <Pressable accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : search.status === 'ready' ? (
          search.places.length === 0 ? (
            <View key="empty" style={styles.statusBox}>
              <Text style={[styles.emptyText, font(400)]}>{t.noResults}</Text>
            </View>
          ) : (
            <View key="results" style={styles.card} pointerEvents={picking ? 'none' : 'auto'}>
              {search.places.map((place, index) => (
                <PlaceRow
                  key={place.id}
                  icon="pin"
                  title={place.name}
                  subtitle={place.address}
                  isLast={index === search.places.length - 1}
                  disabled={picking}
                  onPress={() => void pick(place)}
                />
              ))}
            </View>
          )
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {picking ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t.saving} style={styles.saveError}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}
        {pickError ? (
          <View style={styles.saveError} accessibilityLiveRegion="polite">
            <Text style={[styles.errorText, font(500)]}>{rejected ? t.scheduleChanged : t.saveFailed}</Text>
            <Pressable accessibilityRole="button" onPress={() => retryPick.current?.()} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{rejected ? t.backToSchedules : t.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={goBack} style={styles.cancel}>
          <Text style={[styles.cancelText, font(400)]}>{t.cancel}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 16, gap: 22 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
  input: { height: 50, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, fontSize: 16, color: colors.text },
  card: { borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  statusBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 15, lineHeight: 22, color: colors.textMuted, textAlign: 'center' },
  errorText: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, color: colors.text, textDecorationLine: 'underline' },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  saveError: { alignItems: 'center' },
  cancel: { height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, color: colors.textMuted },
});
