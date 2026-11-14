import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';
import { formatScheduleDay, formatScheduleTime } from '../fill-places/scheduleFormat';
import { ScheduleActions } from '../fill-places/ScheduleActions';
import type { SchedulePlaceChange, SetupSchedule } from '../fill-places/schedulePlacesApi';

type Props = {
  schedule: SetupSchedule;
  expanded: boolean;
  onToggle: () => void;
  saving: boolean;
  onSave: (id: string, change: SchedulePlaceChange) => void;
  onNavigate?: () => void;
  /** 오늘이 아닌 일정이면 날짜도 보인다. */
  showDay?: boolean;
};

/**
 * 오늘 탭의 일정 한 줄. 누르면 펼쳐져 장소 넣기·이동 없음·'여기 맞아요'·채비·가족에게 보내기가 나온다(3단계 카드의 같은 줄).
 * 이동 없음 일정은 줄(머리)을 흐리게 보이고(펼친 버튼은 또렷하게 둔다) 글로도 '이동 없음'을 적는다(색만으로 전달하지 않는다).
 */
export function ScheduleRow({ schedule, expanded, onToggle, saving, onSave, onNavigate, showDay = false }: Props) {
  const font = useFont();
  const t = strings.today;
  const f = strings.fillPlaces;
  const status = schedule.noTravel
    ? `${t.noTravelChip}${schedule.noTravelReason ? ` · ${f.noTravelReason[schedule.noTravelReason]}` : ''}`
    : schedule.place ? schedule.place.name : f.missing;
  const missing = !schedule.place && !schedule.noTravel;
  return (
    <View testID={`today-row-${schedule.id}`} style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? t.collapse(schedule.title) : t.expand(schedule.title)}
        accessibilityState={{ expanded }} onPress={onToggle} testID={`today-row-head-${schedule.id}`}
        style={[styles.head, schedule.noTravel && styles.dimmed]}>
        <View style={styles.time}>
          <Text style={[styles.timeText, font(600)]}>{formatScheduleTime(schedule.start)}</Text>
          {showDay ? <Text style={[styles.day, font(400)]}>{formatScheduleDay(schedule.start)}</Text> : null}
        </View>
        <View style={styles.main}>
          <Text style={[styles.title, font(600)]}>{schedule.title}</Text>
          <Text style={[styles.status, font(400), missing && styles.missing]}>{status}</Text>
          {!expanded && !schedule.noTravel && schedule.care ? (
            <Text style={[styles.status, font(400)]} numberOfLines={1}>{`${f.careLabel} · ${schedule.care}`}</Text>
          ) : null}
        </View>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.chevron, font(400)]}>{expanded ? '▴' : '▾'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <ScheduleActions schedule={schedule} saving={saving} onSave={onSave} onNavigate={onNavigate} origin="today" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  dimmed: { opacity: 0.55 },
  head: { minHeight: 64, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  time: { minWidth: 52, gap: 2 },
  timeText: { fontSize: 16, color: colors.text },
  day: { fontSize: 12, color: colors.textMuted },
  main: { flex: 1, gap: 2 },
  title: { fontSize: 17, color: colors.text },
  status: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  missing: { color: colors.warning },
  chevron: { fontSize: 14, color: colors.textMuted },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
});
