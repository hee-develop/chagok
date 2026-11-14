/**
 * 정책서 10.9: 폰 '차 연결 끊기'(`DELETE /pair`)와 차 '차곡 초기화'(`DELETE /car`)가 자리에 붙은 데이터를 **항목별로** 모두 지우는지,
 * 폰 바꾸기는 기억만 남기는지 확인한다. 자리 데이터는 `SeatData` 한 묶음이고 자리를 지우면 묶음째 버려진다(`seatData.ts`의 SEAT_DATA_POLICY).
 */
import { describe, expect, it } from 'vitest';
import { createNotifications } from '../src/notify/notifier.js';
import type { PushSender } from '../src/notify/types.js';
import { createSelectionStore } from '../src/routes/calendars.js';
import { createEventsStore } from '../src/routes/events.js';
import { createFamilyStore } from '../src/routes/family.js';
import { createFavoritesStore } from '../src/routes/places.js';
import { createSeatDataRegistry, SEAT_DATA_POLICY, type SeatData } from '../src/seatData.js';
import { createSeatStore } from '../src/seats.js';
import { fixture, newApp } from './helpers.js';
import { call, connectPhone, event, registerCar } from './pairHelpers.js';

const seoul = (s: string) => Date.parse(`${s}+09:00`);
const clockMs = seoul('2026-11-11T09:00:00');
const now = () => new Date(clockMs);

const setup = () => {
  const seats = createSeatStore(now);
  const registry = createSeatDataRegistry({ now, fixtureIds: new Set(fixture.schedules.map((s) => s.id)) });
  const forgotten: string[] = [];
  const spy: PushSender = { send: () => undefined, forget: (seatId) => void forgotten.push(seatId) };
  const notifications = createNotifications({ now, extraSenders: [spy] });
  const app = newApp({ now, seats, seatData: registry, notifications });
  return { app, seats, registry, notifications, forgotten };
};
type Setup = ReturnType<typeof setup>;

/** 자리 하나에 자리 데이터 항목을 모두 채운다(+ 알림함). */
const fillSeat = async ({ app, notifications }: Setup, seat: { seatId: string; phoneToken: string }, car: { carToken: string }) => {
  const token = seat.phoneToken;
  expect((await call(app, 'PUT', '/events', { token, body: { events: [event({ id: 'e1' }), event({ id: 'e2', start: '2026-11-12T10:00:00+09:00', end: '2026-11-12T11:00:00+09:00' })] } })).status).toBe(200);
  expect((await call(app, 'PUT', '/calendars/selection', { token, body: { selectedIds: ['cal-1'], revision: 1, source: 'device' } })).status).toBe(200);
  expect((await call(app, 'PUT', '/places/favorites/home', { token, body: { placeId: 'mock-home-apt' } })).status).toBe(200);
  expect((await call(app, 'POST', '/places/favorites/others', { token, body: { placeId: 'mock-station' } })).status).toBe(200);
  expect((await call(app, 'PUT', '/schedules/e1/place', { token, body: { placeId: 'mock-library' } })).status).toBe(200);
  expect((await call(app, 'PUT', '/schedules/e2/place', { token, body: { noTravel: true } })).status).toBe(200);
  expect((await call(app, 'PUT', '/schedules/e1/care', { token, body: { care: '우산' } })).status).toBe(200);
  expect((await call(app, 'POST', '/schedules/e1/family-request', { token, body: { memberId: 'family-mom' } })).status).toBe(200);
  expect((await call(app, 'PUT', '/places/memory', { token, body: { name: '단골 콩물집', place: { name: '콩물집', lat: 35.146, lng: 126.922 }, ambiguous: false } })).status).toBe(200);
  expect((await call(app, 'PUT', '/skips', { token, body: { add: ['KIA 직관'] } })).status).toBe(200);
  expect((await call(app, 'POST', '/presence', { token, body: { connected: true } })).status).toBe(200);
  expect((await call(app, 'POST', `/arrivals?driver=${seat.seatId}`, { token: car.carToken, body: { scheduleId: 'e1', place: { name: '광주 시립도서관', lat: 35.1329, lng: 126.9025 } } })).status).toBe(200);
  expect(notifications.notifier.notify(seat.seatId, { kind: 'family-status', title: '알림', body: '내용' }).ok).toBe(true);
};

