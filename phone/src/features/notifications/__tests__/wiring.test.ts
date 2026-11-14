/**
 * 폰 폴링 + 서버 알림함을 실제 서버 앱(진짜 라우트)에 hc로 묶은 테스트: 연결한 폰이 알림을 받아 가고(ack로 서버에서 지워지고),
 * 연결 전·바뀐 토큰은 빈 목록으로 이어지고, 알림은 자리별로 따로 간다.
 */
import { hc } from 'hono/client';

import type { AppType } from '@chagok/server';
import { createApp } from '../../../../../server/src/app';
import { createNotifications } from '../../../../../server/src/notify/notifier';
import { createSeatStore } from '../../../../../server/src/seats';
import { authHeaders, createSession, withSessionReset, type DeviceStorage, type TokenStorage } from '../../../api/session';
import { createInbox } from '../inbox';
import { createMemoryStorage } from '../keyValue';
import { createNotificationsApi } from '../notificationsApi';
import { createNotificationPoller } from '../poller';
import { fakeNotifier, fakeSync, idsOf } from '../../../__tests__/support/notifications';

// 시스템 알림 구현(expo-notifications)은 이 테스트에서 쓰지 않는다(가져오는 것만으로 Expo Go 경고가 나므로 막는다).
jest.mock('../localNotifier', () => ({ expoLocalNotifier: {} }));

const memoryToken = (initial: string | null = null): TokenStorage => {
  let value = initial;
  return { read: async () => value, write: async (t) => void (value = t), remove: async () => void (value = null) };
};
const memoryDevice = (id: string): DeviceStorage => ({ read: async () => id, write: async () => undefined });

const setup = (now?: () => Date) => {
  const seats = createSeatStore();
  const notifications = createNotifications({ now });
  const app = createApp({ fixture: { schedules: [] } as never, calendars: [], places: { places: [], suggestions: [], remembered: [] } as never, familyMembers: [], seats, notifications });
  const clientFor = (token: string | null, device: string) => {
    const session = createSession(memoryToken(token), memoryDevice(device));
    const api = hc<AppType>('http://server.test', { headers: authHeaders(session), fetch: withSessionReset(session, async (input, init) => app.request(input as string, init)) });
    return { api, session };
  };
  const postJson = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
    (await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).json() as Promise<any>;
  const connectPhone = async (carToken: string | null, name: string) => {
    const car = carToken ? { carToken } : await postJson('/pair/code', {});
    const issued = await postJson('/pair/code', {}, { authorization: `Bearer ${car.carToken}` });
    const claimed = await postJson('/pair/claim', { code: issued.code, name }, { 'x-chagok-device': 'p'.repeat(32) });
    return { carToken: car.carToken as string, seatId: claimed.seatId as string, phoneToken: claimed.phoneToken as string };
  };
  return { app, seats, ...notifications, clientFor, connectPhone };
};

