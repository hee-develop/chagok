import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, useFont } from '../../ui/theme';

type Props = {
  testID: string;
  /** 13:00 */
  time: string;
  /** 오늘이 아닌 일정이면 날짜도 보인다. */
  day?: string;
  title: string;
  /** 장소 이름·'장소 없음'·'이동 없음 · 온라인 회의' 같은 상태 글자(색만으로 전달하지 않는다). */
  status: string;
  /** 장소가 비어 있어 눈에 띄게(경고 색) 보이는 상태. */
  attention?: boolean;
  /** 이동 없음처럼 흐린 줄. opacity가 아니라 글자·배경 색을 낮춰 글자 대비 4.5:1 이상을 지킨다. */
  dimmed?: boolean;
  /** 채비 한 줄(접혀 있을 때만 줄 아래에 보인다). */
  extra?: string;
  /** 스크린리더가 읽는 이름(제목·시간·상태). 동작 안내는 hint로 나눈다. */
  accessibilityLabel: string;
  accessibilityHint: string;
  /** 펼침 상태. 주면 줄 끝에 ▴/▾ 표시와 expanded 상태를 붙인다. */
  expanded?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/** 오늘 탭 일정 한 줄의 머리(시간·제목·상태). 서버가 아는 일정 줄과 폰이 거른 일정 줄이 같이 쓴다. */
export function ScheduleHead({
  testID, time, day, title, status, attention = false, dimmed = false, extra, accessibilityLabel, accessibilityHint, expanded, disabled = false, onPress,
}: Props) {
  const font = useFont();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
      accessibilityState={expanded === undefined ? { disabled } : { expanded, disabled }} disabled={disabled} onPress={onPress}
      testID={testID} style={[styles.head, dimmed && styles.dimmedHead]}>
      <View style={styles.time}>
        <Text style={[styles.timeText, font(600), dimmed && styles.dimmedTitle]}>{time}</Text>
        {day ? <Text style={[styles.day, font(400)]}>{day}</Text> : null}
      </View>
      <View style={styles.main}>
        <Text style={[styles.title, font(600), dimmed && styles.dimmedTitle]}>{title}</Text>
        <Text style={[styles.status, font(400), dimmed && styles.dimmedStatus, attention && styles.attention]}>{status}</Text>
        {extra ? <Text style={[styles.status, font(400)]} numberOfLines={1}>{extra}</Text> : null}
      </View>
      {expanded === undefined ? null : (
        <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.chevron, font(400)]}>{expanded ? '▴' : '▾'}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { minHeight: 64, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  dimmedHead: { backgroundColor: colors.notice },
  time: { minWidth: 52, gap: 2 },
  timeText: { fontSize: 16, color: colors.text },
  day: { fontSize: 12, color: colors.textMuted },
  main: { flex: 1, gap: 2 },
  title: { fontSize: 17, color: colors.text },
  dimmedTitle: { color: colors.textMuted },
  status: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  dimmedStatus: { color: colors.dimmed },
  attention: { color: colors.warning },
  chevron: { fontSize: 14, color: colors.textMuted },
});
