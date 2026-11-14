import { StyleSheet, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { TravelConfirmBox } from '../calendar-sync/FilteredEventCard';
import type { FilteredEvent } from '../calendar-sync/filteredEvents';
import { formatScheduleDay, formatScheduleTime } from '../fill-places/scheduleFormat';
import { colors } from '../../ui/theme';
import { ScheduleHead } from './ScheduleHead';

type Props = {
  event: FilteredEvent;
  /** 이 줄이 "이동 일정으로 바꿀까요?" 확인을 보이고 있는가. */
  confirming: boolean;
  /** 저장 중이라 누를 수 없다. */
  disabled: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  showDay?: boolean;
};

/**
 * 오늘 탭에 보이는, 폰이 읽을 때 거른 일정(온라인·건물 안·종일)의 흐린 줄(정책서 6장 '이동 아닌 일정'). 서버로 보내지 않아 폰 안에만 있다.
 * 누르면 3단계와 같은 확인(`TravelConfirmBox`)이 나오고 [바꾸기]를 눌러야 이동 일정으로 바뀐다. 되돌리기·실패 안내는 화면 아래 `TravelMarkNotice`다.
 */
export function FilteredRow({ event, confirming, disabled, onAsk, onConfirm, onCancel, showDay = false }: Props) {
  const status = `${strings.today.noTravelChip} · ${strings.fillPlaces.noTravelReason[event.reason]}`;
  const time = formatScheduleTime(event.start);
  const day = showDay ? formatScheduleDay(event.start) : undefined;
  return (
    <View testID={`today-row-${event.id}`} style={styles.card}>
      <ScheduleHead
        testID={`today-row-head-${event.id}`}
        time={time} day={day} title={event.title} status={status} dimmed disabled={disabled}
        accessibilityLabel={strings.today.rowLabel(event.title, day ? `${day} ${time}` : time, status)}
        accessibilityHint={strings.travelFilter.markTravel}
        onPress={onAsk} />
      {confirming ? (
        <View style={styles.confirm}>
          <TravelConfirmBox title={event.title} disabled={disabled} onConfirm={onConfirm} onCancel={onCancel} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, backgroundColor: colors.notice, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  confirm: { paddingHorizontal: 16, paddingBottom: 16 },
});
