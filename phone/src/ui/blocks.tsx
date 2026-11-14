import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, useFont } from './theme';

/** 탭 화면의 구역: 제목 한 줄과 내용. */
export function Section({ heading, children, testID }: { heading: string; children: ReactNode; testID?: string }) {
  const font = useFont();
  return (
    <View testID={testID} style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, font(600)]}>{heading}</Text>
      {children}
    </View>
  );
}

export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  return <View testID={testID} style={styles.card}>{children}</View>;
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.status}>
      <ActivityIndicator color={colors.text} />
    </View>
  );
}

export function ErrorBlock({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  const font = useFont();
  return (
    <View style={styles.status} accessibilityLiveRegion="polite">
      <Text style={[styles.error, font(500)]}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.textButton}>
        <Text style={[styles.textButtonLabel, font(600)]}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

export function EmptyText({ children, testID }: { children: string; testID?: string }) {
  const font = useFont();
  return <Text testID={testID} style={[styles.empty, font(400)]}>{children}</Text>;
}

export function OutlineButton({ label, accessibilityLabel, onPress, disabled }: { label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean }) {
  const font = useFont();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress} style={[styles.outline, disabled && styles.disabled]}>
      <Text style={[styles.outlineText, font(600)]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { fontSize: 18, lineHeight: 26, color: colors.text },
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 12 },
  status: { minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 8 },
  error: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted },
  empty: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  outline: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  outlineText: { fontSize: 15, color: colors.text },
  disabled: { opacity: 0.4 },
});
