import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';
import { TravelMarkNotice } from '../calendar-sync/TravelMarkNotice';
import type { SkipNotice } from './useSchedulePlaces';

type Props = {
  notice: SkipNotice | null;
  /** 서버가 기억 상한이라며 이름 기억을 거절했다. */
  full: boolean;
  disabled: boolean;
  onUndo: () => void;
  onDismissFull: () => void;
};

/**
 * 일정에 [이동 없음]을 고른 직후의 안내('같은 이름 일정을 앞으로 차에 보내지 않아요')와 10초 [되돌리기]. 3단계와 오늘 탭이 같이 쓴다(`useSchedulePlaces`의 `skipNotice`).
 * 서버가 이름 기억을 상한이라며 거절하면 그 안내는 맞지 않으므로 '가득 찼어요'와 [확인]만 보인다.
 */
export function NoTravelNotices({ notice, full, disabled, onUndo, onDismissFull }: Props) {
  const font = useFont();
  if (full) {
    return (
      <View testID="skips-full-notice" accessibilityLiveRegion="polite" style={styles.full}>
        <Text style={[styles.fullText, font(400)]}>{strings.skips.full}</Text>
        <Pressable accessibilityRole="button" onPress={onDismissFull} style={styles.button}>
          <Text style={[styles.buttonText, font(600)]}>{strings.skips.fullDismiss}</Text>
        </Pressable>
      </View>
    );
  }
  return <TravelMarkNotice undoable={notice} issue={null} disabled={disabled} onUndo={onUndo} message={strings.fillPlaces.noTravelRemembered} />;
}

const styles = StyleSheet.create({
  full: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.notice },
  fullText: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.text },
  button: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, color: colors.textMuted },
});
