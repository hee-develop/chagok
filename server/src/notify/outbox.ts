import type { AppNotification, NotificationKind, PushSender } from './types.js';

/** 자리(폰) 하나가 알림함에 쌓아 둘 수 있는 알림 수. 넘으면 가장 오래된 것부터 버린다. */
export const MAX_QUEUE_PER_SEAT = 50;
/** 알림이 알림함에 머무는 시간(3일). 폰이 안 읽어 가도 이만큼 지나면 버린다. */
export const NOTIFICATION_TTL_MS = 3 * 24 * 60 * 60_000;
/** `GET /notifications` 한 번에 돌려주는 알림 수 상한(가장 오래된 것부터). */
export const MAX_LIST_SIZE = 50;

/** `since` 값: 알림 id(십진수 문자열) 또는 ISO8601 시각. */
export type Since = { kind: 'id'; id: string } | { kind: 'time'; ms: number };

/** 비교할 때 큰 수로 쓰려고 id는 늘 자릿수 → 사전순으로 견준다(앞자리 0이 없는 십진수 문자열). */
export const compareIds = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

/** 없으면 undefined, 모양이 틀리면 null. 숫자만이면 id, 아니면 오프셋이 있는 ISO8601 시각이어야 한다. */
export function parseSince(value: string | undefined): Since | null | undefined {
  if (value === undefined || value === '') return undefined;
  if (/^[1-9]\d{0,19}$/.test(value) || value === '0') return { kind: 'id', id: value };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : { kind: 'time', ms };
  }
  return null;
}

/**
 * 기본 `PushSender`: 자리(폰)별 메모리 큐. 폰이 서버를 폴링해서(`GET /notifications`) 읽고 `ack`로 지운다.
 * 서버를 다시 켜면 비워진다. 자리가 지워지거나 폰이 바뀌면 `forget`으로 그 자리의 큐를 버린다.
 */
export type Outbox = PushSender & {
  /** since보다 나중에 만든 알림을 오래된 것부터(만료된 것은 이때 버린다). */
  list(seatId: string, since?: Since): AppNotification[];
  /** 그 자리의 이 id들을 지운다(읽음 처리). 지운 수. 다른 자리의 id는 무시한다. */
  ack(seatId: string, ids: string[]): number;
  /** 그 자리에 쌓인 알림 중 이 종류를 모두 지운다(그 알림이 가리키는 일이 해결됐을 때). 지운 수. */
  dropKind(seatId: string, kind: NotificationKind): number;
  /** 그 자리에 쌓인 알림 수(만료된 것은 세지 않는다). */
  size(seatId: string): number;
};

export type OutboxOptions = {
  now?: () => Date;
  maxPerSeat?: number;
  ttlMs?: number;
};

export function createOutbox({ now = () => new Date(), maxPerSeat = MAX_QUEUE_PER_SEAT, ttlMs = NOTIFICATION_TTL_MS }: OutboxOptions = {}): Outbox {
  /** 알림과 그 알림이 사라지는 시각(알림마다 보관 시간을 따로 줄 수 있다). */
  type Entry = { notification: AppNotification; expiresAt: number };
  const queues = new Map<string, Entry[]>();

  const entries = (seatId: string): Entry[] => {
    const queue = queues.get(seatId);
    if (!queue) return [];
    const at = now().getTime();
    const kept = queue.filter((e) => e.expiresAt > at);
    if (kept.length === 0) queues.delete(seatId);
    else if (kept.length !== queue.length) queues.set(seatId, kept);
    return kept;
  };
  const alive = (seatId: string) => entries(seatId).map((e) => e.notification);

  return {
    send: (seatId, notification, options) => {
      const queue = entries(seatId);
      queue.push({ notification, expiresAt: Date.parse(notification.createdAt) + (options?.ttlMs ?? ttlMs) });
      while (queue.length > Math.max(1, maxPerSeat)) queue.shift();
      queues.set(seatId, queue);
    },
    drop: (kind, predicate) => {
      for (const seatId of [...queues.keys()]) {
        const queue = entries(seatId);
        const kept = queue.filter((e) => !(e.notification.kind === kind && predicate(e.notification)));
        if (kept.length === 0) queues.delete(seatId);
        else if (kept.length !== queue.length) queues.set(seatId, kept);
      }
    },
    forget: (seatId) => {
      queues.delete(seatId);
    },
    list: (seatId, since) => {
      const list = alive(seatId);
      const after = since
        ? list.filter((n) => (since.kind === 'id' ? compareIds(n.id, since.id) > 0 : Date.parse(n.createdAt) > since.ms))
        : list;
      return after.slice(0, MAX_LIST_SIZE);
    },
    ack: (seatId, ids) => {
      const list = entries(seatId);
      const wanted = new Set(ids);
      const kept = list.filter((e) => !wanted.has(e.notification.id));
      if (kept.length === 0) queues.delete(seatId);
      else queues.set(seatId, kept);
      return list.length - kept.length;
    },
    dropKind: (seatId, kind) => {
      const list = entries(seatId);
      const kept = list.filter((e) => e.notification.kind !== kind);
      if (kept.length === 0) queues.delete(seatId);
      else if (kept.length !== list.length) queues.set(seatId, kept);
      return list.length - kept.length;
    },
    size: (seatId) => alive(seatId).length,
  };
}
