import { createScheduler, type Scheduler } from '../scheduler.js';
import type { SeatStore } from '../seats.js';
import { runEventsStaleCheck } from './eventsStale.js';
import { createFcmSender, createPushTokenRegistry, createServiceAccountTokenProvider, loadFcmConfigFromEnv, type PushTokenRegistry } from './fcm.js';
import { createNotifications, type Notifications } from './notifier.js';

export type NotificationRuntime = {
  notifications: Notifications;
  /** 정기 작업 스케줄러. 시작은 서버 프로세스가 한다(`scheduler.start()`). 다른 정기 작업은 `register`로 더한다. */
  scheduler: Scheduler;
  pushTokens: PushTokenRegistry;
  fcmEnabled: boolean;
};

/**
 * 서버 프로세스가 알림을 한 번에 갖추는 곳: 알림함(+환경 변수가 있으면 FCM), '일정을 못 받고 있어요' 작업이 등록된 스케줄러.
 * `createApp`에는 `notifications`를 넘기고, 스케줄러는 프로세스가 시작한다(테스트는 시작하지 않는다).
 */
export function createNotificationRuntime({
  seats,
  env = process.env,
  now = () => new Date(),
  readFile,
  onError,
}: {
  seats: Pick<SeatStore, 'allSeats'>;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  readFile?: (path: string) => string;
  onError?: (error: unknown) => void;
}): NotificationRuntime {
  const pushTokens = createPushTokenRegistry();
  const fcm = loadFcmConfigFromEnv(env, readFile);
  const extraSenders = fcm
    ? [createFcmSender({ projectId: fcm.projectId, getAccessToken: createServiceAccountTokenProvider({ account: fcm.account, now }), tokens: pushTokens })]
    : [];
  const notifications = createNotifications({ now, extraSenders, onError });
  const scheduler = createScheduler({ now });
  scheduler.register({ name: 'events-stale', run: (at) => void runEventsStaleCheck({ seats, notifier: notifications.notifier, now: at }) });
  return { notifications, scheduler, pushTokens, fcmEnabled: fcm !== null };
}
