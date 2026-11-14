import { describe, expect, it } from 'vitest';
import {
  CAR_CREATE_WINDOW_MS,
  CLAIM_LOCK_MS,
  CODE_TTL_MS,
  MAX_CAR_CREATES_PER_SOURCE,
  MAX_FAILURES,
  MAX_GLOBAL_FAILURES,
  MAX_LOCK_MS,
  MAX_TRACKED_SOURCES,
  SEATLESS_CAR_TTL_MS,
  createSeatStore,
} from '../src/seats.js';
import { BUCKET_TTL_MS } from '../src/seatData.js';
import { catalog, newApp } from './helpers.js';

// 리뷰(J1 반려)에서 재현된 시나리오 S1~S7과 설계 결정 A~I를 서버 테스트로 옮긴 것이다.

const NOW = '2026-11-11T10:00:00+09:00';
let clockMs = Date.parse(NOW);
const makeApp = (over: Parameters<typeof newApp>[0] = {}) => {
  clockMs = Date.parse(NOW);
  const now = () => new Date(clockMs);
  return newApp({
    now,
    seats: createSeatStore(now),
    clientAddress: (c) => c.req.header('x-test-ip') ?? 'test',
    isLoopback: (c) => c.req.header('x-test-loopback') === '1',
    ...over,
  });
};
type App = ReturnType<typeof makeApp>;

type Opts = { token?: string; body?: unknown; ip?: string; device?: string; loopback?: boolean };
const call = async (app: App, method: string, path: string, { token, body, ip, device, loopback }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (ip) headers['x-test-ip'] = ip;
  if (device) headers['x-chagok-device'] = device;
  if (loopback) headers['x-test-loopback'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text === '' ? null : (JSON.parse(text) as any) };
};

const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);
const place = catalog.places[0];
const ev = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  calendarId: 'cal-1',
  title: '팀 회의',
  start: '2026-11-11T14:00:00+09:00',
  end: '2026-11-11T15:00:00+09:00',
  allDay: false,
  locationText: null,
  notes: null,
  attendees: [],
  ...over,
});
const ids = (res: { body: any }) => ((res.body.schedules ?? res.body.events) as { id: string }[]).map((s) => s.id);

type Car = { carId: string; carToken: string };
const registerCar = async (app: App, carId?: string, ip?: string): Promise<Car> => {
  const res = await call(app, 'POST', '/pair/code', { body: carId ? { carId } : {}, ip });
  expect(res.status).toBe(200);
  return { carId: res.body.carId, carToken: res.body.carToken };
};
type Paired = { seatId: string; name: string; phoneToken: string; mode: string };
const connect = async (app: App, car: Car, name: string, o: { device?: string; phoneToken?: string; ip?: string } = {}): Promise<Paired> => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
  expect(issued.status).toBe(200);
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device: o.device, token: o.phoneToken, ip: o.ip });
  expect(claimed.status).toBe(200);
  return claimed.body;
};
const replaceSeat = async (app: App, car: Car, seatId: string, name: string, o: { device?: string } = {}): Promise<Paired> => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId } });
  expect(issued.status).toBe(200);
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device: o.device });
  expect(claimed.status).toBe(200);
  return claimed.body;
};
const put = (app: App, path: string, o: Opts) => call(app, 'PUT', path, o);
const putEvents = (app: App, o: Omit<Opts, 'body'>, events: unknown[]) => call(app, 'PUT', '/events', { ...o, body: { events } });

