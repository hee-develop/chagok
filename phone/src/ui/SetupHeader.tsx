import { StyleSheet, Text, View } from 'react-native';

import { strings } from '../i18n/ko';
import { Logo } from './Logo';
import { colors, useFont } from './theme';

/** 캘린더 → 자주 가는 곳 → 장소 빈 일정 → 말 거는 방법 → 차 연결(정책서 10.7). */
export const SETUP_TOTAL_STEPS = 5;

/** step을 주지 않으면 첫 설정 밖(탭에서 연 화면)이라 로고만 보인다. */
export function SetupHeader({ step }: { step?: number }) {
  const font = useFont();
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Logo label={strings.setup.logoLabel} />
        {step === undefined ? null : <Text style={[styles.count, font(400)]}>{strings.setup.stepOf(step, SETUP_TOTAL_STEPS)}</Text>}
      </View>
      {step === undefined ? null : <View style={styles.bars}>
        {Array.from({ length: SETUP_TOTAL_STEPS }, (_, i) => (
          <View
            key={i}
            testID={i < step ? 'progress-bar-filled' : 'progress-bar-empty'}
            style={[styles.bar, { backgroundColor: i < step ? colors.text : colors.border }]}
          />
        ))}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 22 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 14, color: colors.textMuted },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
});
