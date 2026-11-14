import { describe, expect, it } from 'vitest';
import { afterDawn, dailyAtDawn, DAWN_HOUR, pruneSilentSeats, registerMaintenanceJobs, SILENT_SEAT_AFTER_MS } from '../src/jobs.js';
import { createNotifications } from '../src/notify/notifier.js';
import { createScheduler } from '../src/scheduler.js';
import { createSeatDataRegistry } from '../src/seatData.js';
import { CODE_TTL_MS, SEATLESS_CAR_TTL_MS, createSeatStore } from '../src/seats.js';
import { DAY_MS } from '../src/time.js';
import { fixture, newApp } from './helpers.js';
import { call, connectPhone, event, registerCar } from './pairHelpers.js';

const seoul = (s: string) => Date.parse(`${s}+09:00`);
let clockMs = seoul('2026-11-11T09:00:00');
const now = () => new Date(clockMs);
const at = (s: string) => {
  clockMs = seoul(s);
};

/** 서울 2026-11-11 09:00에 시작하는 서버: 자리 저장소·자리 데이터 저장소·알림함·스케줄러(정리 작업 등록)를 한 시계로 묶는다. */
const setup = () => {
  at('2026-11-11T09:00:00');
  const seats = createSeatStore(now);
  const registry = createSeatDataRegistry({ now, fixtureIds: new Set(fixture.schedules.map((s) => s.id)) });
  const notifications = createNotifications({ now });
  const app = newApp({ now, seats, seatData: registry, notifications });
  const scheduler = createScheduler({ now });
  const logs: string[] = [];
  registerMaintenanceJobs({ scheduler, seats, registry, log: (m) => logs.push(m) });
  return { app, seats, registry, notifications, scheduler, logs };
};

/** 연결한 폰이 일정 셋을 보내고 e1에 보정·채비, e2에 채비를 적는다. */
const fill = async (app: ReturnType<typeof setup>['app'], token: string) => {
  const events = [
    event({ id: 'e1', start: '2026-11-11T10:00:00+09:00', end: '2026-11-11T11:00:00+09:00' }), // 오늘 안에 끝남
    event({ id: 'e2', start: '2026-11-12T10:00:00+09:00', end: '2026-11-12T11:00:00+09:00' }), // 내일
    event({ id: 'e3', start: '2026-11-11T23:00:00+09:00', end: '2026-11-12T01:00:00+09:00' }), // 자정을 넘김
  ];
  expect((await call(app, 'PUT', '/events', { token, body: { events } })).status).toBe(200);
  expect((await call(app, 'PUT', '/schedules/e1/place', { token, body: { placeId: 'mock-station' } })).status).toBe(200);
  expect((await call(app, 'PUT', '/schedules/e1/care', { token, body: { care: '우산' } })).status).toBe(200);
  expect((await call(app, 'PUT', '/schedules/e2/care', { token, body: { care: '노트북' } })).status).toBe(200);
  expect((await call(app, 'PUT', '/schedules/e3/place', { token, body: { placeId: 'mock-library' } })).status).toBe(200);
};

describe('새벽 판정', () => {
  it('서울 04:00부터 새벽이다(UTC 날짜와 무관)', () => {
    expect(DAWN_HOUR).toBe(4);
    expect(afterDawn(new Date(seoul('2026-11-12T03:59:59')))).toBe(false);
    expect(afterDawn(new Date(seoul('2026-11-12T04:00:00')))).toBe(true);
    expect(afterDawn(new Date(seoul('2026-11-12T23:59:59')))).toBe(true);
    // 서울 04:00은 UTC로는 전날 19:00이다.
    expect(afterDawn(new Date('2026-11-11T19:00:00Z'))).toBe(true);
    expect(afterDawn(new Date('2026-11-11T18:59:59Z'))).toBe(false);
  });

  it('서울 날짜마다 새벽 이후 처음 한 번만 돌고, 던지면 다음 판정에서 다시 시도한다', () => {
    const runs: string[] = [];
    let fail = true;
    const job = dailyAtDawn('t', (d) => {
      runs.push(d.toISOString());
      if (fail) throw new Error('boom');
    });
    job.run(new Date(seoul('2026-11-12T03:00:00'))); // 새벽 전
    expect(runs).toEqual([]);
    expect(() => job.run(new Date(seoul('2026-11-12T04:00:00')))).toThrow();
    fail = false;
    job.run(new Date(seoul('2026-11-12T04:05:00'))); // 실패했으니 다시
    job.run(new Date(seoul('2026-11-12T04:10:00'))); // 그날 끝
    job.run(new Date(seoul('2026-11-12T23:00:00')));
    expect(runs).toHaveLength(2);
    job.run(new Date(seoul('2026-11-13T04:00:00')));
    expect(runs).toHaveLength(3);
    // 04:00에 꺼져 있다가 낮에 켜져도 그날 안에 따라잡는다.
    job.run(new Date(seoul('2026-11-14T15:00:00')));
    expect(runs).toHaveLength(4);
  });
});

