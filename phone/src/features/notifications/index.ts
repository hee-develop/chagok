// 폰 알림(서버 알림함 폴링 + 로컬 알림). 계약: docs/notifications.md
export { appInbox, createInbox, useInbox, type Inbox, type InboxState, type UseInbox } from './inbox';
export { askNotificationPermissionOnce, clearNotificationInbox, getNotificationPermission } from './permission';
export { createNotificationPoller, POLL_INTERVAL_MS, appPoller, type NotificationPoller, type PollResult } from './poller';
export { handleNotificationTap, registerTapHandler, type TapHandler } from './taps';
export { EVENTS_STALE_KIND, staleOutcomeOf, type StaleOutcome } from './eventsStale';
export { useNotifications } from './useNotifications';
export type { InboxItem, NotificationKind, NotificationTap, PermissionState, ServerNotification } from './types';
