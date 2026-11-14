import { describe, expect, it } from 'vitest';
import { createNotifications, createNotifier, createIdClock, DEDUPE_TTL_MS, MAX_DEDUPE_KEYS_PER_SEAT } from '../src/notify/notifier.js';
import { createOutbox, MAX_LIST_SIZE, MAX_QUEUE_PER_SEAT, NOTIFICATION_TTL_MS, parseSince } from '../src/notify/outbox.js';
import type { PushSender } from '../src/notify/types.js';
import { MAX_ACK_IDS } from '../src/routes/notifications.js';
import { createSeatStore } from '../src/seats.js';
import { newApp } from './helpers.js';

const T0 = Date.parse('2026-11-11T10:00:00+09:00');
let clockMs = T0;
const now = () => new Date(clockMs);
const fresh = () => {
  clockMs = T0;
  const seats = createSeatStore(now);
  const notifications = createNotifications({ now });
  const app = newApp({ now, seats, notifications, clientAddress: (c) => c.req.header('x-test-ip') ?? 'test' });
  return { app, seats, ...notifications };
};
type Fresh = ReturnType<typeof fresh>;

type Opts = { token?: string; body?: unknown; device?: string };
const call = async (app: Fresh['app'], method: string, path: string, { token, body, device }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-chagok-device'] = device;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as any) };
};
const connect = async (t: Fresh, name: string, o: { device?: string; phoneToken?: string; carToken?: string; mode?: 'new' | 'replace'; seatId?: string } = {}) => {
  let carToken = o.carToken;
  let carId: string | undefined;
  if (!carToken) {
    const first = await call(t.app, 'POST', '/pair/code', { body: {} });
    carToken = first.body.carToken as string;
    carId = first.body.carId as string;
  }
  const issued = await call(t.app, 'POST', '/pair/code', { token: carToken, body: o.mode === 'replace' ? { mode: 'replace', seatId: o.seatId } : {} });
  expect(issued.status).toBe(200);
  const claimed = await call(t.app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device: o.device, token: o.phoneToken });
  expect(claimed.status).toBe(200);
  return { carToken, carId, seatId: claimed.body.seatId as string, phoneToken: claimed.body.phoneToken as string };
};
const input = (over: Record<string, unknown> = {}) => ({ kind: 'events-stale' as const, title: '제목', body: '본문', ...over });
const DEV_A = 'a'.repeat(32);