describe('purge-expired: 새벽 지난 일정 삭제', () => {
  it('모든 자리·기본 자리·연결 전 버킷의 지난 일정과 딸린 보정·채비를 서울 날짜 기준으로 지운다', async () => {
    const { app, registry, scheduler, logs } = setup();
    const car = await registerCar(app);
    const a = await connectPhone(app, car, '폰A');
    const b = await connectPhone(app, car, '폰B');
    await fill(app, a.phoneToken);
    await fill(app, b.phoneToken);
    const device = 'd'.repeat(32);
    expect((await call(app, 'PUT', '/events', { device, body: { events: [event({ id: 'b1', start: '2026-11-11T10:00:00+09:00', end: '2026-11-11T11:00:00+09:00' })] } })).status).toBe(200);
    // 식별 없는 쓰기는 기본 자리로 간다.
    expect((await call(app, 'PUT', '/events', { body: { events: [event({ id: 'd1', start: '2026-11-11T10:00:00+09:00', end: '2026-11-11T11:00:00+09:00' })] } })).status).toBe(200);

    // 서울 11-12 03:59(UTC로는 아직 11-11): 새벽 전이라 작업이 돌지 않는다(읽지 않았으니 보정·채비도 그대로).
    at('2026-11-12T03:59:59');
    await scheduler.tick();
    for (const s of [a, b]) {
      const d = registry.get(s.seatId);
      expect([...d.overrides.keys()].sort()).toEqual(['e1', 'e3']);
      expect([...d.cares.keys()].sort()).toEqual(['e1', 'e2']);
    }
    expect(logs).toEqual([]);

    // 04:00: 작업이 돈다. e1(어제 끝남)만 사라지고, 자정을 넘긴 e3과 내일 e2는 남는다.
    at('2026-11-12T04:00:00');
    await scheduler.tick();
    for (const s of [a, b]) {
      const d = registry.get(s.seatId);
      expect([...d.overrides.keys()]).toEqual(['e3']);
      expect([...d.cares.keys()]).toEqual(['e2']);
      expect(d.events.get()?.events.map((e) => e.id).sort()).toEqual(['e2', 'e3']);
    }
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('지난 일정 4건'); // 폰A·폰B·버킷·기본 자리에서 한 건씩
    expect(registry.get('default').events.get()?.events).toEqual([]);

    // 그날 두 번째 판정은 아무것도 하지 않는다.
    at('2026-11-12T10:00:00');
    await scheduler.tick();
    expect(logs).toHaveLength(1);

    // 11-13 새벽: e2·e3도 지난다. 폰 일정은 '받았고 0건' 상태로 남는다(픽스처로 떨어지지 않음).
    at('2026-11-13T04:00:00');
    await scheduler.tick();
    for (const s of [a, b]) {
      const d = registry.get(s.seatId);
      expect(d.overrides.size).toBe(0);
      expect(d.cares.size).toBe(0);
      expect(d.events.get()).toMatchObject({ events: [] });
    }
    expect(logs).toHaveLength(2);
    expect(logs[1]).toContain('지난 일정 4건'); // e2·e3 × 두 자리(버킷·기본 자리는 e1 하나뿐이라 이미 지웠음)
  });

  it('픽스처 일정의 보정·채비는 폰 일정이 없는 기본 자리에서 남긴다', async () => {
    const { app, registry, scheduler } = setup();
    const visible = (await call(app, 'GET', '/schedules/places')).body.schedules.find((s: { title: string }) => s.title === 'KIA 직관');
    expect(visible).toBeTruthy();
    const id = fixture.schedules.find((s) => s.title === 'KIA 직관')!.id;
    expect((await call(app, 'PUT', `/schedules/${id}/care`, { body: { care: '유니폼' } })).status).toBe(200);
    at('2026-11-12T04:00:00');
    await scheduler.tick();
    expect(registry.get('default').cares.get(id)).toBe('유니폼');
  });

  it('7일 동안 쓰지 않은 연결 전 버킷을 버린다', async () => {
    const { app, scheduler, logs } = setup();
    const device = 'k'.repeat(32);
    expect((await call(app, 'PUT', '/events', { device, body: { events: [event({ id: 'x', start: '2026-11-19T10:00:00+09:00', end: '2026-11-19T11:00:00+09:00' })] } })).status).toBe(200);
    at('2026-11-18T04:00:00'); // 쓴 지 6일 19시간: 아직 7일이 안 됐다
    await scheduler.tick();
    expect(logs).toEqual([]);
    at('2026-11-19T04:00:00'); // 7일(11-18 09:00)을 넘겼다
    await scheduler.tick();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('오래된 연결 전 버킷 1개');
  });
});

