import { appEventSync, type EventSync } from '../calendar-sync/eventSync';
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

/**
 * `events-stale`(차곡이 일정을 못 받고 있어요): 앱이 열리며 일정을 새로 보낸다(기존 일정 동기화를 한 번 부른다).
 * 보냈으면 알림함의 그 알림은 지운다(홈에 '못 받고 있어요'가 남지 않게).
 */
export function createEventsStaleTapHandler(sync: EventSync = appEventSync, inbox: Inbox = appInbox): TapHandler {
  return async (tap) => {
    const result = await sync.run();
    if ((result === 'sent' || result === 'unchanged') && tap.id !== '') inbox.dismiss(tap.id);
  };
}

registerTapHandler('events-stale', createEventsStaleTapHandler());
