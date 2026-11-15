import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { OutlineButton } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { pairingApi, type PairingApi } from '../pair-car/pairingApi';

type Props = {
  api?: Pick<PairingApi, 'disconnect'>;
  timeoutMs?: number;
  /** 끊기에 성공한 뒤 부른다(연결 상태·설정을 다시 읽는다). */
  onDisconnected: () => void;
};

/**
 * 차 연결 끊기(정책서 10.9). 확인을 거친 뒤 `DELETE /pair`로 이 폰의 자리를 지운다: 서버의 연결·일정·기억을 바로 삭제하고 차 화면 목록에서도 빠진다.
 * 성공하면(서버가 이미 모르는 401도 끊긴 것과 같다) 폰은 토큰을 버리고 연결 전 상태로 돌아간다. 실패하면 문구와 [다시 시도]를 보이고 연결은 그대로다.
 * 포커스를 잃어도 진행 중인 요청은 끝까지 보낸다(언마운트 때만 취소).
 */
export function DisconnectSection({ api = pairingApi, timeoutMs = REQUEST_TIMEOUT_MS, onDisconnected }: Props) {
  const font = useFont();
  const t = strings.settings.disconnect;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (failed) AccessibilityInfo.announceForAccessibility(t.failed);
  }, [failed, t]);

  const disconnect = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      await requestWithTimeout((signal) => api.disconnect(signal), timeoutMs, controller);
      if (request.current !== controller) return;
      setConfirming(false);
      onDisconnected();
    } catch {
      if (request.current === controller) setFailed(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  if (!confirming) {
    return (
      <View testID="disconnect-section" style={styles.wrap}>
        <OutlineButton label={t.button} onPress={() => { setFailed(false); setConfirming(true); }} />
      </View>
    );
  }
  return (
    <View testID="disconnect-section" accessibilityLiveRegion="polite" style={styles.confirmBox}>
      <Text style={[styles.question, font(600)]}>{t.question}</Text>
      <Text style={[styles.explain, font(400)]}>{t.explain}</Text>
      {failed ? <Text testID="disconnect-failed" style={[styles.error, font(500)]}>{t.failed}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.cancel} accessibilityState={{ disabled: busy }} disabled={busy}
          onPress={() => { setConfirming(false); setFailed(false); }} style={styles.textButton}>
          <Text style={[styles.textButtonLabel, font(400)]}>{t.cancel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={failed ? t.retry : t.confirmLabel} accessibilityState={{ disabled: busy }} disabled={busy}
          onPress={() => void disconnect()} style={styles.danger}>
          <Text style={[styles.dangerText, font(600)]}>{busy ? t.disconnecting : failed ? t.retry : t.confirm}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  confirmBox: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  question: { fontSize: 16, lineHeight: 24, color: colors.text },
  explain: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted },
  danger: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dangerText: { fontSize: 15, color: colors.onPrimary },
});
