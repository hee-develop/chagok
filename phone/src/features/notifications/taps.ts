import { appEventSync, type EventSync } from '../calendar-sync/eventSync';
import { EVENTS_STALE_KIND, staleOutcomeOf } from './eventsStale';
import { appInbox, type Inbox } from './inbox';
import type { NotificationTap } from './types';

/** 종류별로 알림을 눌렀을 때 하는 일. 다음 묶음(늦을 때 연락·가족 요청)이 `registerTapHandler`로 자기 종류를 더한다. */
export type TapHandler = (tap: NotificationTap) => void | Promise<void>;

const handlers = new Map<string, TapHandler>();

/** 알림 종류의 누름 처리를 등록한다(같은 종류는 바꾼다). 해제 함수를 돌려준다. */
export function registerTapHandler(kind: string, handler: TapHandler): () => void {
  handlers.set(kind, handler);
  return () => {
    if (handlers.get(kind) === handler) handlers.delete(kind);
  };
}

/** 알림을 눌렀을 때. 알림함에서 읽음으로 하고 그 종류의 처리를 부른다. 모르는 종류나 처리 실패는 조용히 넘어간다. */
export async function handleNotificationTap(tap: NotificationTap, inbox: Inbox = appInbox): Promise<void> {
  if (tap.id !== '') inbox.markRead(tap.id);
  try {
    await handlers.get(tap.kind)?.(tap);
  } catch {
    // 누름 처리 실패가 앱을 깨뜨리지 않는다.
  }
}

/** 캘린더 권한·선택 화면 경로. 일정을 보낼 수 없는 폰에서 `events-stale`을 누르면 여기로 간다. 설정 탭의 [캘린더 고르기]와 같은 화면(`from=tab`: 단계 표시 없이 열리고 끝나면 이전 화면으로 돌아온다). */
export const CALENDAR_SETTINGS_PATH = '/setup/calendar?from=tab';

/** 화면 이동. 기본은 expo-router의 명령형 `router.push`(불러오는 시점을 늦춰 테스트가 라우터 없이 이 파일을 가져올 수 있게 한다). */
const pushRoute = async (path: string) => {
  const { router } = await import('expo-router');
  router.push(path);
};

/**
 * `events-stale`(차곡이 일정을 못 받고 있어요): 앱이 열리며 일정을 새로 보낸다(기존 일정 동기화를 한 번 부른다. 이미 도는 중이면 그 실행의 결과를 쓴다).
 * - 보냈거나 보낼 것이 없으면(`sent`·`unchanged`) 알림함의 그 알림을 지운다(홈에 '못 받고 있어요'가 남지 않게).
 * - 이 폰이 일정을 보낼 수 없으면(캘린더 권한 꺼짐 `permission-denied`·고른 캘린더 없음 `no-selection`) 알림을 지우고 캘린더 권한·선택 화면으로 간다.
 *   목 출처(`mock`)는 알림만 지운다. 정책서 10.4('캘린더 거부 → 일정을 쓰지 않는다')라 알림은 이유를 알려 주는 홈 안내(`useEventSendBlock`)로 대신한다.
 * - 실패·취소면 알림은 남고 읽음 처리만 된다.
 */
export function createEventsStaleTapHandler(
  sync: Pick<EventSync, 'inFlight' | 'run'> = appEventSync,
  inbox: Inbox = appInbox,
  navigate: (path: string) => void | Promise<void> = pushRoute,
): TapHandler {
  return async (tap) => {
    const result = await (sync.inFlight() ?? sync.run());
    const outcome = staleOutcomeOf(result);
    if (outcome === 'unknown') return;
    if (tap.id !== '') inbox.dismiss(tap.id);
    inbox.dismissKind(EVENTS_STALE_KIND);
    if (result === 'permission-denied' || result === 'no-selection') await navigate(CALENDAR_SETTINGS_PATH);
  };
}

registerTapHandler(EVENTS_STALE_KIND, createEventsStaleTapHandler());
