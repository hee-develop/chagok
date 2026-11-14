import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, useFont } from '../../ui/theme';

type Props = {
  testID: string;
  label: string;
  /** 줄 아래에 보이는 설명(상태에 따라 바뀐다). */
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  /** 설명 아래에 더하는 것(권한 안내 같은). */
  children?: ReactNode;
};

/**
 * 설정 스위치 한 줄. 줄 전체가 하나의 스위치(accessibilityRole="switch")라 글자를 눌러도 바뀌고 터치 영역이 48dp 이상이다.
 * 안쪽 Switch는 겉모양만이다(스크린리더에는 줄이 읽힌다).
 */
export function SettingSwitchRow({ testID, label, hint, value, disabled, onChange, children }: Props) {
  const font = useFont();
  return (
    <View style={styles.wrap}>
      <Pressable
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value, disabled: !!disabled }}
        disabled={disabled}
        onPress={() => onChange(!value)}
        style={styles.row}
      >
        <View style={styles.text}>
          <Text style={[styles.label, font(600)]}>{label}</Text>
          <Text style={[styles.hint, font(400)]}>{hint}</Text>
        </View>
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Switch
            value={value}
            disabled={disabled}
            trackColor={{ false: '#bdbdbd', true: colors.primary }}
            thumbColor="#ffffff"
          />
        </View>
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 17, lineHeight: 24, color: colors.text },
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
});
