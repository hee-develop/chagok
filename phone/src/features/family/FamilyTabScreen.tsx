import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, OutlineButton, Section } from '../../ui/blocks';
import { TabScreen } from '../../ui/TabScreen';
import { colors, useFont } from '../../ui/theme';
import type { SchedulePlacesApi } from '../fill-places/schedulePlacesApi';
import type { PermissionsSource } from '../today/permissions';
import { familyGroupApi, type FamilyGroupApi } from './familyGroupApi';
import { GroupMembersSection, GroupStartSection, ShareSection } from './FamilyGroupSection';
import { LegacySendSection } from './LegacySendSection';
import { RequestsSections } from './RequestsSection';
import { useFamilyGroup } from './useFamilyGroup';
import { useFamilyRequests } from './useFamilyRequests';

type Props = {
  scheduleApi?: SchedulePlacesApi;
  permissionsSource?: PermissionsSource;
  /** 가족 묶기·요청 API. 기본은 실제 서버(구성원 비밀값을 `expo-secure-store`에 두고 헤더로 보낸다). */
  familyApi?: FamilyGroupApi;
  timeoutMs?: number;
  /** 요청 목록을 다시 읽는 주기(밀리초). 기본은 `REQUESTS_POLL_MS`. */
  pollMs?: number;
  /** 지금 시각. 테스트가 고정한다. */
  now?: () => Date;
  /** 초대 코드를 공유 시트로 보내는 동작. 기본은 RN `Share`. */
  shareText?: (message: string) => Promise<unknown>;
};

const firstParam = (value: string | string[] | undefined) => (typeof value === 'string' && value !== '' ? value : Array.isArray(value) && typeof value[0] === 'string' && value[0] !== '' ? value[0] : null);

/**
 * 가족 탭(정책서 10.7·10.10): 가족 묶기(만들기·초대 코드·구성원·이름·나가기), 요청 보내기, 보낸·받은 요청 상태, 도착 예정 공유,
 * 그리고 일정을 미리 묶어 둔 가족에게 보내는 기존 입구(`LegacySendSection`).
 * 가족이 없으면 가족 묶기가 맨 위에 오고, 있으면 요청이 위에 온다(나 혼자뿐이면 초대 코드가 먼저). `request` 파라미터(알림 누름·오늘 탭의 받은 요청·요청을 만든 직후)가 있으면 그 요청을 목록 맨 위에 표시한다.
 * 상태: 가족 로딩·오류·가족 없음·정상과 요청 로딩·오류·빈 목록·정상을 구역마다 나눈다. 저장은 한 번에 하나만 보내고, 목록은 앱이 앞에 있는 동안 주기적으로 다시 읽는다.
 */
export function FamilyTabScreen({
  scheduleApi,
  permissionsSource,
  familyApi = familyGroupApi,
  timeoutMs = REQUEST_TIMEOUT_MS,
  pollMs,
  now,
  shareText,
}: Props) {
  const router = useRouter();
  const font = useFont();
  const t = strings.family;
  const params = useLocalSearchParams<{ request?: string | string[] }>();
  const focusId = firstParam(params.request);
  const group = useFamilyGroup({ api: familyApi, timeoutMs });
  const family = group.state.status === 'ready' ? group.state.family : null;
  const requests = useFamilyRequests({ api: familyApi, timeoutMs, intervalMs: pollMs, enabled: family !== null });
  const inFamily = family !== null;
  const solo = family !== null && family.members.length <= 1;
  // `request` 파라미터(알림 누름·오늘 탭·요청을 만든 직후)가 열린 채로 바뀌면 바로 다시 읽는다. 가리킨 요청이 새로 읽은 목록에도 없을 때만 '찾을 수 없어요'를 보인다
  // (읽기 전의 목록으로 잘못 알리지 않게, 파라미터가 바뀐 때의 읽은 횟수를 기억해 그보다 더 읽은 뒤에만 판단한다).
  const [focusBase, setFocusBase] = useState({ id: focusId, reads: requests.reads });
  if (focusBase.id !== focusId) setFocusBase({ id: focusId, reads: requests.reads });
  const { refresh } = requests;
  useEffect(() => {
    if (focusId !== null && inFamily) refresh();
  // refresh는 렌더마다 새 함수라 파라미터와 가족 유무가 바뀔 때만 다시 읽는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, inFamily]);
  const requestMissing = focusId !== null && requests.state.status === 'ready' && requests.reads > focusBase.reads
    && ![...requests.state.sent, ...requests.state.received].some((r) => r.id === focusId);
  const membersSection = family !== null ? <GroupMembersSection family={family} group={group} now={now} shareText={shareText} /> : null;

  return (
    <TabScreen title={strings.familyTab.title} description={strings.familyTab.description} testID="tab-family">
      {group.storageIssue ? <Text testID="family-storage-notice" accessibilityLiveRegion="polite" style={[styles.warning, font(600)]}>{t.storageIssue}</Text> : null}

      {family === null ? <GroupStartSection group={group} /> : null}

      {family !== null ? (
        <>
          {/* 아직 나 혼자면 보낼 사람이 없으므로 초대 코드가 먼저 보이고, 가족이 모이면 요청이 위로 올라온다. */}
          {solo ? membersSection : null}
          <Section heading={t.sendHeading} testID="family-send">
            <Card>
              <Text style={[styles.hint, font(400)]}>{t.sendHint}</Text>
              <OutlineButton label={t.sendOpen} onPress={() => router.push('/setup/family-request')} />
            </Card>
          </Section>
          {requestMissing ? <Text testID="family-request-missing" accessibilityLiveRegion="polite" style={[styles.hint, font(500)]}>{t.requestMissing}</Text> : null}
          <RequestsSections state={requests.state} focusId={focusId} onRetry={requests.retry} now={now} />
          <ShareSection family={family} group={group} />
          {solo ? null : membersSection}
        </>
      ) : null}

      <LegacySendSection scheduleApi={scheduleApi} permissionsSource={permissionsSource} timeoutMs={timeoutMs} />
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  warning: { fontSize: 15, lineHeight: 22, color: colors.warning },
});