describe('알림함(Outbox)', () => {
  it('자리별로 따로 쌓고 자기 자리 것만 읽는다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    const b = await connect(t, '폰B', { carToken: a.carToken });
    t.notifier.notify(a.seatId, input({ title: 'A용' }));
    t.notifier.notify(b.seatId, input({ title: 'B용' }));
    const ra = await call(t.app, 'GET', '/notifications', { token: a.phoneToken });
    const rb = await call(t.app, 'GET', '/notifications', { token: b.phoneToken });
    expect(ra.body.notifications.map((n: any) => n.title)).toEqual(['A용']);
    expect(rb.body.notifications.map((n: any) => n.title)).toEqual(['B용']);
    expect(Object.keys(ra.body.notifications[0]).sort()).toEqual(['body', 'createdAt', 'data', 'id', 'kind', 'title']);
  });

  it('since(id)보다 나중 것만, 오래된 것부터 돌려준다. since에 시각도 쓸 수 있다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    const first = t.notifier.notify(a.seatId, input({ title: '1' }));
    clockMs += 60_000;
    const second = t.notifier.notify(a.seatId, input({ title: '2' }));
    clockMs += 60_000;
    t.notifier.notify(a.seatId, input({ title: '3' }));
    if (!first.ok || !second.ok) throw new Error('알림 만들기 실패');
    const all = await call(t.app, 'GET', '/notifications', { token: a.phoneToken });
    expect(all.body.notifications.map((n: any) => n.title)).toEqual(['1', '2', '3']);
    const byId = await call(t.app, 'GET', `/notifications?since=${second.id}`, { token: a.phoneToken });
    expect(byId.body.notifications.map((n: any) => n.title)).toEqual(['3']);
    const byTime = await call(t.app, 'GET', `/notifications?since=${encodeURIComponent(new Date(T0 + 30_000).toISOString())}`, { token: a.phoneToken });
    expect(byTime.body.notifications.map((n: any) => n.title)).toEqual(['2', '3']);
    expect((await call(t.app, 'GET', '/notifications?since=abc', { token: a.phoneToken })).status).toBe(400);
    expect((await call(t.app, 'GET', '/notifications?since=1&since=2', { token: a.phoneToken })).status).toBe(400);
  });

  it('ack하면 지워지고 다른 자리의 id는 지우지 못한다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    const b = await connect(t, '폰B', { carToken: a.carToken });
    const na = t.notifier.notify(a.seatId, input());
    const nb = t.notifier.notify(b.seatId, input());
    if (!na.ok || !nb.ok) throw new Error('알림 만들기 실패');
    expect((await call(t.app, 'POST', '/notifications/ack', { token: a.phoneToken, body: { ids: [nb.id] } })).body).toEqual({ acked: 0 });
    expect(t.outbox.size(b.seatId)).toBe(1);
    expect((await call(t.app, 'POST', '/notifications/ack', { token: a.phoneToken, body: { ids: [na.id, '999'] } })).body).toEqual({ acked: 1 });
    expect((await call(t.app, 'GET', '/notifications', { token: a.phoneToken })).body.notifications).toEqual([]);
    expect((await call(t.app, 'GET', '/notifications', { token: b.phoneToken })).body.notifications).toHaveLength(1);
  });

  it('ack 본문 검증: ids가 없거나 모양이 틀리거나 너무 많으면 400', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    for (const body of [{}, { ids: 'x' }, { ids: [1] }, { ids: ['abc'] }, { ids: Array.from({ length: MAX_ACK_IDS + 1 }, (_, i) => String(i + 1)) }]) {
      expect((await call(t.app, 'POST', '/notifications/ack', { token: a.phoneToken, body })).status).toBe(400);
    }
    expect((await call(t.app, 'POST', '/notifications/ack', { token: a.phoneToken, body: { ids: [] } })).body).toEqual({ acked: 0 });
  });

  it(`큐 상한(${MAX_QUEUE_PER_SEAT})을 넘으면 가장 오래된 것부터 버린다`, () => {
    const outbox = createOutbox({ now, maxPerSeat: 3 });
    const notifier = createNotifier({ now, senders: [outbox] });
    for (let i = 1; i <= 5; i++) notifier.notify('s', input({ title: `n${i}` }));
    expect(outbox.list('s').map((n) => n.title)).toEqual(['n3', 'n4', 'n5']);
    expect(MAX_QUEUE_PER_SEAT).toBeGreaterThan(0);
  });

  it('한 번에 돌려주는 수는 MAX_LIST_SIZE까지다', () => {
    const outbox = createOutbox({ now, maxPerSeat: 1000 });
    const notifier = createNotifier({ now, senders: [outbox] });
    for (let i = 0; i < MAX_LIST_SIZE + 5; i++) notifier.notify('s', input({ title: `n${i}` }));
    expect(outbox.list('s')).toHaveLength(MAX_LIST_SIZE);
  });

  it('TTL이 지난 알림은 읽을 때 버린다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    t.notifier.notify(a.seatId, input({ title: '옛것' }));
    clockMs += NOTIFICATION_TTL_MS - 1;
    t.notifier.notify(a.seatId, input({ title: '새것' }));
    expect((await call(t.app, 'GET', '/notifications', { token: a.phoneToken })).body.notifications.map((n: any) => n.title)).toEqual(['옛것', '새것']);
    clockMs += 1;
    expect((await call(t.app, 'GET', '/notifications', { token: a.phoneToken })).body.notifications.map((n: any) => n.title)).toEqual(['새것']);
    clockMs += NOTIFICATION_TTL_MS;
    expect(t.outbox.size(a.seatId)).toBe(0);
  });

  it('id는 시각 위에서 늘어난다(같은 시각에도 증가, 서버를 다시 켜도 줄지 않음)', () => {
    const clock = createIdClock(now);
    const [x, y] = [clock(), clock()];
    expect(BigInt(y)).toBeGreaterThan(BigInt(x));
    clockMs += 1000;
    const later = createIdClock(now);
    expect(BigInt(later())).toBeGreaterThan(BigInt(y));
  });

  it('IdClock.peek: id를 내지 않고, 지금까지 낸 가장 큰 id와 지금 시각 중 큰 값이다(시계가 뒤로 가도 줄지 않는다)', () => {
    const clock = createIdClock(now);
    expect(clock.peek()).toBe(String(clockMs * 1000));
    expect(clock.peek()).toBe(String(clockMs * 1000)); // 호출해도 늘지 않는다
    const issued = clock();
    expect(clock.peek()).toBe(issued);
    clockMs -= 60 * 60_000; // 시계가 한 시간 뒤로 감
    expect(clock.peek()).toBe(issued);
    expect(BigInt(clock())).toBeGreaterThan(BigInt(issued));
  });

  it('GET /notifications는 id 기준값(cursor)을 함께 준다: 폰이 자기 마지막 id가 이보다 크면 서버가 바뀐 것을 안다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    const empty = await call(t.app, 'GET', '/notifications', { token: a.phoneToken });
    expect(empty.body.cursor).toBe(String(T0 * 1000));
    const made = t.notifier.notify(a.seatId, input());
    const res = await call(t.app, 'GET', '/notifications?since=0', { token: a.phoneToken });
    expect(res.body.cursor).toBe(made.ok ? made.id : '');
    expect((await call(t.app, 'GET', '/notifications', { device: DEV_A })).body.cursor).toBe(res.body.cursor); // 토큰 없는 빈 목록에도 있다
  });

  it('dropKind: 그 자리의 그 종류만 지운다', () => {
    const { notifier, outbox } = createNotifications({ now });
    notifier.notify('s', input({ kind: 'events-stale' }));
    notifier.notify('s', input({ kind: 'late-sms' }));
    notifier.notify('t', input({ kind: 'events-stale' }));
    expect(outbox.dropKind('s', 'events-stale')).toBe(1);
    expect(outbox.list('s').map((n) => n.kind)).toEqual(['late-sms']);
    expect(outbox.size('t')).toBe(1);
    expect(outbox.dropKind('s', 'events-stale')).toBe(0);
    expect(outbox.dropKind('nobody', 'events-stale')).toBe(0);
  });

  it('parseSince: 없음·id·시각·잘못된 값', () => {
    expect(parseSince(undefined)).toBeUndefined();
    expect(parseSince('')).toBeUndefined();
    expect(parseSince('123')).toEqual({ kind: 'id', id: '123' });
    expect(parseSince('2026-11-11T10:00:00+09:00')).toEqual({ kind: 'time', ms: T0 });
    expect(parseSince('2026-11-11')).toBeNull();
    expect(parseSince('0123')).toBeNull();
  });
});

