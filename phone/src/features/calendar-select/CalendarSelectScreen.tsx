import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { CalendarRow } from './CalendarRow';
import { mockCalendarSource, type CalendarSource, type DeviceCalendar } from './calendarSource';
import {
  createRevisionClock,
  fetchCalendarSelection,
  REQUEST_TIMEOUT_MS,
  saveCalendarSelection,
  type FetchSelection,
  type SaveSelection,
} from './selectionApi';

type Props = {
  source?: CalendarSource;
  save?: SaveSelection;
  restore?: FetchSelection;
  timeoutMs?: number;
};

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; calendars: DeviceCalendar[] };

const NEXT_ROUTE = '/setup/places';

/** signal이 abort되면 reject하는 Promise. 요청 구현이 signal을 무시해도 시간 제한이 걸리도록 경쟁시킨다. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

export function CalendarSelectScreen({
  source = mockCalendarSource,
  save = saveCalendarSelection,
  restore = fetchCalendarSelection,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: Props) {
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    stopLoading.current = () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    setLoad({ status: 'loading' });

    (async () => {
      let calendars: DeviceCalendar[];
      try {
        calendars = await source.list();
      } catch {
        if (!cancelled) setLoad({ status: 'error' });
        return;
      }
      timer = setTimeout(() => controller.abort(), timeoutMs);
      let saved: string[] | null;
      try {
        saved = await Promise.race([restore(controller.signal), whenAborted(controller.signal)]);
      } catch {
        clearTimeout(timer);
        if (!cancelled) setLoad({ status: 'error' });
        return;
      }
      clearTimeout(timer);
      if (cancelled) return;
      const known = new Set(calendars.map((c) => c.id));
      setSelectedIds(saved ? saved.filter((id) => known.has(id)) : calendars.filter((c) => c.defaultSelected).map((c) => c.id));
      setLoad({ status: 'ready', calendars });
    })();
  }, [source, restore, timeoutMs]);

  useEffect(() => {
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

  const toggle = (id: string) => {
    setSaveError(false);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const connect = async () => {
    if (load.status !== 'ready' || saveRequest.current || selectedIds.length === 0) return;
    const controller = new AbortController();
    saveRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    setSaving(true);
    setSaveError(false);
    try {
      await Promise.race([save(selectedIds, revisions.current(), controller.signal), whenAborted(controller.signal)]);
      if (saveRequest.current !== controller) return;
      router.push(NEXT_ROUTE);
    } catch {
      if (saveRequest.current === controller) setSaveError(true);
    } finally {
      clearTimeout(timer);
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
    router.push(NEXT_ROUTE);
  };

  const count = selectedIds.length;
  const connectDisabled = load.status !== 'ready' || count === 0 || saving;
  const calendars = load.status === 'ready' ? load.calendars : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SetupHeader step={1} />
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
            <Pressable accessibilityRole="button" onPress={loadCalendars} style={styles.retry}>
              <Text style={[styles.retryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : calendars.length > 0 ? (
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
        ) : null}

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
          <Text style={[styles.laterText, font(400)]}>{t.later}</Text>
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
