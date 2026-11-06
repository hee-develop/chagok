import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { notSaved, type PlaceTarget } from './favorites';
import { PlaceRow } from './PlaceRow';
import { placesApi, type Favorites, type PlacesApi, type Suggestion } from './placesApi';
import { SuggestionCard } from './SuggestionCard';

type Props = {
  api?: PlacesApi;
  timeoutMs?: number;
};

/** retry: 같은 요청을 다시 보낼 수 있는 실패. reload: 서버가 요청을 거절해 최신 상태를 다시 불러온 경우. */
type SaveIssue = 'retry' | 'reload' | null;

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; favorites: Favorites; suggestions: Suggestion[] };

const NEXT_ROUTE = '/setup/fill-places';

export function PlacesScreen({ api = placesApi, timeoutMs = REQUEST_TIMEOUT_MS }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.places;

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveIssue, setSaveIssue] = useState<SaveIssue>(null);

  const saveRequest = useRef<AbortController | null>(null);
  const retryLast = useRef<(() => void) | null>(null);
  const stopLoading = useRef<(() => void) | null>(null);
  const loadedOnce = useRef(false);

  /**
   * silent면 이미 보이는 화면을 그대로 두고 서버 값으로 조용히 갱신한다(검색 화면에서 돌아올 때). 실패해도 화면을 바꾸지 않는다.
   * afterReject는 서버가 저장을 거절해 최신 상태를 다시 불러오는 경우다. 화면은 그대로 두고, 성공하면 저장 실패 문구를 지우며 실패하면 불러오기 실패 상태가 된다.
   */
  const loadPlaces = useCallback(
    (silent: boolean, afterReject = false) => {
      if (silent && saveRequest.current) return;
      stopLoading.current?.();
      let cancelled = false;
      const controller = new AbortController();
      stopLoading.current = () => {
        cancelled = true;
        controller.abort();
      };
      if (!silent) setLoad({ status: 'loading' });

      (async () => {
        try {
          const [favorites, suggestions] = await requestWithTimeout(
            (signal) => Promise.all([api.fetchFavorites(signal), api.fetchSuggestions(signal)]),
            timeoutMs,
            controller,
          );
          if (cancelled) return;
          loadedOnce.current = true;
          setLoad({ status: 'ready', favorites, suggestions });
          if (afterReject) setSaveIssue(null);
        } catch {
          if (cancelled) return;
          if (!silent || afterReject) {
            setLoad({ status: 'error' });
            setSaveIssue(null);
          }
        }
      })();
    },
    [api, timeoutMs],
  );

  useFocusEffect(
    useCallback(() => {
      loadPlaces(loadedOnce.current);
    }, [loadPlaces]),
  );

  useEffect(
    () => () => {
      stopLoading.current?.();
      const pending = saveRequest.current;
      saveRequest.current = null;
      pending?.abort();
    },
    [],
  );

  useEffect(() => {
    if (saveIssue) AccessibilityInfo.announceForAccessibility(t.saveFailed);
  }, [saveIssue, t.saveFailed]);

  useEffect(() => {
    if (load.status === 'error') AccessibilityInfo.announceForAccessibility(t.loadFailed);
  }, [load.status, t.loadFailed]);

  /** 서버가 자리 하나만 바꾸고 돌려주는 전체 상태로 화면을 갱신한다. */
  const run = async (key: string, operation: (signal: AbortSignal) => Promise<Favorites>) => {
    if (saveRequest.current) return;
    stopLoading.current?.();
    retryLast.current = () => void run(key, operation);
    const controller = new AbortController();
    saveRequest.current = controller;
    setSavingKey(key);
    setSaveIssue(null);
    let reload = false;
    try {
      const favorites = await requestWithTimeout(operation, timeoutMs, controller);
      if (saveRequest.current !== controller) return;
      setLoad((prev) => (prev.status === 'ready' ? { ...prev, favorites } : prev));
    } catch (error) {
      if (saveRequest.current === controller) {
        reload = isClientError(error);
        setSaveIssue(reload ? 'reload' : 'retry');
      }
    } finally {
      if (saveRequest.current === controller) {
        saveRequest.current = null;
        setSavingKey(null);
      }
    }
    if (reload) loadPlaces(true, true);
  };

  const addSuggestion = (suggestion: Suggestion) => {
    void run(suggestion.id, (signal) => api.assignPlace('other', suggestion.id, signal));
  };

  const openSearch = (target: PlaceTarget) => {
    router.push({ pathname: '/setup/place-search', params: { target } });
  };

  const saving = savingKey !== null;
  const ready = load.status === 'ready';
  const favorites = load.status === 'ready' ? load.favorites : null;
  const suggestions = load.status === 'ready' ? notSaved(load.suggestions, load.favorites) : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SetupHeader step={2} />
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.title, font(600)]}>
            {t.title}
          </Text>
          <Text style={[styles.description, font(400)]}>{t.description}</Text>
        </View>

        {load.status === 'loading' ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t.loading} style={styles.statusBox}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : load.status === 'error' ? (
          <View style={styles.statusBox}>
            <Text style={[styles.errorText, font(500)]}>{t.loadFailed}</Text>
            <Pressable accessibilityRole="button" onPress={() => loadPlaces(false)} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : favorites ? (
          <>
            <View style={styles.card}>
              <PlaceRow
                icon="home"
                title={t.home}
                subtitle={favorites.home ? `${favorites.home.name} · ${favorites.home.address}` : t.homeAddressPlaceholder}
                accessibilityLabel={favorites.home ? undefined : `${t.home}, ${t.addressUnset}`}
                accessibilityHint={t.openSearchHint}
                isLast={false}
                disabled={saving}
                onPress={() => openSearch('home')}
              />
              <PlaceRow
                icon="work"
                title={t.work}
                subtitle={favorites.work ? `${favorites.work.name} · ${favorites.work.address}` : t.workAddressPlaceholder}
                accessibilityLabel={favorites.work ? undefined : `${t.work}, ${t.addressUnset}`}
                accessibilityHint={t.openSearchHint}
                isLast={favorites.others.length === 0}
                disabled={saving}
                onPress={() => openSearch('work')}
              />
              {favorites.others.map((place, index) => (
                <PlaceRow key={place.id} icon="pin" title={place.name} subtitle={place.address} isLast={index === favorites.others.length - 1} />
              ))}
            </View>

            {suggestions.length > 0 ? (
              <View style={styles.suggestions}>
                <Text accessibilityRole="header" style={[styles.heading, font(600)]}>
                  {t.suggestionsHeading}
                </Text>
                {suggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    name={s.name}
                    hint={s.hint}
                    busy={savingKey === s.id}
                    disabled={saving}
                    onAdd={() => addSuggestion(s)}
                  />
                ))}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.addManuallyLabel}
              accessibilityHint={t.openSearchHint}
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={() => openSearch('other')}
              style={styles.manual}
            >
              <Text style={[styles.manualText, font(500)]}>{t.addManually}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {saveIssue ? (
          <View style={styles.saveError} accessibilityLiveRegion="polite">
            <Text style={[styles.errorText, font(500)]}>{t.saveFailed}</Text>
            {saveIssue === 'retry' ? (
              <Pressable accessibilityRole="button" onPress={() => retryLast.current?.()} style={styles.retry}>
                <Text style={[styles.retryText, font(600)]}>{t.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || saving }}
          disabled={!ready || saving}
          onPress={() => router.push(NEXT_ROUTE)}
          style={[styles.primary, (!ready || saving) && styles.primaryDisabled]}
        >
          <Text style={[styles.primaryText, font(600)]}>{t.next}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push(NEXT_ROUTE)} style={styles.skip}>
          <Text style={[styles.skipText, font(400)]}>{t.skip}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 16, gap: 22 },
  titles: { gap: 10 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
  description: { fontSize: 16, lineHeight: 24, color: colors.textStrong },
  card: { borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  suggestions: { gap: 10 },
  heading: { fontSize: 15, color: colors.textMuted },
  manual: { height: 50, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.unchecked, alignItems: 'center', justifyContent: 'center' },
  manualText: { fontSize: 15, color: colors.textStrong },
  statusBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  errorText: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, color: colors.text, textDecorationLine: 'underline' },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  saveError: { alignItems: 'center' },
  primary: { height: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: colors.primaryDisabled },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  skip: { height: 48, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 15, color: colors.textMuted },
});
