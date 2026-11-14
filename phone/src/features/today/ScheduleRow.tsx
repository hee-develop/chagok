import { StyleSheet, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors } from '../../ui/theme';
import { formatScheduleDay, formatScheduleTime } from '../fill-places/scheduleFormat';
import { ScheduleActions } from '../fill-places/ScheduleActions';
import type { SchedulePlaceChange, SetupSchedule } from '../fill-places/schedulePlacesApi';
import { ScheduleHead } from './ScheduleHead';

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

/** 줄의 상태 글자: 이동 없음(이유), 장소 이름, 장소 없음. */
export const scheduleStatus = (schedule: SetupSchedule) => {
  const f = strings.fillPlaces;
  return schedule.noTravel
    ? `${strings.today.noTravelChip}${schedule.noTravelReason ? ` · ${f.noTravelReason[schedule.noTravelReason]}` : ''}`
    : schedule.place ? schedule.place.name : f.missing;
};

/**
 * 오늘 탭의 일정 한 줄. 누르면 펼쳐져 장소 넣기·이동 없음·'여기 맞아요'·채비·가족에게 보내기가 나온다(3단계 카드의 같은 줄).
 * 이동 없음 일정은 줄(머리)을 색으로 낮추고(펼친 버튼은 또렷하게 둔다) 글로도 '이동 없음'을 적는다(색만으로 전달하지 않는다).
 * 스크린리더는 '제목 시간 상태'를 읽고, 펼치기·접기는 힌트로 따로 읽는다.
 */
export function ScheduleRow({ schedule, expanded, onToggle, saving, onSave, onNavigate, showDay = false }: Props) {
  const t = strings.today;
  const f = strings.fillPlaces;
  const status = scheduleStatus(schedule);
  const time = formatScheduleTime(schedule.start);
  const day = showDay ? formatScheduleDay(schedule.start) : undefined;
  return (
    <View testID={`today-row-${schedule.id}`} style={[styles.card, schedule.noTravel && styles.dimmedCard]}>
      <ScheduleHead
        testID={`today-row-head-${schedule.id}`}
        time={time} day={day} title={schedule.title} status={status}
        attention={!schedule.place && !schedule.noTravel} dimmed={schedule.noTravel}
        extra={!expanded && !schedule.noTravel && schedule.care ? `${f.careLabel} · ${schedule.care}` : undefined}
        accessibilityLabel={t.rowLabel(schedule.title, day ? `${day} ${time}` : time, status)}
        accessibilityHint={expanded ? t.collapseHint : t.expandHint}
        expanded={expanded} onPress={onToggle} />
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
  dimmedCard: { backgroundColor: colors.notice },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
});
