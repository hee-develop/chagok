import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, ErrorBlock, LoadingBlock, OutlineButton, Section } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { familyGroupApi, type FamilyGroupApi } from './familyGroupApi';
import { receivedStatusLabel, receivedTitle, requestSummary, type ReceivedRequest } from './requestModel';
import { useFamilyRequests } from './useFamilyRequests';

/** 오늘 탭에 보이는 받은 요청 수. 나머지는 가족 탭으로 보낸다. */
const MAX_SHOWN = 3;

const isOpen = (r: ReceivedRequest) => r.status !== 'completed' && r.status !== 'declined';

/**
 * 오늘 탭의 '받은 가족 요청'(정책서 10.7): 받은 요청을 간단히 보이고, 누르면 가족 탭의 그 요청으로 간다. 받는 사람 폰에는 알림을 보내지 않으므로(정책서 10.6) 이 화면 표시가 전부다.
 * 진행 중인 요청을 먼저, 끝난 요청은 그 뒤에 보인다. 상태: 로딩·오류(다시 시도)·빈 목록·정상. 가족이 없으면 빈 목록과 같다.
 */
export function ReceivedRequestsSection({ api = familyGroupApi, timeoutMs = REQUEST_TIMEOUT_MS, now = () => new Date() }: { api?: FamilyGroupApi; timeoutMs?: number; now?: () => Date }) {
  const router = useRouter();
  const font = useFont();
  const t = strings.today;
  const { state, retry } = useFamilyRequests({ api, timeoutMs });
  const open = (request?: string) => router.navigate(request === undefined ? '/family' : { pathname: '/family', params: { request } });

  const received = state.status === 'ready' ? [...state.received.filter(isOpen), ...state.received.filter((r) => !isOpen(r))] : [];
  const shown = received.slice(0, MAX_SHOWN);
  const at = now();

  return (
    <Section heading={t.inboxHeading} testID="family-inbox">
      {state.status === 'loading' ? (
        <LoadingBlock label={t.inboxLoading} />
      ) : state.status === 'error' ? (
        <ErrorBlock message={t.inboxLoadFailed} retryLabel={t.retry} onRetry={retry} />
      ) : shown.length === 0 ? (
        <Card>
          <Text style={[styles.title, font(500)]}>{t.inboxEmpty}</Text>
          <Text style={[styles.hint, font(400)]}>{t.inboxHint}</Text>
        </Card>
      ) : (
        <>
          {shown.map((r) => {
            const summary = requestSummary(r, at);
            return (
              <Pressable key={r.id} testID={`inbox-request-${r.id}`} accessibilityRole="button" accessibilityLabel={t.inboxRowLabel(r.from.name, strings.family.category[r.category], summary)}
                accessibilityHint={t.inboxRowHint} onPress={() => open(r.id)} style={styles.row}>
                <Text style={[styles.title, font(600)]}>{receivedTitle(r)}</Text>
                <Text style={[styles.summary, font(400)]}>{summary}</Text>
                <Text style={[styles.status, font(500)]}>{receivedStatusLabel(r)}</Text>
              </Pressable>
            );
          })}
          {received.length > shown.length ? <OutlineButton label={t.inboxMore(received.length - shown.length)} onPress={() => open()} /> : null}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 3 },
  title: { fontSize: 16, lineHeight: 22, color: colors.text },
  summary: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  status: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  hint: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
});
