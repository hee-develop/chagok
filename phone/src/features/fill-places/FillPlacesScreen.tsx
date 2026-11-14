import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { FilteredEventCard } from '../calendar-sync/FilteredEventCard';
import { useFilteredEvents, type FilteredEvent } from '../calendar-sync/filteredEvents';
import { TravelMarkNotice } from '../calendar-sync/TravelMarkNotice';
import { useTravelMark, type TravelMarkOptions } from '../calendar-sync/useTravelMark';
import { ScheduleActions } from './ScheduleActions';
import { mergeScheduleItems } from './scheduleItems';
import { formatScheduleDate } from './scheduleFormat';
import { schedulePlacesApi, type SchedulePlacesApi } from './schedulePlacesApi';
import { useSchedulePlaces } from './useSchedulePlaces';

type Props = {
  api?: SchedulePlacesApi;
  timeoutMs?: number;
  /** 폰이 거른 일정(서버로 보내지 않은 것). 기본은 앱 전체가 공유하는 목록. */
  filteredEvents?: readonly FilteredEvent[];
  /** 거른 일정을 "이동 일정이에요"로 바꾸고 되돌리는 동작(기본은 `calendar-sync/travelMark.ts`). 바뀌면 서버 목록을 다시 조회한다. */
  travelMark?: Pick<TravelMarkOptions, 'mark' | 'undo' | 'undoVisibleMs'>;
};

/**
 * 첫 설정 3단계: 일정마다 장소를 넣거나 이동 없음으로 둔다. 일정 한 줄의 버튼(장소·채비·가족)은 오늘 탭과 같은 `ScheduleActions`다.
 * 폰이 읽을 때 거른 일정(온라인·건물 안·종일)은 흐린 줄로 같이 보이고, 누르면 확인을 거쳐 이동 일정으로 바꾼다.
 */
export function FillPlacesScreen({ api = schedulePlacesApi, timeoutMs = REQUEST_TIMEOUT_MS, filteredEvents, travelMark }: Props) {
  const sharedFiltered = useFilteredEvents();
  const filtered = filteredEvents ?? sharedFiltered;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.fillPlaces;
  const sched = useSchedulePlaces({ api, timeoutMs });
  const { load, saveIssue, clearSaveIssue, save, retrySave, reload } = sched;
  // 거른 줄을 이동 일정으로 바꾸거나 되돌리면 서버가 아는 일정이 달라지므로 서버 목록을 다시 조회한다.
  const travel = useTravelMark({ ...travelMark, lines: filtered, onChanged: reload });

  const ready = load.status === 'ready';
  const schedules = load.status === 'ready' ? load.schedules : [];
  const missing = schedules.filter((s) => !s.place && !s.noTravel).length;
  const saving = sched.saving || travel.busy;
  const items = mergeScheduleItems(schedules, filtered);
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
            <Pressable accessibilityRole="button" onPress={reload} style={styles.textButton}>
              <Text style={[styles.secondaryText, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <Text style={[styles.description, font(400)]}>{t.noSchedules}</Text>
        ) : items.map((item) => item.kind === 'filtered' ? (
          // 폰이 읽을 때 거른 일정(온라인·건물 안·종일). 서버로 보내지 않아 이 줄은 폰 안에만 있다. 누르면 확인을 거쳐 이동 일정으로 바꾼다.
          <FilteredEventCard key={`filtered-${item.event.id}`} event={item.event} disabled={saving}
            confirming={travel.confirming?.id === item.event.id}
            onAsk={() => { clearSaveIssue(); travel.ask(item.event.id, item.event.title); }}
            onConfirm={() => void travel.confirm()} onCancel={travel.cancel} />
        ) : (
          // 온라인 회의·회의실이라 저절로 거른 일정은 흐리게 두고 이유를 붙인다. 장소를 넣으면 다시 차로 간다.
          <View key={item.schedule.id} style={[styles.card, item.schedule.noTravel && item.schedule.noTravelReason ? styles.filtered : null]}
            testID={`schedule-${item.schedule.id}`}>
            <View style={styles.cardTitle}>
              <Text style={[styles.date, font(400)]}>{formatScheduleDate(item.schedule.start)}</Text>
              <Text style={[styles.scheduleTitle, font(600)]}>{item.schedule.title}</Text>
            </View>
            <ScheduleActions schedule={item.schedule} saving={saving} onSave={(id, change) => void save(id, change)} onNavigate={clearSaveIssue} />
          </View>
        ))}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {saving ? <View accessible accessibilityRole="progressbar" accessibilityLabel={t.saving}><ActivityIndicator color={colors.text} /></View> : null}
        <TravelMarkNotice undoable={travel.undoable} issue={travel.issue} disabled={saving} onUndo={() => void travel.undoNow()} />
        {saveIssue ? <View accessibilityLiveRegion="polite" style={styles.status}>
          <Text style={[styles.error, font(500)]}>{saveIssue === 'reload' ? strings.placeSearch.scheduleChanged : t.saveFailed}</Text>
          {saveIssue === 'retry' ? <Pressable accessibilityRole="button" onPress={retrySave} style={styles.textButton}>
            <Text style={[styles.secondaryText, font(600)]}>{t.retry}</Text>
          </Pressable> : null}
        </View> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready || saving }} disabled={!ready || saving}
          onPress={() => router.push('/setup/pair-car')} style={[styles.primary, (!ready || saving) && styles.disabled]}>
          <Text style={[styles.primaryText, font(600)]}>{t.next}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
          onPress={() => router.push('/setup/pair-car')} style={styles.later}>
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
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, color: colors.textMuted },
  status: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  error: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  primary: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { backgroundColor: colors.primaryDisabled },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