/**
 * 자리 데이터 항목별로 '채워져 있다'. `Record<keyof SeatData, …>`라 새 항목을 `SeatData`에 더하면 여기서도 타입 오류가 나고,
 * 아래 `filled()`·`ALL_FILLED`·`ALL_EMPTY`는 `SEAT_DATA_POLICY`의 키에서 만들어 항목이 빠지지 않는다.
 */
const IS_FILLED: Record<keyof SeatData, (d: SeatData) => boolean> = {
  events: (d) => (d.events.get()?.events.length ?? 0) > 0,
  selection: (d) => d.selection.get() !== null,
  favorites: (d) => d.favorites.get().home !== null && d.favorites.get().others.length > 0,
  family: (d) => d.family.list().length > 0,
  overrides: (d) => d.overrides.size > 0,
  cares: (d) => d.cares.size > 0,
  memory: (d) => d.memory.size() > 0,
  arrivals: (d) => d.arrivals.list().length > 0,
  skips: (d) => d.skips.size() > 0,
};
const KEYS = Object.keys(SEAT_DATA_POLICY) as (keyof SeatData)[];
const filled = (d: SeatData) => Object.fromEntries(KEYS.map((key) => [key, IS_FILLED[key](d)])) as Record<keyof SeatData, boolean>;
const ALL_FILLED = Object.fromEntries(KEYS.map((key) => [key, true]));
const ALL_EMPTY = Object.fromEntries(KEYS.map((key) => [key, false]));

describe('자리 데이터 등록 방식', () => {
  it('자리 데이터의 모든 항목이 폰 바꾸기 때의 처리를 선언한다(빠뜨리면 타입 오류이고, 여기서는 실제 키와 대조한다)', () => {
    const registry = createSeatDataRegistry({ now, fixtureIds: new Set() });
    expect(Object.keys(registry.get('seat-x')).sort()).toEqual(Object.keys(SEAT_DATA_POLICY).sort());
    expect(SEAT_DATA_POLICY).toMatchObject({ favorites: 'keep', family: 'keep', memory: 'keep', arrivals: 'keep', skips: 'keep', events: 'reset', selection: 'reset', overrides: 'reset', cares: 'reset' });
    expect(Object.keys(IS_FILLED).sort()).toEqual(KEYS.slice().sort()); // 채움 판정도 같은 키를 다룬다
  });

  it('자리를 지우면 항목에 상관없이 묶음 전체가 새것으로 바뀐다(공유되는 저장소가 남지 않는다)', async () => {
    const s = setup();
    const car = await registerCar(s.app);
    const seat = await connectPhone(s.app, car, '폰');
    await fillSeat(s, seat, car);
    const before = s.registry.get(seat.seatId);
    expect((await call(s.app, 'DELETE', '/pair', { token: seat.phoneToken })).status).toBe(200);
    const after = s.registry.get(seat.seatId);
    for (const key of Object.keys(SEAT_DATA_POLICY) as (keyof SeatData)[]) expect(after[key], key).not.toBe(before[key]);
  });

  it("폰 바꾸기는 'keep' 항목(기억)을 그대로 두고 'reset' 항목을 비운다", async () => {
    const s = setup();
    const car = await registerCar(s.app);
    const seat = await connectPhone(s.app, car, '폰');
    await fillSeat(s, seat, car);
    const before = s.registry.get(seat.seatId);
    const filledBefore = filled(before); // 폰 바꾸기는 같은 묶음을 제자리에서 고치므로, 바꾸기 전에 읽어 둔다
    const issued = await call(s.app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId: seat.seatId } });
    expect((await call(s.app, 'POST', '/pair/claim', { body: { code: issued.body.code, name: '새 폰' } })).status).toBe(200);
    const after = s.registry.get(seat.seatId);
    // 폰 바꾸기 전에는 모든 항목이 채워져 있어야 한다(fillSeat가 새 항목을 빠뜨리면 여기서 드러난다).
    expect(filledBefore).toEqual(ALL_FILLED);
    // 정책 키를 모두 돈다: 'keep'은 같은 저장소 그대로 채워져 있고, 'reset'은 비워진다.
    const keepers: string[] = [];
    const resets: string[] = [];
    for (const key of KEYS) {
      if (SEAT_DATA_POLICY[key] === 'keep') {
        keepers.push(key);
        expect(after[key], key).toBe(before[key]);
        expect(IS_FILLED[key](after), `keep ${key}`).toBe(true);
      } else {
        resets.push(key);
        expect(IS_FILLED[key](after), `reset ${key}`).toBe(false);
      }
    }
    expect(keepers.length + resets.length).toBe(KEYS.length);
    expect(resets.sort()).toEqual(['cares', 'events', 'overrides', 'selection']);
  });
});

