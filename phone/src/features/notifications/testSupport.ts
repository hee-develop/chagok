import type { Inbox } from './inbox';
import type { LocalNotifier } from './localNotifier';
import type { PermissionState, ServerNotification } from './types';

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