describe('A. 연결 전 폰 데이터는 폰마다 나뉜다 (S1)', () => {
  it('토큰 없는 두 폰이 서로의 일정·보정·채비·자주 가는 곳을 읽지도 쓰지도 못한다', async () => {
    const app = makeApp();
    // 이미 연결된 폰 A의 자리가 있고, 연결 전 폰 B·C가 첫 설정을 한다.
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await putEvents(app, { token: a.phoneToken }, [ev({ id: 'a-secret', title: 'A 병원' })]);

    await putEvents(app, { device: DEV_B }, [ev({ id: 'b-1', title: 'B 일정' })]);
    await putEvents(app, { device: DEV_C }, [ev({ id: 'c-1', title: 'C 일정' })]);
    expect(ids(await call(app, 'GET', '/schedules/places', { device: DEV_B }))).toEqual(['b-1']);
    expect(ids(await call(app, 'GET', '/schedules/places', { device: DEV_C }))).toEqual(['c-1']);
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11', { device: DEV_B }))).toEqual(['b-1']);
    // B는 자기 일정에는 쓸 수 있고, A·C의 일정에는 쓸 수 없다(404).
    expect((await put(app, '/schedules/b-1/place', { device: DEV_B, body: { noTravel: true } })).status).toBe(200);
    expect((await put(app, '/schedules/a-secret/care', { device: DEV_B, body: { care: 'x' } })).status).toBe(404);
    expect((await put(app, '/schedules/c-1/care', { device: DEV_B, body: { care: 'x' } })).status).toBe(404);
    // 채비·자주 가는 곳·캘린더 선택도 기기별이다.
    await put(app, '/schedules/c-1/care', { device: DEV_C, body: { care: '우산' } });
    await put(app, '/places/favorites/home', { device: DEV_B, body: { placeId: place.id } });
    await put(app, '/calendars/selection', { device: DEV_B, body: { selectedIds: ['cal-1'], revision: 1, source: 'device' } });
    expect((await call(app, 'GET', '/places/favorites', { device: DEV_B })).body.home).toMatchObject({ id: place.id });
    expect((await call(app, 'GET', '/places/favorites', { device: DEV_C })).body.home).toBeNull();
    expect((await call(app, 'GET', '/calendars/selection', { device: DEV_C })).body.selectedIds).toBeNull();
    expect((await call(app, 'GET', '/schedules/places', { device: DEV_C })).body.schedules[0]).toMatchObject({ care: '우산' });
    expect((await call(app, 'GET', '/schedules/places', { device: DEV_B })).body.schedules[0].care).toBeNull();
    // 연결된 자리의 데이터는 건드려지지 않는다.
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11', { token: a.phoneToken }))).toEqual(['a-secret']);
  });

  it('읽기는 버킷을 만들지 않고(없으면 빈 응답), 쓰기만 만든다', async () => {
    const app = makeApp({ capacity: { maxBuckets: 1 } });
    expect((await call(app, 'GET', '/events', { device: DEV_A })).body).toMatchObject({ receivedAt: null, events: [] });
    expect((await call(app, 'GET', '/schedules/today', { device: DEV_B })).body.schedules).toEqual([]);
    expect((await putEvents(app, { device: DEV_A }, [ev()])).status).toBe(200); // 읽기가 자리를 차지하지 않았다
    // 버킷이 가득 차면 새 기기의 쓰기는 429 capacity이고 있는 버킷은 그대로다.
    const full = await putEvents(app, { device: DEV_B }, [ev()]);
    expect(full).toMatchObject({ status: 429, body: { reason: 'capacity' } });
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11', { device: DEV_A }))).toEqual(['e1']);
    expect((await call(app, 'GET', '/events', { device: DEV_B })).status).toBe(200);
  });

  it('7일 동안 쓰지도 읽지도 않은 버킷은 버린다(쓰거나 읽으면 TTL이 새로 시작)', async () => {
    const app = makeApp();
    await putEvents(app, { device: DEV_A }, [ev({ id: 'old', start: '2026-11-18T14:00:00+09:00', end: '2026-11-18T15:00:00+09:00' })]);
    clockMs += BUCKET_TTL_MS - 1;
    expect((await call(app, 'GET', '/events', { device: DEV_A })).body.receivedAt).not.toBeNull(); // 7일 직전: 아직 있고, 읽으면 TTL이 새로 시작한다
    clockMs += BUCKET_TTL_MS - 1;
    expect((await call(app, 'GET', '/events', { device: DEV_A })).body.receivedAt).not.toBeNull();
    clockMs += BUCKET_TTL_MS; // 마지막으로 읽은 뒤 7일
    expect((await call(app, 'GET', '/events', { device: DEV_A })).body.receivedAt).toBeNull();
  });

  it('기기 id는 길이·문자를 검증하고 이상하면 400이다(읽기·쓰기·claim 모두)', async () => {
    const app = makeApp();
    for (const bad of ['short', 'x'.repeat(65), `${'a'.repeat(30)}!!`, `${'a'.repeat(30)} z`]) {
      expect((await call(app, 'GET', '/events', { device: bad })).status).toBe(400);
      expect((await putEvents(app, { device: bad }, [])).status).toBe(400);
      expect((await call(app, 'POST', '/pair/claim', { device: bad, body: { code: '123456' } })).status).toBe(400);
      expect((await call(app, 'POST', '/pairing/claim', { device: bad, body: { code: '123456' } })).status).toBe(400);
    }
    expect((await call(app, 'GET', '/events', { device: 'A_b-c'.padEnd(22, 'z') })).status).toBe(200);
  });

  it('토큰이 있으면 기기 id는 자리를 정하지 않고, 모르는 토큰은 버킷으로 흘리지 않고 401이다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await putEvents(app, { device: DEV_A }, [ev({ id: 'bucket-ev' })]);
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11', { token: a.phoneToken, device: DEV_A }))).toEqual([]);
    expect((await putEvents(app, { token: 'f'.repeat(64), device: DEV_A }, [ev()])).status).toBe(401);
    expect((await call(app, 'GET', '/events', { token: 'f'.repeat(64), device: DEV_A })).status).toBe(401);
  });

  it('claim은 그 요청의 기기 id 버킷만 새 자리로 옮기고, 다른 폰의 버킷·기본 자리는 가져가지 못한다 (S3)', async () => {
    const app = makeApp();
    // 피해자 V(기기 A)는 첫 설정 중이다. 기본 자리에도 데모 데이터가 있다.
    await putEvents(app, { device: DEV_A }, [ev({ id: 'victim-1', title: '피해자 일정' })]);
    await put(app, '/places/favorites/home', { device: DEV_A, body: { placeId: place.id } });
    await putEvents(app, {}, [ev({ id: 'default-ev' })]);
    // 공격자 Z(기기 B)가 새 차를 만들어 연결한다.
    const atkCar = await registerCar(app);
    const atk = await connect(app, atkCar, 'Z', { device: DEV_B });
    const seatEvents = await call(app, 'GET', '/events?date=2026-11-11', { token: atk.phoneToken });
    expect(seatEvents.body).toMatchObject({ events: [], receivedAt: null });
    expect((await call(app, 'GET', '/places/favorites', { token: atk.phoneToken })).body.home).toBeNull();
    // 기기 id 없이 연결한 폰도 아무것도 이어받지 않는다(기본 자리 이어받기 없음, B).
    const anon = await connect(app, atkCar, 'anon');
    expect((await call(app, 'GET', '/events', { token: anon.phoneToken })).body.events).toEqual([]);
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11'))).not.toContain('default-ev'); // 옛 읽기는 (자리 있는 차 하나) 그 자리
    // 피해자는 자기 버킷을 그대로 가지고 있다가 연결하면 이어받는다.
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11', { device: DEV_A }))).toEqual(['victim-1']);
    const victimCar = await registerCar(app);
    const victim = await connect(app, victimCar, 'V', { device: DEV_A });
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11', { token: victim.phoneToken }))).toEqual(['victim-1']);
    expect((await call(app, 'GET', '/places/favorites', { token: victim.phoneToken })).body.home).toMatchObject({ id: place.id });
    // 옮긴 버킷은 사라진다: 토큰을 잃고 기기 id만 남은 폰은 빈 버킷을 본다.
    expect(ids(await call(app, 'GET', '/events?date=2026-11-11', { device: DEV_A }))).toEqual([]);
  });

  it('새 자리가 이어받는 것은 일정·선택·보정·채비·자주 가는 곳이다', async () => {
    const app = makeApp();
    await putEvents(app, { device: DEV_A }, [ev({ id: 'pre' })]);
    await put(app, '/schedules/pre/care', { device: DEV_A, body: { care: '충전기' } });
    await put(app, '/places/favorites/home', { device: DEV_A, body: { placeId: place.id } });
    const car = await registerCar(app);
    const first = await connect(app, car, 'Pixel', { device: DEV_A });
    const today = await call(app, 'GET', `/schedules/today?driver=${first.seatId}`, { token: car.carToken });
    expect(today.body.schedules[0]).toMatchObject({ id: 'pre', care: '충전기' });
    expect((await call(app, 'GET', '/places/favorites', { token: first.phoneToken })).body.home).toMatchObject({ id: place.id });
    // 두 번째 폰(기기 B)은 첫 폰의 것을 이어받지 않는다.
    const second = await connect(app, car, 'Galaxy', { device: DEV_B });
    expect((await call(app, 'GET', '/events', { token: second.phoneToken })).body.receivedAt).toBeNull();
  });

  it('폰 바꾸기: 자리의 기억은 유지하고 새 폰 버킷의 일정·선택·보정만 반영한다(버킷이 없으면 받았고 0건)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const old = await connect(app, car, '옛 폰');
    await putEvents(app, { token: old.phoneToken }, [ev({ id: 'old-ev' })]);
    await put(app, '/places/favorites/home', { token: old.phoneToken, body: { placeId: place.id } });
    // 새 폰(기기 B)이 연결 전에 모은 것
    await putEvents(app, { device: DEV_B }, [ev({ id: 'new-ev' })]);
    await put(app, '/schedules/new-ev/care', { device: DEV_B, body: { care: '새 채비' } });
    await put(app, '/calendars/selection', { device: DEV_B, body: { selectedIds: ['cal-1'], revision: 1, source: 'device' } });
    await put(app, '/places/favorites/home', { device: DEV_B, body: { placeId: catalog.places[1]!.id } });

    const replaced = await replaceSeat(app, car, old.seatId, '새 폰', { device: DEV_B });
    const today = await call(app, 'GET', `/schedules/today?driver=${old.seatId}`, { token: car.carToken });
    expect(today.body.schedules.map((s: { id: string }) => s.id)).toEqual(['new-ev']);
    expect(today.body.schedules[0]).toMatchObject({ care: '새 채비' });
    expect((await call(app, 'GET', '/calendars/selection', { token: replaced.phoneToken })).body.selectedIds).toEqual(['cal-1']);
    // 자주 가는 곳은 자리의 기억을 유지한다(새 폰 버킷의 것으로 덮지 않는다).
    expect((await call(app, 'GET', '/places/favorites', { token: replaced.phoneToken })).body.home).toMatchObject({ id: place.id });

    // 버킷이 없는 폰으로 또 바꾸면 '받았고 0건'이다(S5: 픽스처로 떨어지지 않는다).
    const again = await replaceSeat(app, car, old.seatId, '세 번째 폰');
    const view = await call(app, 'GET', `/events?driver=${old.seatId}&date=2026-11-11`, { token: car.carToken });
    expect(view.body).toMatchObject({ events: [], receivedAt: new Date(clockMs).toISOString() });
    expect(ids(await call(app, 'GET', `/schedules/today?driver=${old.seatId}`, { token: car.carToken }))).toEqual([]);
    expect(ids(await call(app, 'GET', '/schedules/today', { token: again.phoneToken }))).toEqual([]);
  });
});

