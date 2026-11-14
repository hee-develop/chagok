import type { Inbox } from '../../features/notifications/inbox';
import type { LocalNotifier } from '../../features/notifications/localNotifier';
import type { EventSync, SyncResult } from '../../features/calendar-sync/eventSync';
import type { NotificationsPage } from '../../features/notifications/notificationsApi';
import type { PermissionState, ServerNotification } from '../../features/notifications/types';

export const note = (id: string, over: Partial<ServerNotification> = {}): ServerNotification => ({
  id,
  kind: 'events-stale',
  title: `제목 ${id}`,
  body: '본문',
  data: { action: 'resend-events' },
  createdAt: '2026-11-14T11:00:00.000Z',
  ...over,
});

export const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** 가짜 시스템 알림. 권한 상태를 바꿀 수 있고 띄운 알림과 누름 처리기를 기록한다. */
export const fakeNotifier = (permission: PermissionState = 'granted') => {
  const state = { permission, tapHandler: null as null | ((tap: { id: string; kind: string; data: Record<string, string> }) => void) };
  const present = jest.fn().mockResolvedValue(undefined);
  const requestPermission = jest.fn(async () => state.permission);
  const unsubscribe = jest.fn();
  const notifier: LocalNotifier = {
    permission: async () => state.permission,
    requestPermission,
    present,
    onTap: (handler) => {
      state.tapHandler = handler;
      return unsubscribe;
    },
  };
  return { notifier, state, present, requestPermission, unsubscribe };
};

export const idsOf = (inbox: Inbox) => inbox.getState().items.map((i) => i.id);

/** `GET /notifications` 응답 모양(서버 id 기준값 `cursor`는 기본 없음). */
export const page = (notifications: ServerNotification[] = [], cursor: string | null = null): NotificationsPage => ({ notifications, cursor });

/**
 * 가짜 일정 동기화. `run()`은 `result`로 끝나고, `emit`으로 구독자에게 결과를 알릴 수 있다.
 * `inFlightWith`를 주면 그 약속이 '지금 도는 실행'이다(그 동안 `run()`을 부르면 안 되는 쪽을 검증할 때).
 */
export const fakeSync = (result: SyncResult | null = 'failed', inFlightWith: Promise<SyncResult> | null = null) => {
  const listeners = new Set<(r: SyncResult) => void>();
  const run = jest.fn().mockResolvedValue(result);
  const sync: EventSync = {
    run,
    stop: jest.fn(),
    rememberSelection: jest.fn(),
    lastResult: () => result,
    inFlight: () => inFlightWith,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { sync, run, emit: (r: SyncResult) => listeners.forEach((l) => l(r)), listenerCount: () => listeners.size };
};