describe('폰 폴링 ↔ 서버 알림함', () => {
  it('연결한 폰이 알림을 받아 알림함·시스템 알림에 반영하고, ack으로 서버에서 지운다', async () => {
    const s = setup();
    const a = await s.connectPhone(null, '폰A');
    const { api } = s.clientFor(a.phoneToken, 'a'.repeat(32));
    s.notifier.notify(a.seatId, { kind: 'events-stale', title: '차곡이 일정을 못 받고 있어요', body: '앱을 열면 일정을 새로 보내요.', data: { action: 'resend-events' } });
    const inbox = createInbox({ storage: createMemoryStorage() });
    const { notifier, present } = fakeNotifier('granted');
    const poller = createNotificationPoller({ api: createNotificationsApi(api), inbox, notifier, log: () => undefined, hasSession: async () => true });
    expect(await poller.poll()).toBe('ok');
    expect(inbox.getState().items[0]).toMatchObject({ kind: 'events-stale', title: '차곡이 일정을 못 받고 있어요', data: { action: 'resend-events' } });
    expect(present).toHaveBeenCalledTimes(1);
    expect(s.outbox.size(a.seatId)).toBe(0); // ack로 서버에서 지워졌다
    expect(await poller.poll()).toBe('ok');
    expect(present).toHaveBeenCalledTimes(1);
  });

  it('자리별로 따로 간다: 다른 폰의 알림은 받지 않는다', async () => {
    const s = setup();
    const a = await s.connectPhone(null, '폰A');
    const b = await s.connectPhone(a.carToken, '폰B');
    s.notifier.notify(b.seatId, { kind: 'family-status', title: 'B의 알림', body: '' });
    const inbox = createInbox({ storage: createMemoryStorage() });
    const poller = createNotificationPoller({ api: createNotificationsApi(s.clientFor(a.phoneToken, 'a'.repeat(32)).api), inbox, notifier: fakeNotifier().notifier, log: () => undefined, hasSession: async () => true });
    await poller.poll();
    expect(idsOf(inbox)).toEqual([]);
    expect(s.outbox.size(b.seatId)).toBe(1);
  });

  it('서버가 모르는 토큰(바뀐 폰)이면 토큰을 버리고 빈 목록으로 이어진다(401로 깨지지 않는다)', async () => {
    const s = setup();
    const { api, session } = s.clientFor('s'.repeat(64), 'a'.repeat(32));
    const inbox = createInbox({ storage: createMemoryStorage() });
    const poller = createNotificationPoller({ api: createNotificationsApi(api), inbox, notifier: fakeNotifier().notifier, log: () => undefined, hasSession: async () => Boolean(await session.getToken()) });
    expect(await poller.poll()).toBe('ok');
    expect(idsOf(inbox)).toEqual([]);
    expect(await session.getToken()).toBeNull();
    expect(await poller.poll()).toBe('no-session'); // 토큰이 없으니 다음부터는 묻지도 않는다
  });

  it('일정을 서버가 받으면 아직 안 읽어 간 events-stale은 서버에서 지워져 폰이 받지 않는다', async () => {
    const s = setup();
    const a = await s.connectPhone(null, '폰A');
    const { api } = s.clientFor(a.phoneToken, 'a'.repeat(32));
    s.notifier.notify(a.seatId, { kind: 'events-stale', title: '차곡이 일정을 못 받고 있어요', body: '', data: { action: 'resend-events' } });
    const put = await s.app.request('/events', { method: 'PUT', headers: { authorization: `Bearer ${a.phoneToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: [] }) });
    expect(put.status).toBe(200);
    const inbox = createInbox({ storage: createMemoryStorage() });
    const { notifier, present } = fakeNotifier('granted');
    const poller = createNotificationPoller({ api: createNotificationsApi(api), inbox, notifier, log: () => undefined, hasSession: async () => true, sync: fakeSync('failed').sync });
    expect(await poller.poll()).toBe('ok');
    expect(idsOf(inbox)).toEqual([]);
    expect(present).not.toHaveBeenCalled();
  });

  it('폰이 events-stale을 받을 때 일정 동기화가 성공으로 끝나면 띄우지 않고 서버에서는 지운다', async () => {
    const s = setup();
    const a = await s.connectPhone(null, '폰A');
    const { api } = s.clientFor(a.phoneToken, 'a'.repeat(32));
    s.notifier.notify(a.seatId, { kind: 'events-stale', title: '차곡이 일정을 못 받고 있어요', body: '' });
    const inbox = createInbox({ storage: createMemoryStorage() });
    const { notifier, present } = fakeNotifier('granted');
    const poller = createNotificationPoller({ api: createNotificationsApi(api), inbox, notifier, log: () => undefined, hasSession: async () => true, sync: fakeSync('sent').sync });
    expect(await poller.poll()).toBe('ok');
    expect(idsOf(inbox)).toEqual([]);
    expect(present).not.toHaveBeenCalled();
    expect(s.outbox.size(a.seatId)).toBe(0);
  });

  it('다른 서버(또는 시계가 뒤로 간 서버)로 바뀌면 마지막 id를 버리고 새 서버의 알림을 받는다', async () => {
    const first = setup();
    const a1 = await first.connectPhone(null, '폰A');
    first.notifier.notify(a1.seatId, { kind: 'late-sms', title: '옛 서버 알림', body: '' });
    const inbox = createInbox({ storage: createMemoryStorage() });
    const poll = (s: ReturnType<typeof setup>, token: string) =>
      createNotificationPoller({ api: createNotificationsApi(s.clientFor(token, 'a'.repeat(32)).api), inbox, notifier: fakeNotifier('denied').notifier, log: () => undefined, hasSession: async () => true, sync: fakeSync().sync }).poll();
    await poll(first, a1.phoneToken);
    expect(inbox.getState().items.map((i) => i.title)).toEqual(['옛 서버 알림']);
    // 서버 시계가 한 시간 늦은 다른 서버: 알림 id가 폰의 마지막 id보다 작다.
    const second = setup(() => new Date(Date.now() - 3_600_000));
    const a2 = await second.connectPhone(null, '폰A');
    second.notifier.notify(a2.seatId, { kind: 'late-sms', title: '새 서버 알림', body: '' });
    expect(await poll(second, a2.phoneToken)).toBe('ok');
    expect(inbox.getState().items.map((i) => i.title).sort()).toEqual(['새 서버 알림', '옛 서버 알림']);
  });

  it('토큰 없이(기기 id만) 직접 부르면 서버는 빈 목록을 준다', async () => {
    const s = setup();
    const { api } = s.clientFor(null, 'a'.repeat(32));
    const res = await api.notifications.$get({ query: { since: undefined } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifications: [], limit: 50, cursor: expect.stringMatching(/^[1-9]\d+$/) });
  });
});
