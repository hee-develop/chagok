import { createOutbox, type Outbox, type OutboxOptions } from './outbox.js';
import { isNotificationKind, type AppNotification, type NotifyInput, type NotifyResult, type PushSender } from './types.js';

/** 같은 `dedupeKey`를 다시 만들지 않는 시간. 키에 날짜를 넣어 쓰므로 하루가 지나도 남을 만큼(2일)이면 된다. */
export const DEDUPE_TTL_MS = 2 * 24 * 60 * 60_000;
/** 자리 하나가 기억하는 중복 억제 키 수. 넘으면 가장 오래된 키부터 잊는다. */
export const MAX_DEDUPE_KEYS_PER_SEAT = 100;
export const MAX_TITLE_CHARS = 100;
export const MAX_BODY_CHARS = 400;
export const MAX_DATA_ENTRIES = 10;
export const MAX_DATA_KEY_CHARS = 40;
export const MAX_DATA_VALUE_CHARS = 200;
export const MAX_DEDUPE_KEY_CHARS = 100;

export type Notifier = {
  /**
   * 다른 묶음이 쓰는 서버 내부 함수: 한 자리(폰)에 알림을 만들어 모든 `PushSender`에 보낸다.
   * `dedupeKey`가 이미 쓰였으면(2일 안, 읽거나 지운 뒤에도) 만들지 않고 `duplicate`, 값이 틀리면 `invalid`.
   */
  notify(seatId: string, input: NotifyInput): NotifyResult;
  /** 그 자리의 중복 억제 기록과 보낼 곳에 쌓아 둔 것을 버린다(자리 삭제·폰 바꾸기). */
  forget(seatId: string): void;
};

export type NotifierOptions = {
  now?: () => Date;
  senders: PushSender[];
  dedupeTtlMs?: number;
  /** 보내기가 던지거나 거절될 때 알리는 곳. 알림 내용 없이 오류 이름만 받는다. */
  onError?: (error: unknown) => void;
};

/** id는 시각(밀리초 × 1000) 위에서 호출마다 1 이상 늘어난다: 서버를 다시 켜도 줄어들지 않아 폰의 `since`가 계속 맞는다. */
export function createIdClock(now: () => Date): () => string {
  let last = 0;
  return () => {
    last = Math.max(last + 1, now().getTime() * 1000);
    return String(last);
  };
}

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

function sanitize(input: NotifyInput): Pick<AppNotification, 'kind' | 'title' | 'body' | 'data'> | null {
  if (typeof input !== 'object' || input === null || !isNotificationKind(input.kind)) return null;
  if (typeof input.title !== 'string' || input.title.trim() === '' || typeof input.body !== 'string') return null;
  const data: Record<string, string> = {};
  const entries = Object.entries(input.data ?? {});
  if (entries.length > MAX_DATA_ENTRIES) return null;
  for (const [key, value] of entries) {
    if (key === '' || typeof value !== 'string') return null;
    data[clip(key, MAX_DATA_KEY_CHARS)] = clip(value, MAX_DATA_VALUE_CHARS);
  }
  return { kind: input.kind, title: clip(input.title.trim(), MAX_TITLE_CHARS), body: clip(input.body, MAX_BODY_CHARS), data };
}

export function createNotifier({ now = () => new Date(), senders, dedupeTtlMs = DEDUPE_TTL_MS, onError = () => undefined }: NotifierOptions): Notifier {
  const nextId = createIdClock(now);
  const seen = new Map<string, Map<string, number>>(); // 자리 → (중복 억제 키 → 만든 시각)

  const remembered = (seatId: string, key: string) => {
    const keys = seen.get(seatId);
    if (!keys) return false;
    const at = now().getTime();
    for (const [k, madeAt] of keys) if (madeAt + dedupeTtlMs <= at) keys.delete(k);
    if (keys.size === 0) seen.delete(seatId);
    return keys.has(key);
  };
  const remember = (seatId: string, key: string) => {
    const keys = seen.get(seatId) ?? new Map<string, number>();
    keys.set(key, now().getTime());
    while (keys.size > MAX_DEDUPE_KEYS_PER_SEAT) keys.delete(keys.keys().next().value as string);
    seen.set(seatId, keys);
  };
  const report = (error: unknown) => {
    try {
      onError(error);
    } catch {
      // 오류 보고가 던져도 알림 만들기는 끝낸다.
    }
  };

  return {
    notify: (seatId, input) => {
      const clean = sanitize(input);
      const key = input?.dedupeKey;
      if (clean === null || (key !== undefined && (typeof key !== 'string' || key === '' || key.length > MAX_DEDUPE_KEY_CHARS))) {
        return { ok: false, reason: 'invalid' };
      }
      if (key !== undefined && remembered(seatId, key)) return { ok: false, reason: 'duplicate' };
      const notification: AppNotification = { id: nextId(), ...clean, createdAt: now().toISOString() };
      if (key !== undefined) remember(seatId, key);
      for (const sender of senders) {
        try {
          Promise.resolve(sender.send(seatId, notification)).catch(report);
        } catch (e) {
          report(e);
        }
      }
      return { ok: true, id: notification.id };
    },
    forget: (seatId) => {
      seen.delete(seatId);
      for (const sender of senders) sender.forget?.(seatId);
    },
  };
}

export type Notifications = { notifier: Notifier; outbox: Outbox };

/** 알림함(`Outbox`)을 늘 넣고, 추가 `PushSender`(FCM 등)가 있으면 함께 보내는 알림 묶음을 만든다. */
export function createNotifications({
  now = () => new Date(),
  extraSenders = [],
  outbox: outboxOptions,
  onError,
}: { now?: () => Date; extraSenders?: PushSender[]; outbox?: OutboxOptions; onError?: (error: unknown) => void } = {}): Notifications {
  const outbox = createOutbox({ now, ...outboxOptions });
  return { outbox, notifier: createNotifier({ now, senders: [outbox, ...extraSenders], onError }) };
}
