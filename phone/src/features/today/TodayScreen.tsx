import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, EmptyText, ErrorBlock, LoadingBlock, Section } from '../../ui/blocks';
import { TabScreen } from '../../ui/TabScreen';
import { colors, useFont } from '../../ui/theme';
import { formatScheduleDay } from '../fill-places/scheduleFormat';
import { schedulePlacesApi, type SchedulePlacesApi } from '../fill-places/schedulePlacesApi';
import { useSchedulePlaces } from '../fill-places/useSchedulePlaces';
import { carConnectionSource, useCarConnection, type CarConnectionSource } from './carConnection';
import { ConnectionCard } from './ConnectionCard';
import { devicePermissions, usePermissions, type PermissionName, type PermissionsSource } from './permissions';
import { PermissionGuide } from './PermissionGuide';
import { ScheduleRow } from './ScheduleRow';
import { splitSchedules } from './todaySchedules';

type Props = {
  scheduleApi?: SchedulePlacesApi;
  connectionSource?: CarConnectionSource;
  permissionsSource?: PermissionsSource;
  timeoutMs?: number;
};

/**
 * 오늘(홈) 탭: 차 연결 상태, 꺼진 권한 안내, 오늘 일정, 받은 가족 요청 자리, 장소 빈 일정.
 * 일정을 누르면 그 자리에서 장소·채비·가족에게 보내기를 한다(3단계와 같은 컴포넌트).
 * 상태: 일정 구역이 로딩·오류(다시 시도)·빈 목록·권한 없음(캘린더 꺼짐)·정상을 가른다.
 */
export function TodayScreen({
  scheduleApi = schedulePlacesApi,
  connectionSource = carConnectionSource,
  permissionsSource = devicePermissions,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: Props) {
  const font = useFont();
  const t = strings.today;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const permissions = usePermissions(permissionsSource);
  const permissionMap = permissions.state.status === 'ready' ? permissions.state.map : null;
  // 권한을 읽지 못했을 때(error)는 막지 않는다. 일정 조회가 실패하면 그쪽 오류로 보인다.
  const calendarBlocked = permissionMap !== null && permissionMap.calendar !== 'granted';
  const permissionsPending = permissions.state.status === 'loading';

  const connection = useCarConnection({ source: connectionSource, timeoutMs });
  const sched = useSchedulePlaces({ api: scheduleApi, timeoutMs, enabled: !calendarBlocked && !permissionsPending });

  const guideNames: PermissionName[] = ['calendar', ...(connection.state.status === 'connected' ? [] : (['camera'] as const))];
  const hasGuide = permissionMap !== null && guideNames.some((name) => permissionMap[name] !== 'granted');

  // 권한이 꺼지면 이전에 읽어 둔 일정은 보이지 않는다.
  const split = !calendarBlocked && sched.load.status === 'ready' ? splitSchedules(sched.load.schedules, sched.load.anchor) : null;
  const day = formatScheduleDay(sched.load.status === 'ready' ? sched.load.anchor : new Date().toISOString());
  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));
  const row = (schedule: NonNullable<typeof split>['today'][number], showDay: boolean) => (
    <ScheduleRow key={schedule.id} schedule={schedule} showDay={showDay} expanded={expandedId === schedule.id}
      onToggle={() => toggle(schedule.id)} saving={sched.saving} onSave={(id, change) => void sched.save(id, change)} onNavigate={sched.clearSaveIssue} />
  );

  return (
    <TabScreen title={t.title} description={day} testID="tab-today">
      <Section heading={strings.carConnection.heading}>
        <ConnectionCard state={connection.state} onRecheck={connection.recheck} />
      </Section>

      {hasGuide && permissionMap ? (
        <Section heading={strings.permissions.heading} testID="permission-guide">
          <Card>
            <PermissionGuide map={permissionMap} names={guideNames} onRequest={(name) => void permissions.request(name)} onOpenSettings={permissions.openSettings} />
          </Card>
        </Section>
      ) : null}

      {split && split.missingCount > 0 ? (
        <View testID="missing-banner" accessibilityLiveRegion="polite" style={styles.banner}>
          <Text style={[styles.bannerTitle, font(600)]}>{t.missingBanner(split.missingCount)}</Text>
          <Text style={[styles.bannerHint, font(400)]}>{t.missingBannerHint}</Text>
        </View>
      ) : null}

      <Section heading={t.scheduleHeading} testID="today-schedules">
        {calendarBlocked ? (
          <EmptyText testID="today-permission">{t.calendarNeeded}</EmptyText>
        ) : sched.load.status === 'loading' ? (
          <LoadingBlock label={t.loading} />
        ) : sched.load.status === 'error' ? (
          <ErrorBlock message={t.loadFailed} retryLabel={t.retry} onRetry={sched.reload} />
        ) : split && split.today.length === 0 ? (
          <EmptyText testID="today-empty">{t.empty}</EmptyText>
        ) : (
          split?.today.map((schedule) => row(schedule, false))
        )}
        {sched.saving ? <LoadingBlock label={t.saving} /> : null}
        {sched.saveIssue ? (
          <ErrorBlock
            message={sched.saveIssue === 'reload' ? strings.placeSearch.scheduleChanged : strings.fillPlaces.saveFailed}
            retryLabel={strings.fillPlaces.retry}
            onRetry={sched.saveIssue === 'retry' ? sched.retrySave : sched.clearSaveIssue}
          />
        ) : null}
      </Section>

      {split && split.otherMissing.length > 0 ? (
        <Section heading={t.otherDaysHeading} testID="other-missing">
          {split.otherMissing.map((schedule) => row(schedule, true))}
        </Section>
      ) : null}

      <Section heading={t.inboxHeading} testID="family-inbox">
        {/* 받는 쪽 API가 서버에 아직 없다. 다음 묶음(J10b)이 이 자리를 채운다. */}
        <Card>
          <Text style={[styles.inboxTitle, font(500)]}>{t.inboxEmpty}</Text>
          <Text style={[styles.inboxHint, font(400)]}>{t.inboxSoon}</Text>
        </Card>
      </Section>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 16, borderRadius: 16, backgroundColor: colors.tint, gap: 4 },
  bannerTitle: { fontSize: 16, color: colors.text },
  bannerHint: { fontSize: 14, lineHeight: 20, color: colors.textStrong },
  inboxTitle: { fontSize: 16, color: colors.text },
  inboxHint: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
});
