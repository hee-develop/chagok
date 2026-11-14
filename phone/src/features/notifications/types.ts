/** 알림 종류(서버 `server/src/notify/types.ts`의 `NOTIFICATION_KINDS`와 같다). 모르는 종류는 받아도 보관만 하고 눌러도 아무 일도 하지 않는다. */
export type NotificationKind = 'events-stale' | 'late-sms' | 'family-status';

/** 서버 알림함이 내려 주는 알림 한 건. */
export type ServerNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, string>;
  createdAt: string;
};

/** 폰 알림함(홈에 보이는 목록)의 한 건. */
export type InboxItem = ServerNotification & {
  /** 이 폰이 받은 시각(ISO8601). */
  receivedAt: string;
  read: boolean;
};

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/** 알림을 눌렀을 때 넘어오는 값. */
export type NotificationTap = { id: string; kind: string; data: Record<string, string> };