describe('createApp({ seatData })', () => {
  it('seatData와 같은 일을 하는 옵션(events·store·favorites·familyStore·capacity)을 함께 주면 조용히 무시하지 않고 오류를 던진다', () => {
    const registry = createSeatDataRegistry({ now, fixtureIds: new Set() });
    expect(() => newApp({ now, seatData: registry })).not.toThrow();
    expect(() => newApp({ now, seatData: registry, capacity: { maxBuckets: 3 } })).toThrow(/seatData.*capacity/);
    expect(() => newApp({ now, seatData: registry, events: createEventsStore(now), favorites: createFavoritesStore() })).toThrow(/events·favorites/);
    expect(() => newApp({ now, seatData: registry, store: createSelectionStore(), familyStore: createFamilyStore(now) })).toThrow(/store·familyStore/);
    // seatData가 없으면 그 옵션들은 기본 자리 저장소로 쓰인다.
    expect(() => newApp({ now, events: createEventsStore(now), capacity: { maxBuckets: 3 } })).not.toThrow();
  });
});

describe.each([
  ['DELETE /pair (폰 연결 끊기)', 'phone'],
  ['DELETE /car (차곡 초기화)', 'car'],
] as const)('%s', (_name, who) => {
  const wipe = async (s: Setup, car: { carToken: string }, seat: { phoneToken: string }) => {
    const res = who === 'phone' ? await call(s.app, 'DELETE', '/pair', { token: seat.phoneToken }) : await call(s.app, 'DELETE', '/car', { token: car.carToken });
    expect(res.status).toBe(200);
    return res.body;
  };

  it('그 자리의 연결·일정·선택·자주 가는 곳·가족 요청·보정·채비·도착 횟수·접속 상태·알림·푸시 토큰을 항목별로 모두 지운다', async () => {
    const s = setup();
    const car = await registerCar(s.app);
    const a = await connectPhone(s.app, car, '폰A');
    await fillSeat(s, a, car);
    expect(filled(s.registry.get(a.seatId))).toEqual(ALL_FILLED);
    expect(s.notifications.outbox.size(a.seatId)).toBe(1);

    const body = await wipe(s, car, a);
    expect(who === 'phone' ? body.seatId : body.removedSeats).toBe(who === 'phone' ? a.seatId : 1);

    // 연결: 자리·폰 토큰·접속 상태, 차 목록
    expect(s.seats.seat(a.seatId)).toBeNull();
    expect((await call(s.app, 'GET', '/pair', { token: a.phoneToken })).status).toBe(401);
    expect((await call(s.app, 'POST', '/presence', { token: a.phoneToken, body: { connected: true } })).status).toBe(401);
    expect((await call(s.app, 'GET', '/drivers', { token: car.carToken })).body.seats).toEqual([]);
    // 데이터: 항목별로 비어 있다
    const fresh = s.registry.get(a.seatId);
    expect(filled(fresh)).toEqual(ALL_EMPTY);
    expect(fresh.events.get()).toBeNull(); // '받았고 0건'이 아니라 받은 적 없음
    expect(fresh.arrivals.list()).toEqual([]);
    expect(fresh.favorites.get()).toMatchObject({ home: null, work: null, others: [] });
    // 알림함·중복 억제·푸시 토큰
    expect(s.notifications.outbox.size(a.seatId)).toBe(0);
    expect(s.forgotten).toEqual([a.seatId]);
    // 옛 토큰으로는 어떤 데이터에도 닿지 않는다.
    for (const [method, path, payload] of [['GET', '/events'], ['GET', '/places/favorites'], ['GET', '/family/requests'], ['PUT', '/events', { events: [] }]] as const) {
      expect((await call(s.app, method, path, { token: a.phoneToken, body: payload })).status, `${method} ${path}`).toBe(401);
    }
  });

  it('다른 자리의 데이터·알림은 그대로 둔다(차 초기화는 그 차의 자리만, 연결 끊기는 그 자리만)', async () => {
    const s = setup();
    const car1 = await registerCar(s.app);
    const a = await connectPhone(s.app, car1, '폰A');
    const car2 = await registerCar(s.app);
    const b = await connectPhone(s.app, car2, '폰B');
    await fillSeat(s, a, car1);
    await fillSeat(s, b, car2);
    const bData = s.registry.get(b.seatId);
    await wipe(s, car1, a);
    expect(s.registry.get(b.seatId)).toBe(bData);
    expect(filled(bData)).toEqual(ALL_FILLED);
    expect(s.notifications.outbox.size(b.seatId)).toBe(1);
    expect(s.seats.seat(b.seatId)).not.toBeNull();
    expect((await call(s.app, 'GET', '/pair', { token: b.phoneToken })).status).toBe(200);
    expect(s.forgotten).toEqual([a.seatId]);
  });

  it('지운 뒤에도 같은 차가 새 코드를 받아 새 자리를 만들 수 있고, 새 자리는 옛 데이터를 이어받지 않는다', async () => {
    const s = setup();
    const car = await registerCar(s.app);
    const a = await connectPhone(s.app, car, '폰A', 'p'.repeat(32));
    await fillSeat(s, a, car);
    await wipe(s, car, a);
    const again = await connectPhone(s.app, car, '폰A', 'p'.repeat(32));
    expect(again.seatId).not.toBe(a.seatId);
    expect(filled(s.registry.get(again.seatId))).toEqual(ALL_EMPTY);
    expect((await call(s.app, 'GET', '/schedules/today', { token: again.phoneToken })).body.schedules).toEqual([]);
  });
});

describe('DELETE /car: 자리가 여럿이고 코드가 떠 있을 때', () => {
  it('차의 모든 자리와 데이터를 지우고 떠 있던 코드도 쓸 수 없다', async () => {
    const s = setup();
    const car = await registerCar(s.app);
    const a = await connectPhone(s.app, car, '폰A');
    const b = await connectPhone(s.app, car, '폰B');
    await fillSeat(s, a, car);
    await fillSeat(s, b, car);
    const issued = await call(s.app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId: a.seatId } });
    expect((await call(s.app, 'DELETE', '/car', { token: car.carToken })).body).toEqual({ removedSeats: 2 });
    expect((await call(s.app, 'POST', '/pair/claim', { body: { code: issued.body.code, name: '새 폰' } })).status).toBe(404);
    expect((await call(s.app, 'GET', '/pair/status', { token: car.carToken })).body.state).toBe('none');
    for (const id of [a.seatId, b.seatId]) {
      expect(filled(s.registry.get(id))).toEqual(ALL_EMPTY);
      expect(s.notifications.outbox.size(id)).toBe(0);
    }
    expect(s.forgotten.sort()).toEqual([a.seatId, b.seatId].sort());
  });
});
