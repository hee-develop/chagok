import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';
import type { FilteredEvent } from './filteredEvents';

// 서버의 일정 표시는 한국 시각으로 통일한다. 기기의 시간대가 달라도 같은 일정을 가리킨다.
const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

type Props = {
  event: FilteredEvent;
  /** 이 줄이 "이동 일정으로 바꿀까요?" 확인을 보이고 있는가. */
  confirming: boolean;
  /** 저장 중이라 누를 수 없다. */
  disabled: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 폰이 읽을 때 거른 일정(온라인·건물 안, 서버로 보내지 않음)의 흐린 줄. 누르면 확인이 나오고 [바꾸기]를 눌러야 이동 일정으로 바뀐다.
 * `useTravelMark`의 값을 그대로 넘겨 쓴다. 3단계와 오늘 일정 화면이 같이 쓴다.
 */
export function FilteredEventCard({ event, confirming, disabled, onAsk, onConfirm, onCancel }: Props) {
  const font = useFont();
  const t = strings.travelFilter;
  const reasons = strings.fillPlaces;
  return (
    <View style={[styles.card, styles.filtered]} testID={`schedule-${event.id}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${event.title} ${t.markTravel}`}
        accessibilityState={{ disabled }} disabled={disabled} onPress={onAsk} style={styles.header}>
        <View style={styles.cardTitle}>
          <Text style={[styles.date, font(400)]}>{dateFormat.format(new Date(event.start))}</Text>
          <Text style={[styles.scheduleTitle, font(600)]}>{event.title}</Text>
        </View>
        <View style={styles.actions}>
          <Text style={[styles.place, font(500)]}>{`✓ ${reasons.noTravel} · ${reasons.noTravelReason[event.reason]}`}</Text>
          <Text style={[styles.secondaryText, font(600)]}>{t.markTravel}</Text>
        </View>
      </Pressable>
      {confirming ? (
        <View accessibilityLiveRegion="polite" style={styles.confirmBox}>
          <Text style={[styles.question, font(600)]}>{t.confirmQuestion(event.title)}</Text>
          <Text style={[styles.hint, font(400)]}>{t.confirmHint}</Text>
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.cancel} accessibilityState={{ disabled }} disabled={disabled}
              onPress={onCancel} style={styles.cancel}>
              <Text style={[styles.cancelText, font(400)]}>{t.cancel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t.confirm} accessibilityState={{ disabled }} disabled={disabled}
              onPress={onConfirm} style={styles.confirm}>
              <Text style={[styles.confirmText, font(600)]}>{t.confirm}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={[styles.hint, font(400)]}>{t.markTravelHint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 12 },
  filtered: { opacity: 0.55 },
  header: { gap: 12 },
  cardTitle: { gap: 2 },
  date: { fontSize: 14, color: colors.textMuted },
  scheduleTitle: { fontSize: 17, color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  place: { flex: 1, fontSize: 15, color: colors.textStrong },
  secondaryText: { fontSize: 15, color: colors.textMuted },
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  confirmBox: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  question: { fontSize: 15, lineHeight: 22, color: colors.text },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 6 },
  cancel: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, color: colors.textMuted },
  confirm: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 15, color: colors.onPrimary },
});