describe('B·E. 픽스처는 기본 자리에서만 (S5)', () => {
  it('식별 없는 요청은 기본 자리(픽스처), 실제 자리·연결 전 버킷은 일정을 받은 적 없어도 0건이다', async () => {
    const app = makeApp();
    expect(ids(await call(app, 'GET', '/schedules/today'))).toContain('gwangju-lunch');
    expect(ids(await call(app, 'GET', '/schedules/today', { device: DEV_A }))).toEqual([]);
    expect(ids(await call(app, 'GET', '/schedules/places', { device: DEV_A }))).toEqual([]);
    const car = await registerCar(app);
    const seat = await connect(app, car, 'A');
    expect(ids(await call(app, 'GET', '/schedules/today', { token: seat.phoneToken }))).toEqual([]);
    expect(ids(await call(app, 'GET', '/schedules/places', { token: seat.phoneToken }))).toEqual([]);
  });

  it('DELETE /events로 비운 실제 자리도 0건이고, 기본 자리만 픽스처로 복귀한다', async () => {
    const app = makeApp();
    await putEvents(app, { device: DEV_A }, [ev()]);
    await putEvents(app, {}, [ev({ id: 'd' })]);
    expect((await call(app, 'DELETE', '/events', { device: DEV_A, loopback: true })).status).toBe(200);
    expect(ids(await call(app, 'GET', '/schedules/today', { device: DEV_A }))).toEqual([]);
    expect((await call(app, 'DELETE', '/events', { loopback: true })).status).toBe(200);
    expect(ids(await call(app, 'GET', '/schedules/today'))).toContain('gwangju-lunch');
    expect((await call(app, 'DELETE', '/events', { device: DEV_A })).status).toBe(403); // 같은 기기만
  });

  it('fixtureSeats(데모·폰 E2E 서버)에서는 받은 적 없는 실제 자리·버킷도 픽스처를 쓴다', async () => {
    const app = makeApp({ fixtureSeats: true });
    expect(ids(await call(app, 'GET', '/schedules/places', { device: DEV_A }))).toContain('gwangju-lunch');
    await put(app, '/schedules/gwangju-lunch/place', { device: DEV_A, body: { noTravel: true } });
    const car = await registerCar(app);
    const seat = await connect(app, car, 'A', { device: DEV_A });
    expect(ids(await call(app, 'GET', '/schedules/today', { token: seat.phoneToken }))).not.toContain('gwangju-lunch'); // 보정을 이어받았다
    expect(ids(await call(app, 'GET', '/schedules/today', { token: seat.phoneToken }))).toContain('gwangju-kia');
    // 차량 Maestro(pairing flow): 기기 id 없이 옛 경로로 연결한 자리도 이어지는 옛 차 앱 읽기에서 픽스처를 본다.
    const legacyCar = makeApp({ fixtureSeats: true, isLoopback: () => true });
    const code = (await call(legacyCar, 'POST', '/pairing/codes', { body: { carId: 'e2e-car' } })).body.code;
    expect((await call(legacyCar, 'POST', '/pairing/claim', { body: { code } })).status).toBe(200);
    expect(ids(await call(legacyCar, 'GET', '/schedules/today'))).toContain('gwangju-kia');
    // 폰 바꾸기로 '받았고 0건'이 된 자리는 이 서버에서도 픽스처로 돌아가지 않는다.
    await replaceSeat(app, car, seat.seatId, 'B');
    expect(ids(await call(app, 'GET', `/schedules/today?driver=${seat.seatId}`, { token: car.carToken }))).toEqual([]);
  });
});

