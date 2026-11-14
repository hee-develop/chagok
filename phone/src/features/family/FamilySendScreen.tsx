import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { familyApi, type FamilyApi, type FamilyMember } from './familyApi';

type Props = {
  scheduleId: string;
  /** 설명에 쓰는 일정 제목 */
  title: string;
  api?: FamilyApi;
  timeoutMs?: number;
};

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; members: FamilyMember[] };

/**
 * 일정 하나를 미리 묶어 둔 가족에게 보낸다. 서버가 보낼 때의 일정 내용(주소·채비 포함)을 담아 저장하면 '전달됨'이다.
 * 받는 쪽(가족의 차 브리핑·수락·완료)은 PT에서 프로토타입이다. 같은 가족에게 다시 보내면 내용을 새로 한다.
 */
export function FamilySendScreen({ scheduleId, title, api = familyApi, timeoutMs = REQUEST_TIMEOUT_MS }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.familySend;

  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  /** 이 일정을 이미 보낸 가족 id */
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [issue, setIssue] = useState<'retry' | 'reload' | null>(null);
  const request = useRef<AbortController | null>(null);
  const retryLast = useRef<(() => void) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [members, requests] = await requestWithTimeout(
          (signal) => Promise.all([api.fetchMembers(signal), api.fetchRequests(scheduleId, signal)]),
          timeoutMs,
          controller,
        );
        if (controller.signal.aborted) return;
        setSent(new Set(requests.map((r) => r.memberId)));
        setLoad({ status: 'ready', members });
      } catch {
        if (!controller.signal.aborted) setLoad({ status: 'error' });
      }
    })();
    return () => controller.abort();
  }, [api, scheduleId, timeoutMs, attempt]);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (issue) AccessibilityInfo.announceForAccessibility(issue === 'reload' ? t.scheduleChanged : t.sendFailed);
  }, [issue, t.scheduleChanged, t.sendFailed]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/setup/fill-places');
  }, [router]);

  const send = async (member: FamilyMember) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    retryLast.current = () => void send(member);
    setSendingId(member.id);
    setIssue(null);
    try {
      await requestWithTimeout((signal) => api.send(scheduleId, member.id, signal), timeoutMs, controller);
      if (request.current !== controller) return;
      setSent((prev) => new Set(prev).add(member.id));
      AccessibilityInfo.announceForAccessibility(t.deliveredTo(member.name));
    } catch (error) {
      // 4xx는 일정이 사라졌거나 선택이 바뀐 것이라 다시 보내도 같다. 일정 목록으로 돌려보낸다.
      if (request.current === controller) setIssue(isClientError(error) ? 'reload' : 'retry');
    } finally {
      if (request.current === controller) request.current = null;
      setSendingId(null);
    }
  };

  const sending = sendingId !== null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SetupHeader step={3} />
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.title, font(600)]}>{t.title}</Text>
          <Text style={[styles.description, font(400)]}>{t.description(title)}</Text>
        </View>
        {load.status === 'loading' ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t.loading} style={styles.status}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : load.status === 'error' ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Text style={[styles.error, font(500)]}>{t.loadFailed}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setLoad({ status: 'loading' }); setAttempt((n) => n + 1); }} style={styles.textButton}>
              <Text style={[styles.textButtonLabel, font(600)]}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            {load.members.map((member, index) => {
              const delivered = sent.has(member.id);
              return (
                <View key={member.id} style={[styles.row, index > 0 && styles.rowDivider]} testID={`family-${member.id}`}>
                  <Text style={[styles.name, font(500)]}>{member.name}</Text>
                  {delivered ? <Text style={[styles.delivered, font(500)]}>{`✓ ${t.delivered}`}</Text> : null}
                  {sendingId === member.id ? (
                    <View accessible accessibilityRole="progressbar" accessibilityLabel={t.sending}>
                      <ActivityIndicator color={colors.text} />
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={delivered ? t.resendTo(member.name) : t.sendTo(member.name)}
                      accessibilityState={{ disabled: sending }}
                      disabled={sending}
                      onPress={() => void send(member)}
                      style={delivered ? styles.textButton : styles.outline}
                    >
                      <Text style={[delivered ? styles.textButtonLabel : styles.outlineText, font(delivered ? 400 : 600)]}>
                        {delivered ? t.resend : t.send}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {issue ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Text style={[styles.error, font(500)]}>{issue === 'reload' ? t.scheduleChanged : t.sendFailed}</Text>
            <Pressable accessibilityRole="button" onPress={() => (issue === 'reload' ? goBack() : retryLast.current?.())} style={styles.textButton}>
              <Text style={[styles.textButtonLabel, font(600)]}>{issue === 'reload' ? t.backToSchedules : t.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: sending }} disabled={sending} onPress={goBack}
          style={[styles.primary, sending && styles.disabled]}>
          <Text style={[styles.primaryText, font(600)]}>{t.done}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 16, gap: 22 },
  titles: { gap: 10 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
  description: { fontSize: 16, lineHeight: 24, color: colors.textStrong },
  card: { borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { flex: 1, fontSize: 17, color: colors.text },
  delivered: { fontSize: 15, color: colors.textStrong },
  outline: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  outlineText: { fontSize: 15, color: colors.text },
  status: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 8 },
  error: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  primary: { height: 56, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  disabled: { opacity: 0.4 },
});
