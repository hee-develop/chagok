/**
 * 폰 알림 종류(정책서 10.6). 이후 묶음이 쓸 종류도 미리 정의해 둔다.
 * - `events-stale`: 차곡이 일정을 못 받고 있어요(마지막 수신 24시간 뒤, 저녁 8시 하루 한 번). 누르면 앱이 열리며 일정을 새로 보낸다.
 * - `late-sms`: 늦을 때 연락 → 내용이 채워진 문자 창(늦을 때 연락 묶음 J9가 넣는다).
 * - `family-status`: 가족 요청 상태(보낸 사람 폰, 가족 묶음 J10이 넣는다).
 */
export const NOTIFICATION_KINDS = ['events-stale', 'late-sms', 'family-status'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const isNotificationKind = (value: unknown): value is NotificationKind =>
  typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);

/** 알림 한 건. `id`는 십진수 문자열이고 같은 서버 안에서 늘어나는 순서다(시각 위에서 이어져, 서버를 다시 켜도 시계가 뒤로 가지 않는 한 줄어들지 않는다. 폰은 `cursor`로 서버가 바뀐 것을 안다). */
export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** 종류별 부가 값. FCM `data`와 같은 모양(문자열 → 문자열)이라 폰이 이동할 곳을 고를 때 쓴다. */
  data: Record<string, string>;
  createdAt: string;
};

/** 다른 묶음이 `notify`에 넘기는 값. `dedupeKey`가 같은 알림은 한동안 한 번만 만든다(예: `events-stale:2026-11-15`). */
export type NotifyInput = {
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedupeKey?: string;
  /** 이 알림이 알림함에 머무는 시간(ms). 없으면 알림함 기본값(3일). 도착 예정 알림처럼 시각이 든 알림을 짧게 두는 데 쓴다. */
  ttlMs?: number;
};

export type NotifyResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate' | 'invalid' };

/**
 * 알림을 폰으로 내보내는 포트. 기본 구현은 폰이 서버를 폴링해서 읽는 `Outbox`이고,
 * 환경 변수로 켜면 FCM 같은 실제 푸시 구현이 같은 포트를 하나 더 채운다(`fcm.ts`).
 */
export type PushSender = {
  /**
   * 한 자리(폰)에 알림 하나를 보낸다. 던지지 않고(실패는 구현이 삼킨다) 끝난 뒤 resolve한다.
   * `options.ttlMs`는 알림함이 쓰는 보관 시간이다(다른 구현은 무시해도 된다).
   */
  send(seatId: string, notification: AppNotification, options?: { ttlMs?: number }): void | Promise<void>;
  /** 이 종류의 알림 중 조건에 맞는 것을 모든 자리에서 지운다(알림이 가리키는 일이 사라졌을 때). 알림함처럼 쌓아 두는 구현만 채운다. */
  drop?(kind: NotificationKind, predicate: (notification: AppNotification) => boolean): void;
  /** 그 자리가 지워지거나 폰이 바뀌었다: 그 자리에 쌓아 둔 것(큐·푸시 토큰)을 버린다. */
  forget?(seatId: string): void;
};