describe('C. 옛 차 앱 호환 읽기의 범위 (S2)', () => {
  const legacyToday = async (app: App, o: Opts = {}) => ids(await call(app, 'GET', '/schedules/today', o));

  it('자리가 있는 차가 정확히 하나일 때만 그 차의 지난번 고른 자리(없으면 가장 최근 자리)를 본다', async () => {
    const app = makeApp();
    expect(await legacyToday(app)).toContain('gwangju-lunch'); // 자리가 있는 차가 없다: 기본 자리
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    clockMs += 1000;
    const b = await connect(app, car, 'B');
    await putEvents(app, { token: a.phoneToken }, [ev({ id: 'a-1' })]);
    await putEvents(app, { token: b.phoneToken }, [ev({ id: 'b-1' })]);
    expect(await legacyToday(app)).toEqual(['b-1']); // 가장 최근 자리
    await call(app, 'PUT', '/drivers/selected', { token: car.carToken, body: { seatId: a.seatId } });
    expect(await legacyToday(app)).toEqual(['a-1']); // 지난번 고른 자리
  });

  it('다른 차에 폰이 연결돼 자리 있는 차가 둘이 되면 차 X의 옛 읽기는 Y 폰 일정이 아니라 기본 자리다', async () => {
    const app = makeApp();
    const x = await registerCar(app, 'car-X');
    const ax = await connect(app, x, 'X폰');
    await putEvents(app, { token: ax.phoneToken }, [ev({ id: 'x-1' })]);
    expect(await legacyToday(app)).toEqual(['x-1']);
    clockMs += 1000;
    const y = await registerCar(app, 'car-Y');
    const ay = await connect(app, y, 'Y폰');
    await putEvents(app, { token: ay.phoneToken }, [ev({ id: 'y-secret' })]);
    const after = await legacyToday(app);
    expect(after).not.toContain('y-secret');
    expect(after).not.toContain('x-1');
    expect(after).toContain('gwangju-lunch'); // 기본 자리(픽스처)
    // 차 토큰이 있으면 그 차 안에서만 본다.
    expect(await legacyToday(app, { token: x.carToken })).toEqual(['x-1']);
    expect(await legacyToday(app, { token: y.carToken })).toEqual(['y-secret']);
    // driver를 보내는 차는 자기 자리만 본다.
    expect(ids(await call(app, 'GET', `/schedules/today?driver=${ay.seatId}`, { token: y.carToken }))).toEqual(['y-secret']);
    expect((await call(app, 'GET', `/schedules/today?driver=${ay.seatId}`, { token: x.carToken })).status).toBe(403);
  });

  it('자리가 없는 차의 토큰은 기본 자리를 보고, 옵션을 끄면 어느 경우도 기본 자리다', async () => {
    const app = makeApp();
    const lonely = await registerCar(app);
    expect(await legacyToday(app, { token: lonely.carToken })).toContain('gwangju-lunch');
    const off = makeApp({ legacyDriverFallback: false });
    const car = await registerCar(off);
    const a = await connect(off, car, 'A');
    await putEvents(off, { token: a.phoneToken }, [ev({ id: 'a-1' })]);
    expect(await legacyToday(off)).toContain('gwangju-lunch');
    expect(await legacyToday(off, { token: car.carToken })).toContain('gwangju-lunch');
  });

  it('폰 바꾸기·두 번째 폰 연결 뒤에도 옛 차 앱 읽기는 픽스처가 아니다(받았고 0건)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await putEvents(app, { token: a.phoneToken }, [ev({ id: 'real-1' })]);
    expect(await legacyToday(app)).toEqual(['real-1']);
    clockMs += 1000;
    await connect(app, car, 'B');
    expect(await legacyToday(app)).toEqual([]); // 최근 자리 B: 아직 일정이 없다
    expect(await legacyToday(app)).not.toContain('gwangju-lunch');
    await replaceSeat(app, car, a.seatId, 'A2');
    expect(ids(await call(app, 'GET', `/schedules/today?driver=${a.seatId}`, { token: car.carToken }))).toEqual([]);
  });
});

