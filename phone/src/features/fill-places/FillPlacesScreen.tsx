import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { schedulePlacesApi, type SchedulePlaceChange, type SchedulePlacesApi, type SetupSchedule } from './schedulePlacesApi';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; schedules: SetupSchedule[] };

// 서버의 일정 표시는 한국 시각으로 통일한다. 기기의 시간대가 달라도 같은 일정을 가리킨다.
const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function FillPlacesScreen({ api = schedulePlacesApi, timeoutMs = REQUEST_TIMEOUT_MS }: { api?: SchedulePlacesApi; timeoutMs?: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.fillPlaces;
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveIssue, setSaveIssue] = useState<'retry' | 'reload' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const retryLast = useRef<(() => void) | null>(null);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoad({ status: 'loading' });
    void requestWithTimeout((signal) => api.fetchSchedules(signal), timeoutMs, controller).then(
      (data) => { if (loadRequest.current === controller) setLoad({ status: 'ready', schedules: data.schedules }); },
      () => { if (loadRequest.current === controller) setLoad({ status: 'error' }); },
    );
    return () => {
      loadRequest.current = null;
      controller.abort();
      const pending = saveRequest.current;
      saveRequest.current = null;
      pending?.abort();
      setSavingId(null);
    };
  // attempt는 사용자가 재시도할 때 포커스 조회를 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, timeoutMs, attempt]));

  useEffect(() => () => {
    const pending = saveRequest.current;
    saveRequest.current = null;
    pending?.abort();
  }, []);

  useEffect(() => {
    if (saveIssue) AccessibilityInfo.announceForAccessibility(saveIssue === 'reload' ? strings.placeSearch.scheduleChanged : t.saveFailed);
  }, [saveIssue, t.saveFailed]);

  const save = async (id: string, change: SchedulePlaceChange) => {
    if (saveRequest.current) return;
    // 조회를 끝내기 전에 저장 응답이 오면 이전 조회가 덮어쓰지 않도록 취소한다.
    loadRequest.current?.abort();
    loadRequest.current = null;
    const controller = new AbortController();
    saveRequest.current = controller;
    retryLast.current = () => void save(id, change);
    setSavingId(id);
    setSaveIssue(null);
    try {
      const updated = await requestWithTimeout((signal) => api.savePlace(id, change, signal), timeoutMs, controller);
      if (saveRequest.current === controller) setLoad((prev) => prev.status === 'ready'
        ? { status: 'ready', schedules: prev.schedules.map((s) => s.id === updated.id ? { ...s, ...updated } : s) } : prev);
    } catch (error) {
      if (saveRequest.current === controller) {
        setSaveIssue(isClientError(error) ? 'reload' : 'retry');
        if (isClientError(error)) { retryLast.current = null; setAttempt((n) => n + 1); }
      }
    } finally {
      if (saveRequest.current === controller) { saveRequest.current = null; setSavingId(null); }
    }
  };

  const ready = load.status === 'ready';
  const schedules = load.status === 'ready' ? load.schedules : [];
  const missing = schedules.filter((s) => !s.place && !s.noTravel).length;
  const saving = savingId !== null;
  const title = !ready ? t.heading : missing > 0 ? t.title(missing) : t.complete;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SetupHeader step={3} />
        <View style={styles.titles}>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.title, font(600)]}>{title}</Text>
          <Text style={[styles.description, font(400)]}>{t.description}</Text>
        </View>
        {load.status === 'loading' ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t.loading} style={styles.status}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : load.status === 'error' ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Text style={[styles.error, font(500)]}>{t.loadFailed}</Text>
            <Pressable accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} style={styles.textButton}>
              <Text style={[styles.secondaryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : schedules.length === 0 ? (
          <Text style={[styles.description, font(400)]}>{t.noSchedules}</Text>
        ) : schedules.map((schedule) => (
          // 온라인 회의·회의실이라 저절로 거른 일정은 흐리게 두고 이유를 붙인다. 장소를 넣으면 다시 차로 간다.
          <View key={schedule.id} style={[styles.card, schedule.noTravel && schedule.noTravelReason ? styles.filtered : null]}
            testID={`schedule-${schedule.id}`}>
            <View style={styles.cardTitle}>
              <Text style={[styles.date, font(400)]}>{dateFormat.format(new Date(schedule.start))}</Text>
              <Text style={[styles.scheduleTitle, font(600)]}>{schedule.title}</Text>
            </View>
            {!schedule.place && !schedule.noTravel && schedule.suggestion ? (
              <View style={styles.remembered}>
                <View style={styles.rememberedText}>
                  <Text style={[styles.rememberedHint, font(400)]}>{t.rememberedHint(schedule.title)}</Text>
                  <Text style={[styles.rememberedName, font(600)]}>{schedule.suggestion.name}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.rememberedConfirm}`}
                  accessibilityState={{ disabled: saving }} disabled={saving} style={styles.confirm}
                  onPress={() => void save(schedule.id, { placeId: schedule.suggestion!.placeId })}>
                  <Text style={[styles.confirmText, font(600)]}>{t.rememberedConfirm}</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.actions}>
              {schedule.place || schedule.noTravel ? <>
                <Text style={[styles.place, font(500)]}>{schedule.noTravel
                  ? `✓ ${t.noTravel}${schedule.noTravelReason ? ` · ${t.noTravelReason[schedule.noTravelReason]}` : ''}`
                  : `✓ ${schedule.place!.name}`}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.change}`}
                  accessibilityState={{ disabled: saving }} disabled={saving} style={styles.textButton}
                  onPress={() => { setSaveIssue(null); router.push({ pathname: '/setup/schedule-place-search', params: { scheduleId: schedule.id } }); }}>
                  <Text style={[styles.secondaryText, font(400)]}>{t.change}</Text>
                </Pressable>
              </> : <>
                <Text style={[styles.missing, font(400)]}>{t.missing}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.noTravel}`} accessibilityState={{ disabled: saving }}
                  disabled={saving} onPress={() => void save(schedule.id, { noTravel: true })} style={styles.textButton}>
                  <Text style={[styles.secondaryText, font(400)]}>{t.noTravel}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.add}`}
                  accessibilityState={{ disabled: saving }} disabled={saving} style={styles.outline}
                  onPress={() => { setSaveIssue(null); router.push({ pathname: '/setup/schedule-place-search', params: { scheduleId: schedule.id } }); }}>
                  <Text style={[styles.buttonText, font(600)]}>{t.add}</Text>
                </Pressable>
              </>}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {saving ? <View accessible accessibilityRole="progressbar" accessibilityLabel={t.saving}><ActivityIndicator color={colors.text} /></View> : null}
        {saveIssue ? <View accessibilityLiveRegion="polite" style={styles.status}>
          <Text style={[styles.error, font(500)]}>{saveIssue === 'reload' ? strings.placeSearch.scheduleChanged : t.saveFailed}</Text>
          {saveIssue === 'retry' ? <Pressable accessibilityRole="button" onPress={() => retryLast.current?.()} style={styles.textButton}>
            <Text style={[styles.secondaryText, font(600)]}>{t.retry}</Text>
          </Pressable> : null}
        </View> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready || saving }} disabled={!ready || saving}
          onPress={() => router.push('/setup/talk')} style={[styles.primary, (!ready || saving) && styles.disabled]}>
          <Text style={[styles.primaryText, font(600)]}>{t.next}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
          onPress={() => router.push('/setup/talk')} style={styles.later}>
          <Text style={[styles.secondaryText, font(400)]}>{t.later}</Text>
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
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 12 },
  filtered: { opacity: 0.55 },
  cardTitle: { gap: 2 },
  date: { fontSize: 14, color: colors.textMuted },
  scheduleTitle: { fontSize: 17, color: colors.text },
  place: { flex: 1, fontSize: 15, color: colors.textStrong },
  missing: { fontSize: 14, color: colors.warning, flexGrow: 1 },
  remembered: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.tint },
  rememberedText: { flex: 1, gap: 2 },
  rememberedHint: { fontSize: 13, color: colors.text },
  rememberedName: { fontSize: 15, color: colors.text },
  confirm: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 15, color: colors.onPrimary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, color: colors.textMuted },
  outline: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, color: colors.text },
  status: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  error: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  primary: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { backgroundColor: colors.primaryDisabled },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
