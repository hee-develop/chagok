import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, EmptyText, ErrorBlock, LoadingBlock, OutlineButton, Section } from '../../ui/blocks';
import { TabScreen } from '../../ui/TabScreen';
import { colors, useFont } from '../../ui/theme';
import { useFilteredEvents, type FilteredEvent } from '../calendar-sync/filteredEvents';
import { useEventSendBlock, type SendBlockReason } from '../calendar-sync/sendBlock';
import { TravelMarkNotice } from '../calendar-sync/TravelMarkNotice';
import { useTravelMark, type TravelMarkOptions } from '../calendar-sync/useTravelMark';
import { formatScheduleDay } from '../fill-places/scheduleFormat';
import { schedulePlacesApi, type SchedulePlacesApi } from '../fill-places/schedulePlacesApi';
import type { Inbox } from '../notifications/inbox';
import { useSchedulePlaces } from '../fill-places/useSchedulePlaces';
import { carConnectionSource, useCarConnection, type CarConnectionSource } from './carConnection';
import { ConnectionCard } from './ConnectionCard';
import { FilteredRow } from './FilteredRow';
import { InboxSection } from './InboxSection';
import { devicePermissions, usePermissions, type PermissionName, type PermissionsSource } from './permissions';
import { PermissionGuide } from './PermissionGuide';
import { ScheduleRow } from './ScheduleRow';
import { splitSchedules } from './todaySchedules';

type Props = {
  scheduleApi?: SchedulePlacesApi;
  connectionSource?: CarConnectionSource;
  permissionsSource?: PermissionsSource;
  timeoutMs?: number;
  /** 폰이 거른 일정(서버로 보내지 않은 것). 기본은 앱 전체가 공유하는 목록(3단계 화면과 같다). */
  filteredEvents?: readonly FilteredEvent[];
  /** 거른 일정을 "이동 일정이에요"로 바꾸고 되돌리는 동작(기본은 `calendar-sync/travelMark.ts`). 바뀌면 서버 목록을 다시 조회한다. */
  travelMark?: Pick<TravelMarkOptions, 'mark' | 'undo' | 'undoVisibleMs'>;
  /** 폰 알림함. 기본은 앱 전체가 공유하는 것. */
  inbox?: Inbox;
  /** 일정을 서버로 보낼 수 없는 이유. 기본은 일정 동기화 결과를 따라가는 `useEventSendBlock()`. */
  sendBlock?: SendBlockReason | null;
};

/**
 * 오늘(홈) 탭(정책서 10.7): 꺼진 권한 안내(맨 위, 10.4), 차 연결 상태, 장소 빈 일정 배너, 오늘 일정, 다른 날 장소 빈 일정, 받은 가족 요청 자리.
 * 일정을 누르면 그 자리에서 장소·채비·가족에게 보내기를 한다(3단계와 같은 컴포넌트).
 * 폰이 읽을 때 거른 일정(온라인·건물 안·종일)은 '이동 없음'으로 흐리게 같이 보이고, 누르면 3단계와 같은 확인·되돌리기로 이동 일정으로 바꾼다.
 * 상태: 일정 구역이 로딩·오류(다시 시도)·빈 목록·권한 없음(캘린더 꺼짐)·정상을 가른다. 4xx(일정이 바뀜) 저장 오류는 [닫기]만 둔다.
 */