describe('D. 옛 /pairing/* 경로의 권한 (S4)', () => {
  it('자리가 있는 차의 코드 발급·초기화는 차 토큰이 있거나 같은 기기일 때만 받는다', async () => {
    const app = makeApp();
    await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-V' } });
    const v = (await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-V' } })).body;
    const claimed = await call(app, 'POST', '/pairing/claim', { body: { code: v.code, name: 'V' } });
    expect(claimed.status).toBe(200);
    await put(app, '/places/favorites/home', { token: claimed.body.phoneToken, body: { placeId: place.id } });

    // 다른 기기(루프백 아님)에서 carId만 아는 침입자
    expect((await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-V' } })).status).toBe(401);
    expect((await call(app, 'DELETE', '/pairing/cars/car-V')).status).toBe(401);
    expect((await call(app, 'DELETE', '/pairing/cars/car-V', { token: 'f'.repeat(64) })).status).toBe(401);
    expect((await call(app, 'GET', '/pair', { token: claimed.body.phoneToken })).status).toBe(200); // 피해자 연결은 그대로
    // 읽기 전용 상태 조회는 예전처럼 carId만으로 된다(차 앱이 쓴다).
    expect((await call(app, 'GET', '/pairing/cars/car-V')).body).toMatchObject({ paired: true });
    // 같은 기기(에뮬레이터의 차 앱·Maestro)는 그대로 된다.
    expect((await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-V' }, loopback: true })).status).toBe(200);
    // 다른 차의 토큰은 소용없고, 그 차의 토큰은 된다.
    const other = await registerCar(app, 'car-other');
    expect((await call(app, 'DELETE', '/pairing/cars/car-V', { token: other.carToken })).status).toBe(401);
    expect((await call(app, 'DELETE', '/pairing/cars/car-V', { loopback: true })).status).toBe(200);
    expect((await call(app, 'GET', '/pair', { token: claimed.body.phoneToken })).status).toBe(401);
  });

  it('차 토큰이 있으면 같은 기기가 아니어도 그 차의 코드 발급·초기화가 된다', async () => {
    const app = makeApp();
    const car = await registerCar(app, 'car-T');
    await connect(app, car, 'A');
    expect((await call(app, 'POST', '/pairing/codes', { token: car.carToken, body: { carId: 'car-T' } })).status).toBe(200);
    expect((await call(app, 'DELETE', '/pairing/cars/car-T', { token: car.carToken })).status).toBe(200);
  });

  it('자리가 없는 차는 예전처럼 carId만으로 코드를 받고(토큰은 다시 주지 않음) 지울 수 있다', async () => {
    const app = makeApp();
    const first = await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-L' } });
    expect(first.body.carToken).toMatch(/^[0-9a-f]{64}$/);
    const second = await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-L' } });
    expect(second).toMatchObject({ status: 200, body: { carToken: null } });
    expect((await call(app, 'DELETE', '/pairing/cars/car-L')).status).toBe(200);
  });

  it('폰이 받는 응답(claim·GET /pair)에는 차 id가 없고, 자리 id·이름·연결 시각으로 연결 상태를 볼 수 있다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const seat = await connect(app, car, 'Pixel');
    const status = await call(app, 'GET', '/pair', { token: seat.phoneToken });
    expect(status.status).toBe(200);
    expect(Object.keys(status.body).sort()).toEqual(['lastEventsAt', 'lastPresenceAt', 'name', 'pairedAt', 'paired', 'presence', 'seatId'].sort());
    expect(JSON.stringify(status.body)).not.toContain(car.carId);
    expect((await call(app, 'GET', '/pair')).status).toBe(401);
  });
});

describe('F. 남용 방지 (S7)', () => {
  const wrongCode = (live: string) => (live === '000000' ? '111111' : '000000');

  it('실패 기록 표가 차면 새 주소의 시도를 잠금으로 본다(fail-closed): 표를 채워도 새 주소로 찍어 볼 수 없다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    const wrong = wrongCode(issued.body.code);
    for (let i = 0; i < MAX_TRACKED_SOURCES; i++) await call(app, 'POST', '/pair/claim', { body: { code: wrong }, ip: `10.0.0.${i}` });
    // 새 주소는 맞는 코드도 막히고 실패로 세지지도 않는다.
    const blocked = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: 'attacker' });
    expect(blocked).toMatchObject({ status: 429, body: { reason: 'locked' } });
    expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(MAX_LOCK_MS / 1000);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) expect((await call(app, 'POST', '/pair/claim', { body: { code: '000001' }, ip: 'attacker' })).status).toBe(429);
    // 기록이 지나가면(1분) 다시 받는다.
    clockMs += 60_000;
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: 'attacker' })).status).toBe(200);
  });

  it('서버 전체 분당 실패가 상한을 넘으면 주소를 바꿔 가며 찍어도 모든 claim이 잠긴다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    const wrong = wrongCode(issued.body.code);
    const perSource = MAX_FAILURES - 1;
    for (let i = 0; i < MAX_GLOBAL_FAILURES / perSource; i++) {
      for (let k = 0; k < perSource; k++) await call(app, 'POST', '/pair/claim', { body: { code: wrong }, ip: `20.0.0.${i}` });
    }
    const blocked = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: 'fresh-address' });
    expect(blocked).toMatchObject({ status: 429, body: { reason: 'locked' } });
    expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(MAX_LOCK_MS / 1000);
    clockMs += 60_001;
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: 'fresh-address' })).status).toBe(200);
  });

  it('잠금 시간은 상한(MAX_LOCK_MS)을 넘지 않는다', () => {
    expect(CLAIM_LOCK_MS).toBeLessThanOrEqual(MAX_LOCK_MS);
  });

  it('한 요청 주소가 짧은 시간에 만들 수 있는 차 수는 제한되고, 창이 지나면 다시 만들 수 있다', async () => {
    const app = makeApp();
    for (let i = 0; i < MAX_CAR_CREATES_PER_SOURCE; i++) await registerCar(app, undefined, '5.5.5.5');
    const limited = await call(app, 'POST', '/pair/code', { body: {}, ip: '5.5.5.5' });
    expect(limited).toMatchObject({ status: 429, body: { reason: 'rate-limited' } });
    expect((await call(app, 'POST', '/pairing/codes', { body: { carId: 'legacy-new' }, ip: '5.5.5.5' })).status).toBe(429);
    expect((await call(app, 'POST', '/pair/code', { body: {}, ip: '6.6.6.6' })).status).toBe(200); // 다른 주소는 괜찮다
    clockMs += CAR_CREATE_WINDOW_MS;
    expect((await call(app, 'POST', '/pair/code', { body: {}, ip: '5.5.5.5' })).status).toBe(200);
  });

  it('자리가 없는 차는 마지막 코드가 만료되고 일정 시간이 지나면 지워지고, 자리가 있는 차는 남는다', async () => {
    const app = makeApp();
    const idle = await registerCar(app, 'idle-car');
    const live = await registerCar(app, 'live-car');
    await connect(app, live, 'A');
    clockMs += CODE_TTL_MS + SEATLESS_CAR_TTL_MS - 1;
    expect((await call(app, 'GET', '/drivers', { token: idle.carToken })).status).toBe(200);
    clockMs += 1;
    expect((await call(app, 'GET', '/drivers', { token: idle.carToken })).status).toBe(401);
    expect((await call(app, 'GET', '/drivers', { token: live.carToken })).status).toBe(200);
    // 지워진 carId는 다시 등록할 수 있다(토큰은 새로 받는다).
    const again = await call(app, 'POST', '/pair/code', { body: { carId: 'idle-car' } });
    expect(again.status).toBe(200);
    expect(again.body.carToken).not.toBe(idle.carToken);
  });

  it('코드를 계속 받는 차는 TTL이 새로 시작해 지워지지 않는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    for (let i = 0; i < 3; i++) {
      clockMs += CODE_TTL_MS + SEATLESS_CAR_TTL_MS - 1000;
      expect((await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} })).status).toBe(200);
    }
  });

  it('서버 전체 일정 저장 용량 상한을 넘기는 PUT /events는 429 capacity이고, 자기 일정을 바꾸는 것은 자기 크기를 빼고 센다', async () => {
    const big = (n: number) => Array.from({ length: n }, (_, i) => ev({ id: `e${i}`, title: 'x'.repeat(150) }));
    const app = makeApp({ capacity: { maxTotalEventBytes: 20_000 } });
    expect((await putEvents(app, { device: DEV_A }, big(40))).status).toBe(200); // 약 11KB
    const over = await putEvents(app, { device: DEV_B }, big(40));
    expect(over).toMatchObject({ status: 429, body: { reason: 'capacity' } });
    expect((await putEvents(app, { device: DEV_A }, big(50))).status).toBe(200); // 같은 기기가 바꾸는 것은 자기 크기를 뺀다
    expect((await putEvents(app, { device: DEV_B }, big(5))).status).toBe(200); // 작은 것은 들어간다
    expect((await call(app, 'DELETE', '/events', { device: DEV_A, loopback: true })).status).toBe(200);
    expect((await putEvents(app, { device: DEV_B }, big(40))).status).toBe(200); // 비우면 자리가 난다
  });
});

