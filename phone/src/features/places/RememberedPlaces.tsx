import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { ErrorBlock, LoadingBlock } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { placeMemoryApi, type PlaceMemory, type PlaceMemoryApi } from './memoryApi';

type Props = { api?: PlaceMemoryApi; timeoutMs?: number };

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; memories: PlaceMemory[] };

/**
 * 장소 탭의 '기억한 장소'(정책서 10.8 '기억한 장소 지우기'). 차가 '다음부터 여기로 기억할게요'로 저장한 '이름 → 장소'를 최근에 쓴 것부터 보이고 하나씩 지운다.
 * - 화면이 포커스를 얻을 때마다 다시 읽는다. 이미 읽은 목록은 다시 읽는 동안 그대로 둔다. 늦게 온 이전 응답은 버린다.
 * - 지우기는 한 번에 하나고 확인('지울까요?')을 거친다. 이미 없으면(404) 지운 것과 같다. 포커스를 잃어도 진행 중인 지우기는 끝까지 보낸다(언마운트 때만 취소).
 * - 상태: 로딩·오류([다시 시도])·빈 목록·정상. 권한 거부는 해당 없음(서버 API만 쓴다).
 */
export function RememberedPlaces({ api = placeMemoryApi, timeoutMs = REQUEST_TIMEOUT_MS }: Props) {
  const font = useFont();
  const t = strings.rememberedPlaces;
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [issue, setIssue] = useState<{ name: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRequest = useRef<AbortController | null>(null);
  const deleteRequest = useRef<AbortController | null>(null);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    void requestWithTimeout((signal) => api.fetchMemories(signal), timeoutMs, controller).then(
      (memories) => { if (loadRequest.current === controller) setLoad({ status: 'ready', memories }); },
      () => { if (loadRequest.current === controller) setLoad({ status: 'error' }); },
    );
    return () => {
      loadRequest.current = null;
      controller.abort();
    };
  // attempt는 [다시 시도]로 포커스 조회를 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, timeoutMs, attempt]));

  useEffect(() => () => {
    deleteRequest.current?.abort();
    deleteRequest.current = null;
  }, []);

  useEffect(() => {
    if (issue) AccessibilityInfo.announceForAccessibility(t.deleteFailed(issue.name));
  }, [issue, t]);

  const remove = async (name: string) => {
    if (deleteRequest.current) return;
    // 지우는 동안 이전 조회가 끝나 방금 지운 줄을 되살리지 않도록 조회를 취소한다.
    loadRequest.current?.abort();
    loadRequest.current = null;
    const controller = new AbortController();
    deleteRequest.current = controller;
    setDeleting(name);
    setIssue(null);
    try {
      // 이미 없으면(false) 지운 것과 같다.
      await requestWithTimeout((signal) => api.deleteMemory(name, signal), timeoutMs, controller);
      if (deleteRequest.current !== controller) return;
      setConfirming(null);
      setLoad((prev) => (prev.status === 'ready' ? { status: 'ready', memories: prev.memories.filter((m) => m.name !== name) } : prev));
    } catch {
      if (deleteRequest.current === controller) setIssue({ name });
    } finally {
      if (deleteRequest.current === controller) {
        deleteRequest.current = null;
        setDeleting(null);
      }
    }
  };

  return (
    <View style={styles.section} testID="places-tab-remembered">
      <Text accessibilityRole="header" style={[styles.heading, font(600)]}>{strings.placesTab.remembered}</Text>
      {load.status === 'loading' ? (
        <LoadingBlock label={t.loading} />
      ) : load.status === 'error' ? (
        <ErrorBlock message={t.loadFailed} retryLabel={t.retry} onRetry={() => setAttempt((n) => n + 1)} />
      ) : load.memories.length === 0 ? (
        <Text testID="remembered-empty" style={[styles.empty, font(400)]}>{strings.placesTab.rememberedEmpty}</Text>
      ) : (
        <View style={styles.list}>
          {load.memories.map((memory) => (
            <View key={memory.name} testID={`remembered-${memory.name}`} style={styles.card}>
              <View style={styles.text}>
                <Text style={[styles.name, font(600)]}>{memory.name}</Text>
                <Text style={[styles.place, font(400)]}>{memory.place.address ? `${memory.place.name} · ${memory.place.address}` : memory.place.name}</Text>
                {memory.ambiguous ? <Text style={[styles.note, font(400)]}>{t.ambiguous}</Text> : null}
              </View>
              {confirming === memory.name ? (
                <View accessibilityLiveRegion="polite" style={styles.confirmBox}>
                  <Text style={[styles.question, font(600)]}>{t.confirmQuestion(memory.name)}</Text>
                  <View style={styles.confirmActions}>
                    <Pressable accessibilityRole="button" accessibilityLabel={t.cancel} accessibilityState={{ disabled: deleting !== null }}
                      disabled={deleting !== null} onPress={() => { setConfirming(null); setIssue(null); }} style={styles.textButton}>
                      <Text style={[styles.textButtonLabel, font(400)]}>{t.cancel}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t.confirmDeleteLabel(memory.name)} accessibilityState={{ disabled: deleting !== null }}
                      disabled={deleting !== null} onPress={() => void remove(memory.name)} style={styles.danger}>
                      <Text style={[styles.dangerText, font(600)]}>{deleting === memory.name ? t.deleting : t.confirmDelete}</Text>
                    </Pressable>
                  </View>
                  {issue?.name === memory.name ? <Text style={[styles.error, font(500)]}>{t.deleteFailed(memory.name)}</Text> : null}
                </View>
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={t.deleteLabel(memory.name)} accessibilityState={{ disabled: deleting !== null }}
                  disabled={deleting !== null} onPress={() => { setIssue(null); setConfirming(memory.name); }} style={styles.textButton}>
                  <Text style={[styles.textButtonLabel, font(600)]}>{t.delete}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { fontSize: 18, lineHeight: 26, color: colors.text },
  empty: { fontSize: 15, lineHeight: 22, color: colors.textMuted },
  list: { gap: 10 },
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 8 },
  text: { gap: 2 },
  name: { fontSize: 16, lineHeight: 22, color: colors.text },
  place: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  note: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignSelf: 'flex-end', alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted },
  confirmBox: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  question: { fontSize: 15, lineHeight: 22, color: colors.text },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  danger: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dangerText: { fontSize: 15, color: colors.onPrimary },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
});
