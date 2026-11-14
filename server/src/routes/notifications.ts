import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES } from '../limits.js';
import type { Notifications } from '../notify/notifier.js';
import { MAX_LIST_SIZE, parseSince } from '../notify/outbox.js';
import type { AppNotification } from '../notify/types.js';
import { bearerOf } from '../seatScope.js';
import type { SeatStore } from '../seats.js';

/** `POST /notifications/ack` 한 번에 지울 수 있는 id 수. */
export const MAX_ACK_IDS = 100;

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) });
const unauthorized = (c: Context) =>
  c.json({ error: '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요', reason: 'unauthorized' as const }, 401);

/**
 * 요청의 폰 토큰이 가리키는 자리. 알림함은 폰 토큰으로만 읽는다(기기 id·`driver`·차 토큰·기본 자리는 쓰지 않는다).
 * - 토큰 없음(연결 전·기기 id만): `none`. 읽으면 빈 목록, ack은 0건으로 200이다(폰이 401로 깨지지 않게).
 * - 모르는 토큰·이상한 Authorization 형식: 401(다른 데이터 라우트와 같다. 폰의 `withSessionReset`이 토큰을 버리고 토큰 없이 다시 보내면 빈 목록이 된다).
 */
const seatOf = (seats: SeatStore, c: Context): { kind: 'seat'; seatId: string } | { kind: 'none' } | { kind: 'unauthorized' } => {
  const auth = bearerOf(c);
  if (auth.kind === 'none') return { kind: 'none' };
  if (auth.kind === 'bad') return { kind: 'unauthorized' };
  const found = seats.seatByToken(auth.token);
  return found ? { kind: 'seat', seatId: found.seat.seatId } : { kind: 'unauthorized' };
};

const ID_PATTERN = /^[1-9]\d{0,19}$/;

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createNotificationsRoute = (seats: SeatStore, { outbox, notifier }: Pick<Notifications, 'outbox' | 'notifier'>) =>
  new Hono()
    .get(
      '/',
      validator('query', (value: { since?: string | string[] }, c) => {
        const raw = value.since;
        if (raw !== undefined && typeof raw !== 'string') return c.json({ error: 'since는 하나만 줄 수 있습니다' }, 400);
        if (parseSince(raw) === null) return c.json({ error: 'since는 알림 id(숫자) 또는 ISO8601 시각이어야 합니다' }, 400);
        return { since: raw as string | undefined };
      }),
      (c) => {
        const who = seatOf(seats, c);
        if (who.kind === 'unauthorized') return unauthorized(c);
        const since = parseSince(c.req.valid('query').since) ?? undefined;
        const notifications: AppNotification[] = who.kind === 'seat' ? outbox.list(who.seatId, since) : [];
        return c.json({ notifications, limit: MAX_LIST_SIZE, cursor: notifier.cursor() }, 200);
      },
    )
    .post(
      '/ack',
      tooLarge,
      validator('json', (raw: unknown, c) => {
        const ids = (raw as { ids?: unknown } | null)?.ids;
        if (!Array.isArray(ids) || ids.length > MAX_ACK_IDS || !ids.every((id): id is string => typeof id === 'string' && ID_PATTERN.test(id))) {
          return c.json({ error: `ids는 알림 id 문자열 ${MAX_ACK_IDS}개 이하의 배열이어야 합니다` }, 400);
        }
        return { ids };
      }),
      (c) => {
        const who = seatOf(seats, c);
        if (who.kind === 'unauthorized') return unauthorized(c);
        const acked = who.kind === 'seat' ? outbox.ack(who.seatId, c.req.valid('json').ids) : 0;
        return c.json({ acked }, 200);
      },
    );