describe('중복 억제와 notify 입력 검증', () => {
  it('같은 dedupeKey는 읽거나 지운 뒤에도 한 번만 만든다. 키가 다르거나 없으면 만든다', () => {
    const { notifier, outbox } = createNotifications({ now });
    expect(notifier.notify('s', input({ dedupeKey: 'k1' })).ok).toBe(true);
    expect(notifier.notify('s', input({ dedupeKey: 'k1' }))).toEqual({ ok: false, reason: 'duplicate' });
    outbox.ack('s', outbox.list('s').map((n) => n.id));
    expect(notifier.notify('s', input({ dedupeKey: 'k1' }))).toEqual({ ok: false, reason: 'duplicate' });
    expect(notifier.notify('s', input({ dedupeKey: 'k2' })).ok).toBe(true);
    expect(notifier.notify('s', input()).ok).toBe(true);
    expect(notifier.notify('s', input()).ok).toBe(true);
    expect(notifier.notify('other', input({ dedupeKey: 'k1' })).ok).toBe(true); // 자리마다 따로
  });

  it('중복 억제 기록은 DEDUPE_TTL_MS가 지나면 잊고, 자리당 개수 상한이 있다', () => {
    const { notifier } = createNotifications({ now });
    notifier.notify('s', input({ dedupeKey: 'k' }));
    clockMs += DEDUPE_TTL_MS - 1;
    expect(notifier.notify('s', input({ dedupeKey: 'k' })).ok).toBe(false);
    clockMs += 1;
    expect(notifier.notify('s', input({ dedupeKey: 'k' })).ok).toBe(true);
    for (let i = 0; i < MAX_DEDUPE_KEYS_PER_SEAT + 1; i++) notifier.notify('t', input({ dedupeKey: `x${i}` }));
    expect(notifier.notify('t', input({ dedupeKey: 'x0' })).ok).toBe(true); // 가장 오래된 키는 잊었다
  });

  it('잘못된 입력은 invalid: 모르는 종류·빈 제목·문자열 아닌 data·너무 많은 data·이상한 키', () => {
    const { notifier, outbox } = createNotifications({ now });
    const bad = [
      input({ kind: 'nope' }),
      input({ title: '  ' }),
      input({ body: 3 }),
      input({ data: { a: 1 } }),
      input({ data: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])) }),
      input({ dedupeKey: '' }),
      input({ dedupeKey: 'x'.repeat(101) }),
      // FCM 예약 키(from·message_type·google*·gcm*)와 서버가 덮어쓰는 id·kind는 data 키로 쓸 수 없다(대소문자 무관).
      ...['from', 'message_type', 'google.c.a.e', 'google.sent_time', 'gcm.notification.x', 'GCM.x', 'From', 'id', 'kind'].map((key) => input({ data: { [key]: 'v' } })),
    ];
    for (const b of bad) expect(notifier.notify('s', b as never)).toEqual({ ok: false, reason: 'invalid' });
    expect(outbox.size('s')).toBe(0);
  });

  it('예약 키와 비슷해도 예약어가 아니면 받는다(frommer·kind2·my.id)', () => {
    const { notifier } = createNotifications({ now });
    expect(notifier.notify('s', input({ data: { frommer: 'v', kind2: 'v', 'my.id': 'v', action: 'resend-events' } })).ok).toBe(true);
  });

  it('긴 제목·본문·data 값은 잘라 담는다', () => {
    const { notifier, outbox } = createNotifications({ now });
    notifier.notify('s', input({ title: 't'.repeat(500), body: 'b'.repeat(2000), data: { k: 'v'.repeat(1000) } }));
    const [n] = outbox.list('s');
    expect([n?.title.length, n?.body.length, n?.data.k?.length]).toEqual([100, 400, 200]);
  });

  it('보낼 곳이 던지거나 거절해도 notify는 끝나고 다른 보낼 곳은 받는다', async () => {
    const errors: unknown[] = [];
    const outbox = createOutbox({ now });
    const throwing: PushSender = { send: () => { throw new Error('동기 실패'); } };
    const rejecting: PushSender = { send: () => Promise.reject(new Error('비동기 실패')) };
    const notifier = createNotifier({ now, senders: [throwing, rejecting, outbox], onError: (e) => errors.push(e) });
    expect(notifier.notify('s', input()).ok).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(outbox.size('s')).toBe(1);
    expect(errors).toHaveLength(2);
  });
});