describe('G. 차 토큰은 다시 내주지 않는다 (S6)', () => {
  it('carId를 아는 다른 사람이 자리 없는 차의 토큰을 가로챌 수 없고, 진짜 차의 토큰·코드는 그대로다', async () => {
    const app = makeApp();
    const real = await registerCar(app, 'car-R');
    const issued = await call(app, 'POST', '/pair/code', { token: real.carToken, body: {} });
    const evil = await call(app, 'POST', '/pair/code', { body: { carId: 'car-R' } });
    expect(evil.status).toBe(401);
    expect(evil.body).not.toHaveProperty('carToken');
    expect((await call(app, 'GET', '/drivers', { token: real.carToken })).status).toBe(200);
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code } })).status).toBe(200); // 진짜 차의 코드가 살아 있다
  });

  it('토큰을 잃은 차는 새 carId로 다시 등록한다', async () => {
    const app = makeApp();
    await registerCar(app, 'car-lost');
    const fresh = await call(app, 'POST', '/pair/code', { body: {} });
    expect(fresh.status).toBe(200);
    expect(fresh.body.carId).not.toBe('car-lost');
    expect(fresh.body.carToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('I. 한 폰은 한 자리만 가진다', () => {
  it('다른 차의 토큰을 가진 폰이 새 차에 연결하면 예전 자리를 끊고(삭제) 새 자리를 만든다', async () => {
    const app = makeApp();
    const carX = await registerCar(app);
    const carY = await registerCar(app);
    const old = await connect(app, carX, 'Pixel');
    await put(app, '/places/favorites/home', { token: old.phoneToken, body: { placeId: place.id } });
    const moved = await connect(app, carY, 'Pixel', { phoneToken: old.phoneToken });
    expect(moved.seatId).not.toBe(old.seatId);
    expect((await call(app, 'GET', '/pair', { token: old.phoneToken })).status).toBe(401);
    expect((await call(app, 'GET', '/drivers', { token: carX.carToken })).body.seats).toEqual([]);
    expect((await call(app, 'GET', '/drivers', { token: carY.carToken })).body.seats.map((s: { seatId: string }) => s.seatId)).toEqual([moved.seatId]);
    expect((await call(app, 'GET', '/places/favorites', { token: moved.phoneToken })).body.home).toBeNull(); // 옛 자리 기억은 지워졌다
    expect((await call(app, 'GET', '/pair', { token: moved.phoneToken })).status).toBe(200);
  });

  it('새 차가 가득 차 있으면(seat-limit) 예전 자리는 끊기지 않는다', async () => {
    const app = makeApp();
    const carX = await registerCar(app);
    const carY = await registerCar(app);
    const old = await connect(app, carX, 'Pixel');
    for (let i = 0; i < 8; i++) await connect(app, carY, `폰${i}`);
    const issued = await call(app, 'POST', '/pair/code', { token: carY.carToken, body: {} });
    expect(issued.status).toBe(409);
    expect((await call(app, 'GET', '/pair', { token: old.phoneToken })).status).toBe(200);
  });

  it('폰 바꾸기로 다른 자리를 이어받으면 그 폰의 예전 자리는 끊긴다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId: a.seatId } });
    const claimed = await call(app, 'POST', '/pair/claim', { token: b.phoneToken, body: { code: issued.body.code, name: 'B2' } });
    expect(claimed).toMatchObject({ status: 200, body: { seatId: a.seatId, mode: 'replace' } });
    expect((await call(app, 'GET', '/pair', { token: b.phoneToken })).status).toBe(401);
    expect((await call(app, 'GET', '/drivers', { token: car.carToken })).body.seats.map((s: { seatId: string }) => s.seatId)).toEqual([a.seatId]);
  });
});
