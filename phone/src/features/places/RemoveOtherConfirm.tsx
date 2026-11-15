import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';

type Props = { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void };

/** 단골 삭제 확인(정책서 10.8). 지우면 "어디로 갈까요?" 후보에서 빠진다. 지우는 동안 버튼을 막는다. */
export function RemoveOtherConfirm({ name, busy, onCancel, onConfirm }: Props) {
  const font = useFont();
  const t = strings.places.removeOther;
  return (
    <View accessibilityLiveRegion="polite" testID="remove-other-confirm" style={styles.box}>
      <Text style={[styles.question, font(600)]}>{t.confirmQuestion(name)}</Text>
      <Text style={[styles.hint, font(400)]}>{t.confirmHint}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.cancel} accessibilityState={{ disabled: busy }} disabled={busy} onPress={onCancel} style={styles.textButton}>
          <Text style={[styles.textButtonLabel, font(400)]}>{t.cancel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t.confirmDeleteLabel(name)} accessibilityState={{ disabled: busy }} disabled={busy} onPress={onConfirm} style={styles.danger}>
          <Text style={[styles.dangerText, font(600)]}>{busy ? t.deleting : t.confirmDelete}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.notice },
  question: { fontSize: 15, lineHeight: 22, color: colors.text },
  hint: { fontSize: 14, lineHeight: 20, color: colors.textStrong },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted },
  danger: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dangerText: { fontSize: 15, color: colors.onPrimary },
});
