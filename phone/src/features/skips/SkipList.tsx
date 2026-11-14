import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';
import { useSkips, type UseSkipsOptions } from './useSkips';

/**
 * '이동 없음으로 기억한 일정' 목록: 보기·지우기(정책서 10.8). 같은 이름 일정은 앞으로 차에 보내지 않고, 지우면 다시 보낸다.
 * 아래 탭의 장소 탭이 이 컴포넌트를 그대로 붙인다(자체로 목록을 받아 오고 서버와 맞춘다).
 */
export function SkipList(options: UseSkipsOptions = {}) {
  const font = useFont();
  const t = strings.skips;
  const { skips, status, stale, busy, removeFailed, remove, refresh, full, dismissFull } = useSkips(options);
  return (
    <View style={styles.box} testID="skip-list">
      <Text accessibilityRole="header" style={[styles.title, font(600)]}>{t.title}</Text>
      <Text style={[styles.description, font(400)]}>{t.description}</Text>
      {status === 'loading' && skips.length === 0 ? (
        <View accessibilityLiveRegion="polite" style={styles.row}>
          <ActivityIndicator />
          <Text style={[styles.text, font(400)]}>{t.loading}</Text>
        </View>
      ) : null}
      {stale && status === 'ready' ? (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={[styles.text, font(400)]}>{t.loadFailed}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t.retry} onPress={() => void refresh()} style={styles.button}>
            <Text style={[styles.buttonText, font(600)]}>{t.retry}</Text>
          </Pressable>
        </View>
      ) : null}
      {full ? (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={[styles.text, font(400)]}>{t.full}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t.fullDismiss} onPress={dismissFull} style={styles.button}>
            <Text style={[styles.buttonText, font(600)]}>{t.fullDismiss}</Text>
          </Pressable>
        </View>
      ) : null}
      {removeFailed ? <Text accessibilityLiveRegion="polite" style={[styles.error, font(500)]}>{t.removeFailed}</Text> : null}
      {status === 'ready' && skips.length === 0 ? <Text style={[styles.text, font(400)]}>{t.empty}</Text> : null}
      {skips.map((skip) => (
        <View key={skip.name} style={styles.card} testID={`skip-${skip.name}`}>
          <View style={styles.cardText}>
            <Text style={[styles.name, font(600)]}>{skip.name}</Text>
            {skip.addedAt === null ? <Text style={[styles.hint, font(400)]}>{t.notSynced}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t.removeLabel(skip.name)} accessibilityState={{ disabled: busy }}
            disabled={busy} onPress={() => void remove(skip.name)} style={styles.button}>
            <Text style={[styles.buttonText, font(600)]}>{t.remove}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  title: { fontSize: 18, color: colors.text },
  description: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.textStrong },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.notice },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  cardText: { flex: 1, gap: 2 },
  name: { fontSize: 17, color: colors.text },
  hint: { fontSize: 14, color: colors.textMuted },
  button: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, color: colors.text },
});
