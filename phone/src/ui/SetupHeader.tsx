import { StyleSheet, Text, View } from 'react-native';

import { strings } from '../i18n/ko';
import { Logo } from './Logo';
import { colors, useFont } from './theme';

export const SETUP_TOTAL_STEPS = 4;

export function SetupHeader({ step }: { step: number }) {
  const font = useFont();
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Logo label={strings.setup.logoLabel} />
        <Text style={[styles.count, font(400)]}>{strings.setup.stepOf(step, SETUP_TOTAL_STEPS)}</Text>
      </View>
      <View style={styles.bars}>
        {Array.from({ length: SETUP_TOTAL_STEPS }, (_, i) => (
          <View
            key={i}
            testID={i < step ? 'progress-bar-filled' : 'progress-bar-empty'}
            style={[styles.bar, { backgroundColor: i < step ? colors.text : colors.border }]}
          />
        ))}
      </View>
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