describe('prune-silent-seats: 30일 무소식 자리 정리', () => {
  const pairedMs = (s: { pairedAt: string }) => Date.parse(s.pairedAt);

  it('경계: 30일 전까지는 두고 30일이 되면 지운다(한 번도 일정을 받지 못한 자리는 연결 시각 기준)', async () => {
    const { app, seats } = setup();
    const car = await registerCar(app);
    const s = await connectPhone(app, car, '폰');
    expect(SILENT_SEAT_AFTER_MS).toBe(30 * DAY_MS);
    expect(pruneSilentSeats({ seats, now: new Date(pairedMs(s) + SILENT_SEAT_AFTER_MS - 1) })).toEqual([]);
    expect(seats.seat(s.seatId)).not.toBeNull();
    expect(pruneSilentSeats({ seats, now: new Date(pairedMs(s) + SILENT_SEAT_AFTER_MS) })).toEqual([s.seatId]);
    expect(seats.seat(s.seatId)).toBeNull();
    expect(pruneSilentSeats({ seats, now: new Date(pairedMs(s) + SILENT_SEAT_AFTER_MS) })).toEqual([]); // 다시 불러도 안전
  });

  it('일정을 받으면 그 시각부터 다시 30일을 센다', async () => {
    const { app, seats } = setup();
    const car = await registerCar(app);
    const s = await connectPhone(app, car, '폰');
    clockMs = pairedMs(s) + 10 * DAY_MS;
    expect((await call(app, 'PUT', '/events', { token: s.phoneToken, body: { events: [] } })).status).toBe(200);
    const received = clockMs;
    expect(pruneSilentSeats({ seats, now: new Date(pairedMs(s) + 30 * DAY_MS) })).toEqual([]); // 연결 기준으로는 30일이지만
    expect(pruneSilentSeats({ seats, now: new Date(received + 30 * DAY_MS - 1) })).toEqual([]);
    expect(pruneSilentSeats({ seats, now: new Date(received + 30 * DAY_MS) })).toEqual([s.seatId]);
  });

  it('폰 바꾸기로 이어받은 자리는 연결 시각이 새로 시작한다', async () => {
    const { app, seats } = setup();
    const car = await registerCar(app);
    const s = await connectPhone(app, car, '폰');
    clockMs = pairedMs(s) + 25 * DAY_MS;
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId: s.seatId } });
    const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name: '새 폰' } });
    expect(claimed.status).toBe(200);
    expect(pruneSilentSeats({ seats, now: new Date(pairedMs(s) + 30 * DAY_MS) })).toEqual([]);
    expect(pruneSilentSeats({ seats, now: new Date(clockMs + 30 * DAY_MS) })).toEqual([s.seatId]);
  });

  it('지워질 때 연결·일정·기억·알림이 모두 지워지고 다른 자리는 그대로이며, 차 토큰은 자리 없는 차 TTL 동안만 산다', async () => {
    const { app, seats, registry, notifications, scheduler, logs } = setup();
    const car1 = await registerCar(app);
    const a = await connectPhone(app, car1, '폰A');
    const car2 = await registerCar(app);
    const b = await connectPhone(app, car2, '폰B');
    await fill(app, a.phoneToken);
    await fill(app, b.phoneToken);
    expect((await call(app, 'PUT', '/places/favorites/home', { token: a.phoneToken, body: { placeId: 'mock-home-apt' } })).status).toBe(200);
    expect((await call(app, 'PUT', '/places/favorites/home', { token: b.phoneToken, body: { placeId: 'mock-home-apt' } })).status).toBe(200);
    expect((await call(app, 'POST', '/schedules/e2/family-request', { token: a.phoneToken, body: { memberId: 'family-mom' } })).status).toBe(200);
    const aData = registry.get(a.seatId);
    const bData = registry.get(b.seatId);

    // 폰A는 30일째 조용하고, 폰B는 29일째에 일정을 보냈다.
    clockMs = pairedMs(a) + 29 * DAY_MS;
    expect((await call(app, 'PUT', '/events', { token: b.phoneToken, body: { events: [] } })).status).toBe(200);
    at('2026-12-12T03:00:00');
    for (const id of [a.seatId, b.seatId]) expect(notifications.notifier.notify(id, { kind: 'family-status', title: 't', body: 'b' }).ok).toBe(true);
    expect(notifications.outbox.size(a.seatId)).toBe(1);
    at('2026-12-12T04:00:00'); // 연결 시각 11-11 09:00 + 30일 = 12-11 09:00 이후 첫 새벽
    expect(clockMs).toBeGreaterThan(pairedMs(a) + SILENT_SEAT_AFTER_MS);
    await scheduler.tick();
    const pruned = clockMs;
    expect(logs.some((m) => m.includes('자리 1개'))).toBe(true);

    // 폰A: 연결·토큰·자리 데이터·알림이 모두 사라진다.
    expect(seats.seat(a.seatId)).toBeNull();
    expect((await call(app, 'GET', '/pair', { token: a.phoneToken })).status).toBe(401);
    expect((await call(app, 'GET', '/events', { token: a.phoneToken })).status).toBe(401);
    expect(registry.get(a.seatId)).not.toBe(aData); // 자리 데이터 묶음 전체가 버려졌다
    const fresh = registry.get(a.seatId);
    expect(fresh.events.get()).toBeNull();
    expect(fresh.selection.get()).toBeNull();
    expect(fresh.favorites.get()).toMatchObject({ home: null, work: null, others: [] });
    expect(fresh.family.list()).toEqual([]);
    expect(fresh.overrides.size).toBe(0);
    expect(fresh.cares.size).toBe(0);
    expect(notifications.outbox.size(a.seatId)).toBe(0);
    expect((await call(app, 'GET', '/drivers', { token: car1.carToken })).body.seats).toEqual([]);

    // 폰B는 그대로.
    expect(seats.seat(b.seatId)).not.toBeNull();
    expect(registry.get(b.seatId)).toBe(bData);
    expect(bData.favorites.get().home).toBe('mock-home-apt');
    expect(notifications.outbox.size(b.seatId)).toBe(1);
    expect((await call(app, 'GET', '/pair', { token: b.phoneToken })).status).toBe(200);

    // 차1의 토큰: 마지막 자리가 지워진 시점부터 자리 없는 차의 TTL(코드 5분 + 1시간) 동안은 살아 있어 새 코드를 낼 수 있다. 차2는 자리가 있어 그대로.
    const ttl = CODE_TTL_MS + SEATLESS_CAR_TTL_MS;
    clockMs = pruned + ttl - 1;
    expect((await call(app, 'GET', '/drivers', { token: car1.carToken })).status).toBe(200);
    expect((await call(app, 'POST', '/pair/code', { token: car1.carToken, body: {} })).status).toBe(200); // 활동이라 TTL이 새로 시작한다
    clockMs = pruned + ttl - 1 + ttl - 1;
    expect((await call(app, 'GET', '/drivers', { token: car1.carToken })).status).toBe(200);
    clockMs += 1 + ttl; // 활동 없이 TTL이 지나면 차 토큰도 만료된다(토큰을 잃은 차는 새 carId로 다시 등록)
    expect((await call(app, 'GET', '/drivers', { token: car1.carToken })).status).toBe(401);
    expect((await call(app, 'GET', '/drivers', { token: car2.carToken })).status).toBe(200);
  });
});
