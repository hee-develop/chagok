import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { createRevisionClock, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { CalendarRow } from './CalendarRow';
import { CalendarPermissionError, type CalendarSource, type DeviceCalendar } from './calendarSource';
import { defaultCalendarSource } from './defaultSource';
import {
  fetchCalendarSelection,
  saveCalendarSelection,
  type FetchSelection,
  type SaveSelection,
} from './selectionApi';

type Props = {
  source?: CalendarSource;
  save?: SaveSelection;
  restore?: FetchSelection;
  timeoutMs?: number;
  /** 선택을 서버에 저장한 직후 부른다(일정 보내기를 시작하는 자리). 기다리지 않는다. */
  onSaved?: (selectedIds: string[]) => void;
  /** 첫 설정 밖(설정 탭의 [캘린더 고르기])에서 열렸다: 단계 표시('1 / 4')를 빼고, 저장하면 2단계 대신 이전 화면으로 되돌아가며, [나중에 할게요]는 [닫기]가 된다. */
  standalone?: boolean;
};

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'denied' } | { status: 'ready'; calendars: DeviceCalendar[] };

const NEXT_ROUTE = '/setup/places';

export function CalendarSelectScreen({
  source = defaultCalendarSource,
  save,
  restore = fetchCalendarSelection,
  timeoutMs = REQUEST_TIMEOUT_MS,
  onSaved,
  standalone = false,
}: Props) {
  const saveSelection: SaveSelection = save ?? ((ids, revision, signal) => saveCalendarSelection(ids, revision, signal, source.kind));
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.calendarSelect;

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const saveRequest = useRef<AbortController | null>(null);
  const revisions = useRef(createRevisionClock());
  const stopLoading = useRef<(() => void) | null>(null);

  const loadCalendars = useCallback(() => {
    stopLoading.current?.();
    let cancelled = false;
    const controller = new AbortController();
    stopLoading.current = () => {
      cancelled = true;
      controller.abort();
    };
    setLoad({ status: 'loading' });

    (async () => {
      let calendars: DeviceCalendar[];
      try {
        calendars = await source.list();
      } catch (e) {
        // 권한이 없으면 목 캘린더로 대신하지 않고 안내만 보여 준다.
        if (!cancelled) setLoad({ status: e instanceof CalendarPermissionError ? 'denied' : 'error' });
        return;
      }
      let saved: string[] | null;
      try {
        saved = await requestWithTimeout(restore, timeoutMs, controller);
      } catch {
        if (!cancelled) setLoad({ status: 'error' });
        return;
      }
      if (cancelled) return;
      const known = new Set(calendars.map((c) => c.id));
      // 저장된 선택 중 이 기기에 있는 캘린더가 하나도 없으면(예: 목 캘린더 id만 저장된 경우) 기본 선택으로 시작한다.
      const restored = saved ? saved.filter((id) => known.has(id)) : [];
      setSelectedIds(restored.length > 0 ? restored : calendars.filter((c) => c.defaultSelected).map((c) => c.id));
      setLoad({ status: 'ready', calendars });
    })();
  }, [source, restore, timeoutMs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCalendars();
    return () => stopLoading.current?.();
  }, [loadCalendars]);

  useEffect(() => () => saveRequest.current?.abort(), []);

  useEffect(() => {
    if (saveError) AccessibilityInfo.announceForAccessibility(t.saveFailed);
  }, [saveError, t.saveFailed]);

  useEffect(() => {
    if (load.status === 'error') AccessibilityInfo.announceForAccessibility(t.loadFailed);
  }, [load.status, t.loadFailed]);

  useEffect(() => {
    if (load.status === 'denied') AccessibilityInfo.announceForAccessibility(t.permissionDenied);
  }, [load.status, t.permissionDenied]);

  // 설정에서 권한을 허용하고 돌아오면(앱이 다시 앞으로 오면) 자동으로 다시 읽는다.
  const denied = load.status === 'denied';
  useEffect(() => {
    if (!denied) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadCalendars();
    });
    return () => subscription.remove();
  }, [denied, loadCalendars]);

  const openSettings = () => {
    Linking.openSettings().catch(() => {});
  };

  const toggle = (id: string) => {
    setSaveError(false);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 첫 설정이면 2단계로, 탭에서 열었으면 왔던 화면으로 돌아간다.
  const next = () => {
    if (!standalone) router.push(NEXT_ROUTE);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const connect = async () => {
    if (load.status !== 'ready' || saveRequest.current || selectedIds.length === 0) return;
    const controller = new AbortController();
    saveRequest.current = controller;
    setSaving(true);
    setSaveError(false);
    try {
      await requestWithTimeout((signal) => saveSelection(selectedIds, revisions.current(), signal), timeoutMs, controller);
      if (saveRequest.current !== controller) return;
      onSaved?.(selectedIds);
      next();
    } catch {
      if (saveRequest.current === controller) setSaveError(true);
    } finally {
      if (saveRequest.current === controller) {
        saveRequest.current = null;
        setSaving(false);
      }
    }
  };

  const later = () => {
    const pending = saveRequest.current;
    saveRequest.current = null;
    pending?.abort();
    setSaving(false);
    next();
  };

  const count = selectedIds.length;
  const connectDisabled = load.status !== 'ready' || count === 0 || saving;
  const calendars = load.status === 'ready' ? load.calendars : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SetupHeader step={standalone ? undefined : 1} />
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
        ) : load.status === 'denied' ? (
          <View style={styles.statusBox}>
            <Text style={[styles.errorText, font(500)]}>{t.permissionDenied}</Text>
            <Pressable accessibilityRole="button" onPress={openSettings} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{t.openSettings}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={loadCalendars} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : load.status === 'error' ? (
          <View style={styles.statusBox}>
            <Text style={[styles.errorText, font(500)]}>{t.loadFailed}</Text>
            <Pressable accessibilityRole="button" onPress={loadCalendars} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : calendars.length === 0 ? (
          <View style={styles.statusBox}>
            <Text style={[styles.emptyText, font(500)]}>{t.noCalendars}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {calendars.map((calendar, index) => (
              <CalendarRow
                key={calendar.id}
                calendar={calendar}
                checked={selectedIds.includes(calendar.id)}
                isLast={index === calendars.length - 1}
                onToggle={toggle}
              />
            ))}
          </View>
        )}

        <View style={styles.notice}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={styles.noticeIcon}>
            <Rect x={5} y={11} width={14} height={10} rx={2} />
            <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </Svg>
          <Text style={[styles.noticeText, font(400)]}>{t.readOnlyNotice}</Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {saveError ? (
          <View style={styles.saveError} accessibilityLiveRegion="polite">
            <Text style={[styles.errorText, font(500)]}>{t.saveFailed}</Text>
            <Pressable accessibilityRole="button" onPress={connect} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: connectDisabled, busy: saving }}
          accessibilityLabel={saving ? t.saving : t.connect(count)}
          disabled={connectDisabled}
          onPress={connect}
          style={[styles.primary, connectDisabled && !saving && styles.primaryDisabled]}
        >
          {saving ? (
            <ActivityIndicator testID="connect-loading" accessibilityLabel={t.saving} color={colors.onPrimary} />
          ) : (
            <Text style={[styles.primaryText, font(600)]}>{t.connect(count)}</Text>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={later} style={styles.later}>
          <Text style={[styles.laterText, font(400)]}>{standalone ? t.close : t.later}</Text>
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
  statusBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 15, lineHeight: 23, color: colors.textStrong, textAlign: 'center' },
  errorText: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, color: colors.text, textDecorationLine: 'underline' },
  notice: { flexDirection: 'row', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.notice },
  noticeIcon: { marginTop: 2 },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.textStrong },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  saveError: { alignItems: 'center' },
  primary: { height: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: colors.primaryDisabled },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  later: { height: 48, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontSize: 15, color: colors.textMuted },
});