export function TodayScreen({
  scheduleApi = schedulePlacesApi,
  connectionSource = carConnectionSource,
  permissionsSource = devicePermissions,
  timeoutMs = REQUEST_TIMEOUT_MS,
  filteredEvents,
  travelMark,
  inbox,
  sendBlock: sendBlockProp,
}: Props) {
  const font = useFont();
  const router = useRouter();
  const t = strings.today;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sharedFiltered = useFilteredEvents();
  const filtered = filteredEvents ?? sharedFiltered;

  const permissions = usePermissions(permissionsSource);
  const permissionMap = permissions.state.status === 'ready' ? permissions.state.map : null;
  // 권한을 읽지 못했을 때(error)는 막지 않는다. 일정 조회가 실패하면 그쪽 오류로 보인다.
  const calendarBlocked = permissionMap !== null && permissionMap.calendar !== 'granted';
  const permissionsPending = permissions.state.status === 'loading';

  const connection = useCarConnection({ source: connectionSource, timeoutMs });
  const sched = useSchedulePlaces({ api: scheduleApi, timeoutMs, enabled: !calendarBlocked && !permissionsPending });
  // 거른 줄을 이동 일정으로 바꾸거나 되돌리면 서버가 아는 일정이 달라지므로 서버 목록을 다시 조회한다.
  const travel = useTravelMark({ ...travelMark, lines: filtered, onChanged: sched.reload });
  const saving = sched.saving || travel.busy;
  const observedBlock = useEventSendBlock();
  const sendBlock = sendBlockProp === undefined ? observedBlock : sendBlockProp;

  // 홈에는 거부한 권한만 남긴다. 캘린더는 홈에 꼭 필요하므로 아직 묻지 않았어도 [켜기]를 보이고,
  // 카메라는 한 번도 묻지 않았으면 보이지 않으며 거부했고 아직 연결 전일 때만 보인다.
  // 알림도 같은 규칙이다: 첫 설정 끝에 한 번 묻고, 거부했을 때만 '켜면 이게 돼요'로 남긴다(꺼 두면 알림은 이 화면 맨 위에만 쌓인다).
  // 일정 동기화가 캘린더 권한이 꺼져 있다고 알려 오면(`permission-denied`) 권한 목록이 아직 켜짐이어도 캘린더 안내를 보인다.
  const shownMap = permissionMap && sendBlock === 'permission-denied' && permissionMap.calendar === 'granted'
    ? { ...permissionMap, calendar: 'denied' as const } : permissionMap;
  const guideNames: PermissionName[] = [];
  if (shownMap) {
    if (shownMap.calendar !== 'granted') guideNames.push('calendar');
    if (shownMap.camera === 'denied' && connection.state.status === 'notConnected') guideNames.push('camera');
    if (shownMap.notifications === 'denied') guideNames.push('notifications');
  }
  const calendarOffForSend = !calendarBlocked && sendBlock === 'no-selection';

  // 권한이 꺼지면 이전에 읽어 둔 일정은 보이지 않는다.
  const split = !calendarBlocked && sched.load.status === 'ready' ? splitSchedules(sched.load.schedules, sched.load.anchor, filtered) : null;
  const day = formatScheduleDay(sched.load.status === 'ready' ? sched.load.anchor : new Date().toISOString());
  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <TabScreen title={t.title} description={day} testID="tab-today">
      <InboxSection inbox={inbox} />

      {(guideNames.length > 0 && shownMap) || calendarOffForSend ? (
        <Section heading={strings.permissions.heading} testID="permission-guide">
          <Card>
            {shownMap && guideNames.length > 0 ? (
              <PermissionGuide map={shownMap} names={guideNames} onRequest={(name) => void permissions.request(name)} onOpenSettings={permissions.openSettings} />
            ) : null}
            {calendarOffForSend ? (
              <View testID="send-block-no-selection" style={styles.guideRow}>
                <Text style={[styles.guideText, font(400)]}>{strings.sendBlock.noSelection}</Text>
                <OutlineButton label={strings.sendBlock.pickCalendar} onPress={() => router.push({ pathname: '/setup/calendar', params: { from: 'tab' } })} />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Section heading={strings.carConnection.heading}>
        <ConnectionCard state={connection.state} onRecheck={connection.recheck} />
      </Section>

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
        ) : split && split.items.length === 0 ? (
          <EmptyText testID="today-empty">{t.empty}</EmptyText>
        ) : (
          split?.items.map((item) => item.kind === 'filtered' ? (
            <FilteredRow key={`filtered-${item.event.id}`} event={item.event} disabled={saving}
              confirming={travel.confirming?.id === item.event.id}
              onAsk={() => { sched.clearSaveIssue(); travel.ask(item.event.id, item.event.title); }}
              onConfirm={() => void travel.confirm()} onCancel={travel.cancel} />
          ) : (
            <ScheduleRow key={item.schedule.id} schedule={item.schedule} expanded={expandedId === item.schedule.id}
              onToggle={() => toggle(item.schedule.id)} saving={saving} onSave={(id, change) => void sched.save(id, change)} onNavigate={sched.clearSaveIssue} />
          ))
        )}
        {sched.saving ? <LoadingBlock label={t.saving} /> : null}
        <TravelMarkNotice undoable={travel.undoable} issue={travel.issue} disabled={saving} onUndo={() => void travel.undoNow()} />
        {sched.saveIssue === 'reload' ? (
          // 일정이 바뀌어 같은 저장을 다시 보내면 안 된다. 목록은 이미 다시 읽고 있으므로 닫기만 둔다.
          <ErrorBlock message={strings.placeSearch.scheduleChanged} retryLabel={t.close} onRetry={sched.clearSaveIssue} />
        ) : sched.saveIssue === 'retry' ? (
          <ErrorBlock message={strings.fillPlaces.saveFailed} retryLabel={strings.fillPlaces.retry} onRetry={sched.retrySave} />
        ) : null}
      </Section>

      {split && split.otherMissing.length > 0 ? (
        <Section heading={t.otherDaysHeading} testID="other-missing">
          {split.otherMissing.map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} showDay expanded={expandedId === schedule.id}
              onToggle={() => toggle(schedule.id)} saving={saving} onSave={(id, change) => void sched.save(id, change)} onNavigate={sched.clearSaveIssue} />
          ))}
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
  guideRow: { gap: 10 },
  guideText: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  inboxTitle: { fontSize: 16, color: colors.text },
  inboxHint: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
});
