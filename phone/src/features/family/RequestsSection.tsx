import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { Card, EmptyText, ErrorBlock, LoadingBlock, Section } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { receivedStatusLabel, receivedTitle, requestSummary, senderStatusLabel, sentTitle, type ReceivedRequest, type SentRequest } from './requestModel';
import type { RequestsState } from './useFamilyRequests';

const t = strings.family;

/** 골라 둔 요청(알림·오늘 탭에서 연 것)을 목록 맨 위로. */
const focusedFirst = <T extends { id: string }>(items: T[], focusId: string | null): T[] =>
  focusId === null ? items : [...items.filter((i) => i.id === focusId), ...items.filter((i) => i.id !== focusId)];

function RequestRow({ id, title, summary, memo, status, note, focused }: { id: string; title: string; summary: string; memo: string | null; status: string; note?: string; focused: boolean }) {
  const font = useFont();
  return (
    <View testID={`family-request-${id}`} accessible accessibilityLabel={t.rowLabel(title, summary, status)} style={[styles.row, focused && styles.rowFocused]}>
      {focused ? <Text style={[styles.tag, font(600)]}>{t.requestFocused}</Text> : null}
      <Text style={[styles.title, font(600)]}>{title}</Text>
      <Text style={[styles.summary, font(400)]}>{summary}</Text>
      {memo !== null ? <Text style={[styles.memo, font(400)]}>{t.memoLine(memo)}</Text> : null}
      <Text testID={`family-request-status-${id}`} style={[styles.status, font(600)]}>{status}</Text>
      {note ? <Text style={[styles.memo, font(400)]}>{note}</Text> : null}
    </View>
  );
}

/**
 * 보낸 요청과 받은 요청(정책서 10.10 '보낸 사람 폰 상태', 10.7 '보낸·받은 요청 상태'). 보낸 쪽 문구는 `senderStatusLabel`의 표, 받은 쪽은 목록에서만 보인다(받는 사람 폰에는 알림이 없다).
 * 상태: 로딩·오류(다시 시도)·빈 목록·정상. `focusId`인 요청은 맨 위에 테두리로 표시한다.
 */
export function RequestsSections({ state, focusId, onRetry, now = () => new Date() }: { state: RequestsState; focusId: string | null; onRetry: () => void; now?: () => Date }) {
  const font = useFont();
  const at = now();
  const sent = state.status === 'ready' ? focusedFirst<SentRequest>(state.sent, focusId) : [];
  const received = state.status === 'ready' ? focusedFirst<ReceivedRequest>(state.received, focusId) : [];

  const body = (empty: string, rows: ReactNode, count: number) =>
    state.status === 'loading' ? <LoadingBlock label={t.requestsLoading} />
      : state.status === 'error' ? <ErrorBlock message={t.requestsLoadFailed} retryLabel={t.retry} onRetry={onRetry} />
        : count === 0 ? <EmptyText>{empty}</EmptyText>
          : <Card>{rows}</Card>;

  return (
    <>
      <Section heading={t.sentHeading} testID="family-sent-requests">
        {body(t.sentEmpty, sent.map((r) => (
          <RequestRow key={r.id} id={r.id} title={sentTitle(r)} summary={requestSummary(r, at)} memo={r.memo} status={senderStatusLabel(r)} focused={r.id === focusId} />
        )), sent.length)}
      </Section>
      <Section heading={t.receivedHeading} testID="family-received-requests">
        {body(t.receivedEmpty, received.map((r) => (
          <RequestRow key={r.id} id={r.id} title={receivedTitle(r)} summary={requestSummary(r, at)} memo={r.memo} status={receivedStatusLabel(r)} focused={r.id === focusId} />
        )), received.length)}
        {state.status === 'ready' ? <Text style={[styles.hint, font(400)]}>{t.receivedHint}</Text> : null}
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: 3, paddingVertical: 4 },
  rowFocused: { borderWidth: 1.5, borderColor: colors.text, borderRadius: 12, padding: 10 },
  tag: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  title: { fontSize: 16, lineHeight: 22, color: colors.text },
  summary: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  memo: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  status: { fontSize: 15, lineHeight: 22, color: colors.text },
  hint: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
});
