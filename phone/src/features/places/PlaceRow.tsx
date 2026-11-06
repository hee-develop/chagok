import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors, useFont } from '../../ui/theme';

export type PlaceIconName = 'home' | 'work' | 'pin';

type Props = {
  icon: PlaceIconName;
  title: string;
  subtitle: string;
  isLast: boolean;
  /** 스크린 리더가 읽는 문장. 없으면 `제목, 보조 글`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  /** 없으면 눌리지 않는 줄이고 화살표도 그리지 않는다. */
  onPress?: () => void;
};

function Icon({ name }: { name: PlaceIconName }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {name === 'home' ? (
        <>
          <Path d="M3 11l9-7 9 7" />
          <Path d="M5 10v10h14V10" />
        </>
      ) : name === 'work' ? (
        <>
          <Rect x={4} y={7} width={16} height={13} rx={2} />
          <Path d="M9 7V4h6v3" />
        </>
      ) : (
        <>
          <Path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" />
          <Circle cx={12} cy={10} r={2.5} />
        </>
      )}
    </Svg>
  );
}

export function PlaceRow({ icon, title, subtitle, isLast, accessibilityLabel, accessibilityHint, disabled = false, onPress }: Props) {
  const font = useFont();
  const body = (
    <>
      <Icon name={icon} />
      <View style={styles.texts}>
        <Text style={[styles.title, font(600)]}>{title}</Text>
        <Text style={[styles.subtitle, font(400)]}>{subtitle}</Text>
      </View>
      {onPress ? (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.unchecked} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M9 6l6 6-6 6" />
        </Svg>
      ) : null}
    </>
  );
  const rowStyle = [styles.row, !isLast && styles.divider];
  const label = accessibilityLabel ?? `${title}, ${subtitle}`;
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={rowStyle}
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label} style={rowStyle}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 8, paddingHorizontal: 16 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 16, color: colors.text, includeFontPadding: false },
  subtitle: { fontSize: 14, color: colors.textMuted, includeFontPadding: false },
});
