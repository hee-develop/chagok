import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';
import type { TravelMarkIssue } from './useTravelMark';

type Props = {
  /** 방금 바꾼 일정 이름. 있으면 '되돌리기'를 보인다. */
  undoable: { title: string } | null;
  issue: TravelMarkIssue | null;
  disabled: boolean;
  onUndo: () => void;
};

/** "이동 일정이에요"로 바꾼 직후의 '되돌리기'와, 바꾸기·되돌리기가 차에 반영되지 못했을 때의 안내. 보일 것이 없으면 아무것도 그리지 않는다. */
export function TravelMarkNotice({ undoable, issue, disabled, onUndo }: Props) {
  const font = useFont();
  const t = strings.travelFilter;
  if (!undoable && !issue) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.box}>
      {issue ? <Text style={[styles.error, font(500)]}>{issue === 'mark' ? t.markFailed : t.undoFailed}</Text> : null}
      {undoable ? (
        <View style={styles.row}>
          <Text style={[styles.text, font(400)]}>{t.changed(undoable.title)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${undoable.title} ${t.undo}`} accessibilityState={{ disabled }}
            disabled={disabled} onPress={onUndo} style={styles.button}>
            <Text style={[styles.buttonText, font(600)]}>{t.undo}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: colors.notice },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.text },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  button: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, color: colors.text },
});
