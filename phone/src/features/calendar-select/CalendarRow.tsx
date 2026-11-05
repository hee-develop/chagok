import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, useFont } from '../../ui/theme';
import type { DeviceCalendar } from './calendarSource';

type Props = {
  calendar: DeviceCalendar;
  checked: boolean;
  isLast: boolean;
  onToggle: (id: string) => void;
};

export function CalendarRow({ calendar, checked, isLast, onToggle }: Props) {
  const font = useFont();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${calendar.name}, ${calendar.source}`}
      onPress={() => onToggle(calendar.id)}
      style={[styles.row, !isLast && styles.divider]}
    >
      <View style={[styles.dot, { backgroundColor: calendar.color }]} />
      <View style={styles.texts}>
        <Text style={[styles.name, font(600)]}>{calendar.name}</Text>
        <Text style={[styles.source, font(400)]}>{calendar.source}</Text>
      </View>
      <View style={checked ? styles.checkOn : styles.checkOff}>
        {checked ? (
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.onPrimary} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 12.5l4.5 4.5L19 7.5" />
          </Svg>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 16 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  dot: { width: 12, height: 12, borderRadius: 6 },
  texts: { flex: 1, gap: 1 },
  name: { fontSize: 16, color: colors.text, includeFontPadding: false },
  source: { fontSize: 13, color: colors.textMuted, includeFontPadding: false },
  checkOn: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  checkOff: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.unchecked },
});
