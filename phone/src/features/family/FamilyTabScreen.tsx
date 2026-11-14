import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, EmptyText, ErrorBlock, LoadingBlock, OutlineButton, Section } from '../../ui/blocks';
import { TabScreen } from '../../ui/TabScreen';
import { colors, useFont } from '../../ui/theme';
import { schedulePlacesApi, type SchedulePlacesApi } from '../fill-places/schedulePlacesApi';
import { useSchedulePlaces } from '../fill-places/useSchedulePlaces';
import { devicePermissions, usePermissions, type PermissionsSource } from '../today/permissions';
import { PermissionGuide } from '../today/PermissionGuide';

type Props = { scheduleApi?: SchedulePlacesApi; permissionsSource?: PermissionsSource; timeoutMs?: number };

/**
 * 가족 탭: 지금 있는 '가족에게 보내기'(전달됨)로 가는 입구와 보낸 요청 목록.
 * 가족 묶기·요청 4종·공유는 다음 묶음(J10b)이라 자리만 둔다.
 * 보낸 요청은 일정 응답의 familyRequests로 만든다(서버에 따로 목록 API가 없다).
 * 상태: 로딩·오류·빈 목록·권한 없음(캘린더 꺼짐)·정상.
 */
export function FamilyTabScreen({ scheduleApi = schedulePlacesApi, permissionsSource = devicePermissions, timeoutMs = REQUEST_TIMEOUT_MS }: Props) {
  const router = useRouter();
  const font = useFont();
  const t = strings.familyTab;
  const permissions = usePermissions(permissionsSource);
  const map = permissions.state.status === 'ready' ? permissions.state.map : null;
  const blocked = map !== null && map.calendar !== 'granted';
  const sched = useSchedulePlaces({ api: scheduleApi, timeoutMs, enabled: !blocked && permissions.state.status !== 'loading' });

  const sent = !blocked && sched.load.status === 'ready'
    ? sched.load.schedules.flatMap((s) => s.familyRequests.map((r) => ({ key: `${s.id}:${r.memberId}`, name: r.name, title: s.title })))
    : [];

  return (
    <TabScreen title={t.title} description={t.description} testID="tab-family">
      <Section heading={t.sendHeading}>
        <Card>
          <Text style={[styles.hint, font(400)]}>{t.sendHint}</Text>
          <OutlineButton label={t.openToday} onPress={() => router.navigate('/')} />
        </Card>
      </Section>

      <Section heading={t.sentHeading} testID="family-sent">
        {blocked && map ? (
          <Card>
            <EmptyText testID="family-permission">{t.calendarNeeded}</EmptyText>
            <PermissionGuide map={map} names={['calendar']} onRequest={(name) => void permissions.request(name)} onOpenSettings={permissions.openSettings} />
          </Card>
        ) : sched.load.status === 'loading' ? (
          <LoadingBlock label={t.sentLoading} />
        ) : sched.load.status === 'error' ? (
          <ErrorBlock message={t.sentLoadFailed} retryLabel={t.retry} onRetry={sched.reload} />
        ) : sent.length === 0 ? (
          <EmptyText testID="family-sent-empty">{t.sentEmpty}</EmptyText>
        ) : (
          <Card>
            {sent.map((item) => (
              <View key={item.key} testID={`family-sent-${item.key}`} style={styles.sentRow}>
                <Text style={[styles.sentName, font(600)]}>{t.delivered(item.name)}</Text>
                <Text style={[styles.hint, font(400)]}>{item.title}</Text>
              </View>
            ))}
          </Card>
        )}
      </Section>

      <Section heading={t.groupHeading} testID="family-group">
        {/* 다음 묶음(J10b)이 가족 묶기·요청 4종·공유로 채운다. */}
        <EmptyText>{t.groupSoon}</EmptyText>
      </Section>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  sentRow: { gap: 2 },
  sentName: { fontSize: 16, color: colors.text },
});
