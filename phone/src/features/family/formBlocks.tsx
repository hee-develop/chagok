import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, useFont } from '../../ui/theme';

/** 가족 탭·요청 만들기가 같이 쓰는 작은 입력 조각. 터치 영역은 44 이상으로 둔다. */

export function PrimaryButton({ label, accessibilityLabel, onPress, disabled, testID }: { label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const font = useFont();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress} style={[styles.primary, disabled && styles.primaryDisabled]}>
      <Text style={[styles.primaryText, font(600)]}>{label}</Text>
    </Pressable>
  );
}

export function TextButton({ label, accessibilityLabel, onPress, disabled, testID }: { label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const font = useFont();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress} style={styles.textButton}>
      <Text style={[styles.textButtonLabel, font(600)]}>{label}</Text>
    </Pressable>
  );
}

/** 여러 선택지 중 하나를 고르는 버튼(라디오). 고른 것은 `selected`로 스크린리더에도 알린다. */
export function Choice({ label, detail, selected, onPress, testID, accessibilityLabel }: { label: string; detail?: string; selected: boolean; onPress: () => void; testID?: string; accessibilityLabel?: string }) {
  const font = useFont();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected, checked: selected }}
      onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
      <Text style={[styles.choiceLabel, font(selected ? 600 : 500), selected && styles.choiceLabelSelected]}>{label}</Text>
      {detail ? <Text style={[styles.choiceDetail, font(400), selected && styles.choiceDetailSelected]}>{detail}</Text> : null}
    </Pressable>
  );
}

/** 라벨·입력·힌트·오류를 한 묶음으로. 오류는 스크린리더가 바로 읽는다. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const font = useFont();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, font(600)]}>{label}</Text>
      {children}
      {hint ? <Text style={[styles.hint, font(400)]}>{hint}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, font(500)]}>{error}</Text> : null}
    </View>
  );
}

export function Input(props: TextInputProps & { invalid?: boolean }) {
  const font = useFont();
  const { invalid, style, ...rest } = props;
  return <TextInput placeholderTextColor={colors.unchecked} style={[styles.input, font(400), invalid && styles.inputInvalid, style]} {...rest} />;
}

const styles = StyleSheet.create({
  primary: { minHeight: 52, paddingHorizontal: 20, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: colors.primaryDisabled },
  primaryText: { fontSize: 16, color: colors.onPrimary },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted, textDecorationLine: 'underline' },
  choice: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, gap: 2, justifyContent: 'center' },
  choiceSelected: { borderColor: colors.text, backgroundColor: colors.primary },
  choiceLabel: { fontSize: 15, lineHeight: 21, color: colors.text },
  choiceLabelSelected: { color: colors.onPrimary },
  choiceDetail: { fontSize: 13, lineHeight: 18, color: colors.textMuted },
  choiceDetailSelected: { color: '#e6e6e6' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 15, lineHeight: 22, color: colors.text },
  hint: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  error: { fontSize: 13, lineHeight: 19, color: colors.error },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, fontSize: 16, color: colors.text },
  inputInvalid: { borderColor: colors.error, borderWidth: 1.5 },
});
