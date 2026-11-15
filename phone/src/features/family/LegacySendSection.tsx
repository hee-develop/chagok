import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, EmptyText, ErrorBlock, LoadingBlock, OutlineButton, Section } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { schedulePlacesApi, type SchedulePlacesApi } from '../fill-places/schedulePlacesApi';
import { useSchedulePlaces } from '../fill-places/useSchedulePlaces';
import { devicePermissions, usePermissions, type PermissionsSource } from '../today/permissions';
import { PermissionGuide } from '../today/PermissionGuide';

type Props = { scheduleApi?: SchedulePlacesApi; permissionsSource?: PermissionsSource; timeoutMs?: number };

/**
 * 일정을 미리 묶어 둔 가족(시연용 픽스처 가족)에게 보내는 기존 입구와 그 '전달됨' 목록(`docs/family-send.md`). 새 가족 모델과 따로 그대로 동작한다.
 * 일정 응답의 familyRequests로 목록을 만들므로(서버에 따로 목록 API가 없다) 캘린더 권한이 꺼져 있으면 이 구역만 [켜기]를 보이고 가족 탭의 나머지는 막지 않는다.
 * 상태: 로딩·오류(다시 시도)·빈 목록·권한 없음(캘린더 꺼짐)·정상.
 */
export function LegacySendSection({ scheduleApi = schedulePlacesApi, permissionsSource = devicePermissions, timeoutMs = REQUEST_TIMEOUT_MS }: Props) {
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
    <>
      <Section heading={t.sendHeading} testID="family-legacy-send">
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
    </>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  sentRow: { gap: 2 },
  sentName: { fontSize: 16, color: colors.text },
});