describe('토큰이 없는 요청과 자리 생명 주기', () => {
  it('토큰이 없으면(기기 id만 있어도) 빈 목록 200, ack은 0건 200이다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    t.notifier.notify(a.seatId, input());
    expect(await call(t.app, 'GET', '/notifications')).toEqual({ status: 200, body: { notifications: [], limit: MAX_LIST_SIZE, cursor: String(T0 * 1000) } });
    expect((await call(t.app, 'GET', '/notifications', { device: DEV_A })).body.notifications).toEqual([]);
    expect(await call(t.app, 'POST', '/notifications/ack', { device: DEV_A, body: { ids: ['1'] } })).toEqual({ status: 200, body: { acked: 0 } });
    expect(t.outbox.size(a.seatId)).toBe(1);
  });

  it('모르는 토큰·이상한 Authorization은 401(폰이 토큰을 버리고 토큰 없이 다시 보낸다)', async () => {
    const t = fresh();
    expect((await call(t.app, 'GET', '/notifications', { token: 'f'.repeat(64) })).status).toBe(401);
    const res = await t.app.request('/notifications', { headers: { authorization: 'Basic abc' } });
    expect(res.status).toBe(401);
    expect((await call(t.app, 'POST', '/notifications/ack', { token: 'f'.repeat(64), body: { ids: [] } })).status).toBe(401);
  });

  it('차 토큰·driver로는 알림함을 읽을 수 없다(폰 토큰만)', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    t.notifier.notify(a.seatId, input());
    expect((await call(t.app, 'GET', `/notifications?driver=${a.seatId}`, { token: a.carToken })).status).toBe(401);
  });

  it('폰의 연결 끊기(DELETE /pair)는 그 자리의 알림을 지우고 옛 토큰은 401이다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    const b = await connect(t, '폰B', { carToken: a.carToken });
    t.notifier.notify(a.seatId, input({ dedupeKey: 'k' }));
    t.notifier.notify(b.seatId, input());
    expect((await call(t.app, 'DELETE', '/pair', { token: a.phoneToken })).status).toBe(200);
    expect(t.outbox.size(a.seatId)).toBe(0);
    expect(t.outbox.size(b.seatId)).toBe(1);
    expect((await call(t.app, 'GET', '/notifications', { token: a.phoneToken })).status).toBe(401);
    expect(t.notifier.notify(a.seatId, input({ dedupeKey: 'k' })).ok).toBe(true); // 중복 억제 기록도 지웠다
  });

  it('차 초기화(DELETE /car)는 그 차의 모든 자리의 알림을 지우고 다른 차는 그대로다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    const b = await connect(t, '폰B', { carToken: a.carToken });
    const other = await connect(t, '다른 차 폰');
    for (const s of [a, b, other]) t.notifier.notify(s.seatId, input());
    expect((await call(t.app, 'DELETE', '/car', { token: a.carToken })).status).toBe(200);
    expect([t.outbox.size(a.seatId), t.outbox.size(b.seatId), t.outbox.size(other.seatId)]).toEqual([0, 0, 1]);
  });

  it('폰 바꾸기(replace)는 옛 폰이 읽지 않은 알림을 새 폰에 넘기지 않는다', async () => {
    const t = fresh();
    const a = await connect(t, '옛 폰');
    t.notifier.notify(a.seatId, input({ title: '옛 폰에게' }));
    const swapped = await connect(t, '새 폰', { carToken: a.carToken, mode: 'replace', seatId: a.seatId });
    expect(swapped.seatId).toBe(a.seatId);
    expect((await call(t.app, 'GET', '/notifications', { token: swapped.phoneToken })).body.notifications).toEqual([]);
    expect((await call(t.app, 'GET', '/notifications', { token: a.phoneToken })).status).toBe(401);
    t.notifier.notify(swapped.seatId, input({ title: '새 폰에게' }));
    expect((await call(t.app, 'GET', '/notifications', { token: swapped.phoneToken })).body.notifications.map((n: any) => n.title)).toEqual(['새 폰에게']);
  });

  it('새 자리 만들기(claim)는 다른 자리의 알림에 영향을 주지 않는다', async () => {
    const t = fresh();
    const a = await connect(t, '폰A');
    t.notifier.notify(a.seatId, input());
    await connect(t, '폰B', { carToken: a.carToken });
    expect(t.outbox.size(a.seatId)).toBe(1);
  });
});
