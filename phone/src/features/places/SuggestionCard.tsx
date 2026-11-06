import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';

type Props = {
  name: string;
  hint: string;
  busy: boolean;
  disabled: boolean;
  onAdd: () => void;
};

export function SuggestionCard({ name, hint, busy, disabled, onAdd }: Props) {
  const font = useFont();
  return (
    <View style={styles.card}>
      <View style={styles.texts}>
        <Text style={[styles.name, font(600)]}>{name}</Text>
        <Text style={[styles.hint, font(400)]}>{hint}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.places.addLabel(name)}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onAdd}
        style={styles.add}
      >
        {busy ? <ActivityIndicator color={colors.text} /> : <Text style={[styles.addText, font(600)]}>{strings.places.add}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  texts: { flex: 1, gap: 2 },
  name: { fontSize: 16, color: colors.text, includeFontPadding: false },
  hint: { fontSize: 14, color: colors.textMuted, includeFontPadding: false },
  add: { minWidth: 64, height: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 15, color: colors.text },
});
