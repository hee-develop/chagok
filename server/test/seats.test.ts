import { describe, expect, it } from 'vitest';
import { CLAIM_LOCK_MS, CODE_TTL_MS, MAX_FAILURES, MAX_SEATS_PER_CAR, createSeatStore } from '../src/seats.js';
import { catalog, newApp } from './helpers.js';

/** 시계를 고정한다: 서울 2026-11-11 10:00. 오늘·내일은 11-11, 11-12. */
const NOW = '2026-11-11T10:00:00+09:00';
let clockMs = Date.parse(NOW);
const makeApp = (over: Parameters<typeof newApp>[0] = {}) => {
  clockMs = Date.parse(NOW);
  const now = () => new Date(clockMs);
  return newApp({ now, seats: createSeatStore(now), clientAddress: (c) => c.req.header('x-test-ip') ?? 'test', ...over });
};
type App = ReturnType<typeof makeApp>;

type Opts = { token?: string; body?: unknown; ip?: string; raw?: string };
const call = async (app: App, method: string, path: string, { token, body, ip, raw }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (ip) headers['x-test-ip'] = ip;
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text === '' ? null : (JSON.parse(text) as any) };
};

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

type Car = { carId: string; carToken: string };
/** 차가 처음 코드를 받는다(차가 만들어지고 토큰을 받는다). */
const registerCar = async (app: App, carId?: string): Promise<Car> => {
  const res = await call(app, 'POST', '/pair/code', { body: carId ? { carId } : {} });
  expect(res.status).toBe(200);
  return { carId: res.body.carId, carToken: res.body.carToken };
};
/** 차가 새 코드를 받아 폰이 연결한다. */
const connect = async (app: App, car: Car, name: string, opts: { ip?: string; phoneToken?: string } = {}) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
  expect(issued.status).toBe(200);
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, ip: opts.ip, token: opts.phoneToken });
  expect(claimed.status).toBe(200);
  expect(claimed.body).not.toHaveProperty('carId'); // 폰에는 차 id를 주지 않는다
  return claimed.body as { seatId: string; name: string; phoneToken: string; pairedAt: string; mode: 'new' | 'replace' };
};
const replaceSeat = async (app: App, car: Car, seatId: string, name: string, binding: Record<string, unknown> = {}) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId, ...binding } });
  expect(issued.status).toBe(200);
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name } });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; name: string; phoneToken: string; mode: string };
};
const putEvents = (app: App, token: string | undefined, events: unknown[]) => call(app, 'PUT', '/events', { token, body: { events } });
const driverEvents = async (app: App, car: Car, seatId: string) =>
  (await call(app, 'GET', `/events?date=2026-11-11&driver=${seatId}`, { token: car.carToken })).body as { receivedAt: string | null; events: { id: string }[] };
const todayIds = async (app: App, car: Car, seatId: string) =>
  ((await call(app, 'GET', `/schedules/today?driver=${seatId}`, { token: car.carToken })).body.schedules as { id: string }[]).map((s) => s.id);
const drivers = async (app: App, car: Car) => (await call(app, 'GET', '/drivers', { token: car.carToken })).body as {
  carId: string;
  seats: { seatId: string; name: string; btDeviceId: string | null; pleosProfileId: string | null; lastEventsAt: string | null; presence: string | null; lastPresenceAt: string | null; pairedAt: string }[];
  present: { seatId: string; at: string }[];
  lastSelectedSeatId: string | null;
  serverTime: string;
};
const place = catalog.places[0];

describe('POST /pair/code · 차 등록', () => {
  it('처음이면 차를 만들고 차 토큰을 한 번만 알려 주며, 코드는 5분 동안 산다', async () => {
    const app = makeApp();
    const first = await call(app, 'POST', '/pair/code', { body: {} });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      carToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      code: expect.stringMatching(/^\d{6}$/),
      expiresAt: new Date(clockMs + CODE_TTL_MS).toISOString(),
      expiresInSeconds: 300,
      mode: 'new',
      seatId: null,
    });
    expect(first.body.qr).toBe(`chagok://pair?code=${first.body.code}`);
    const again = await call(app, 'POST', '/pair/code', { token: first.body.carToken });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ carId: first.body.carId, carToken: null });
  });

  it('차 id를 정해 오면 그 id로 만들고, 토큰 없이 같은 id를 또 부르면 자리가 없어도 401이며 토큰을 다시 내주지 않는다', async () => {
    const app = makeApp();
    const car = await registerCar(app, 'car-1');
    expect(car.carId).toBe('car-1');
    // 토큰을 잃은 차는 carId만으로 토큰을 바꿀 수 없다(새 carId로 다시 등록한다). 원래 토큰은 그대로 쓸 수 있다.
    expect((await call(app, 'POST', '/pair/code', { body: { carId: 'car-1' } })).status).toBe(401);
    expect((await call(app, 'GET', '/drivers', { token: car.carToken })).status).toBe(200);
    await connect(app, car, 'Pixel');
    expect((await call(app, 'POST', '/pair/code', { body: { carId: 'car-1' } })).status).toBe(401);
    expect((await call(app, 'POST', '/pair/code', { token: car.carToken, body: { carId: 'other' } })).status).toBe(403);
  });

  it.each([
    ['JSON이 아님', { raw: '{' }],
    ['배열', { body: [] }],
    ['carId 빈 문자열', { body: { carId: '' } }],
    ['mode 오류', { body: { mode: 'swap' } }],
    ['replace인데 seatId 없음', { body: { mode: 'replace' } }],
    ['new인데 seatId', { body: { seatId: 'x' } }],
    ['모르는 항목', { body: { extra: 1 } }],
    ['btDeviceId 숫자', { body: { btDeviceId: 1 } }],
  ] as [string, Opts][])('잘못된 코드 요청(%s)은 400', async (_name, opts) => {
    expect((await call(makeApp(), 'POST', '/pair/code', opts)).status).toBe(400);
  });

  it('없는 자리를 바꾸려는 코드는 404이고, 다른 차의 자리도 404이다', async () => {
    const app = makeApp();
    const carA = await registerCar(app);
    const carB = await registerCar(app);
    const seatB = await connect(app, carB, 'B폰');
    expect((await call(app, 'POST', '/pair/code', { token: carA.carToken, body: { mode: 'replace', seatId: 'nope' } })).status).toBe(404);
    expect((await call(app, 'POST', '/pair/code', { token: carA.carToken, body: { mode: 'replace', seatId: seatB.seatId } })).status).toBe(404);
  });
});

describe('폰 여러 대: 운전자 자리', () => {
  it('폰마다 자리가 생기고 GET /drivers가 목록·최근 차에 붙은 폰·지난번 고른 자리를 준다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'Pixel 9');
    clockMs += 1000;
    const b = await connect(app, car, 'Galaxy S25');
    expect(a.mode).toBe('new');
    expect(a.seatId).not.toBe(b.seatId);

    const first = await drivers(app, car);
    expect(first.carId).toBe(car.carId);
    expect(first.seats.map((s) => s.name)).toEqual(['Pixel 9', 'Galaxy S25']);
    expect(first.seats[0]).toMatchObject({ seatId: a.seatId, btDeviceId: null, pleosProfileId: null, lastEventsAt: null, presence: null, lastPresenceAt: null });
    expect(JSON.stringify(first)).not.toContain(a.phoneToken); // 토큰은 목록에 나오지 않는다
    expect(first.present).toEqual([]);
    expect(first.lastSelectedSeatId).toBe(b.seatId); // 고른 적이 없으면 가장 최근에 연결한 자리
    expect(first.serverTime).toBe(new Date(clockMs).toISOString());

    // 바꾸기 칩으로 고른 자리를 기억한다.
    const sel = await call(app, 'PUT', '/drivers/selected', { token: car.carToken, body: { seatId: a.seatId } });
    expect(sel).toMatchObject({ status: 200, body: { lastSelectedSeatId: a.seatId } });
    expect((await drivers(app, car)).lastSelectedSeatId).toBe(a.seatId);
    expect((await call(app, 'PUT', '/drivers/selected', { token: car.carToken, body: { seatId: 'nope' } })).status).toBe(404);
    expect((await call(app, 'PUT', '/drivers/selected', { token: car.carToken, body: {} })).status).toBe(400);
  });

  it('차 API는 차 토큰이 있어야 하고, 다른 차의 토큰으로는 그 차의 자리를 볼 수 없다', async () => {
    const app = makeApp();
    const carA = await registerCar(app);
    const carB = await registerCar(app);
    const a = await connect(app, carA, 'A폰');
    expect((await call(app, 'GET', '/drivers')).status).toBe(401);
    expect((await call(app, 'GET', '/drivers', { token: 'x'.repeat(64) })).status).toBe(401);
    expect((await call(app, 'GET', '/drivers', { token: a.phoneToken })).status).toBe(401); // 폰 토큰은 차 API에 못 쓴다
    expect((await call(app, 'GET', '/drivers', { token: 'bad token' })).status).toBe(401);
    expect((await drivers(app, carB)).seats).toEqual([]);
    expect((await call(app, 'PUT', '/drivers/selected', { token: carB.carToken, body: { seatId: a.seatId } })).status).toBe(404);
    expect((await call(app, 'DELETE', '/car')).status).toBe(401);
  });

  it('자리 이름이 겹치면 숫자를 붙이고, 빈 이름은 "내 폰"이다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    expect((await connect(app, car, 'Pixel')).name).toBe('Pixel');
    expect((await connect(app, car, 'Pixel')).name).toBe('Pixel 2');
    expect((await connect(app, car, '  ')).name).toBe('내 폰');
    expect((await connect(app, car, 'x'.repeat(100))).name).toBe('x'.repeat(40));
  });

  it(`한 차에 폰은 ${MAX_SEATS_PER_CAR}대까지다`, async () => {
    const app = makeApp();
    const car = await registerCar(app);
    for (let i = 0; i < MAX_SEATS_PER_CAR; i++) await connect(app, car, `폰${i}`);
    const res = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    expect(res).toMatchObject({ status: 409, body: { reason: 'seat-limit' } });
  });

  it('폰이 차 블루투스에 붙었다·떨어졌다 알리면 자리에 남고 GET /drivers에 보인다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    clockMs += 60_000;
    const on = await call(app, 'POST', '/presence', { token: a.phoneToken, body: { connected: true } });
    expect(on).toMatchObject({ status: 200, body: { seatId: a.seatId, connected: true, at: new Date(clockMs).toISOString() } });
    clockMs += 60_000;
    await call(app, 'POST', '/presence', { token: b.phoneToken, body: { connected: true } });
    let view = await drivers(app, car);
    expect(view.present.map((p) => p.seatId)).toEqual([b.seatId, a.seatId]); // 최근에 알린 폰이 먼저
    expect(view.seats.find((s) => s.seatId === a.seatId)).toMatchObject({ presence: 'connected', lastPresenceAt: new Date(clockMs - 60_000).toISOString() });

    clockMs += 1000;
    await call(app, 'POST', '/presence', { token: a.phoneToken, body: { connected: false } });
    view = await drivers(app, car);
    expect(view.present.map((p) => p.seatId)).toEqual([b.seatId]);
    expect(view.seats.find((s) => s.seatId === a.seatId)).toMatchObject({ presence: 'disconnected' });

    expect((await call(app, 'POST', '/presence', { body: { connected: true } })).status).toBe(401);
    expect((await call(app, 'POST', '/presence', { token: 'z'.repeat(64), body: { connected: true } })).status).toBe(401);
    expect((await call(app, 'POST', '/presence', { token: a.phoneToken, body: { connected: 'yes' } })).status).toBe(400);
  });

  it('코드를 낼 때 알려 준 블루투스 기기·프로필이 자리에 묶인다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { btDeviceId: 'AA:BB', pleosProfileId: 'profile-1' } });
    const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name: 'Pixel' } });
    const seat = (await drivers(app, car)).seats.find((s) => s.seatId === claimed.body.seatId)!;
    expect(seat).toMatchObject({ btDeviceId: 'AA:BB', pleosProfileId: 'profile-1' });
  });
});

describe('자리별 데이터: 서로의 일정을 보지 못한다', () => {
  it('자리 둘이 각자 보낸 일정만 보고, 차는 driver로 그 자리 일정을 받는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    expect((await putEvents(app, a.phoneToken, [ev({ id: 'a-1', title: 'A의 회의' })])).status).toBe(200);
    expect((await putEvents(app, b.phoneToken, [ev({ id: 'b-1', title: 'B의 점심' }), ev({ id: 'b-2' })])).status).toBe(200);

    expect((await driverEvents(app, car, a.seatId)).events.map((e) => e.id)).toEqual(['a-1']);
    expect((await driverEvents(app, car, b.seatId)).events.map((e) => e.id)).toEqual(['b-1', 'b-2']);
    expect(await todayIds(app, car, a.seatId)).toEqual(['a-1']);
    expect(await todayIds(app, car, b.seatId)).toEqual(['b-1', 'b-2']);
    // 폰은 토큰으로 자기 자리만 본다.
    expect(((await call(app, 'GET', '/events?date=2026-11-11', { token: a.phoneToken })).body.events as { id: string }[]).map((e) => e.id)).toEqual(['a-1']);
    expect(((await call(app, 'GET', '/schedules/today', { token: b.phoneToken })).body.schedules as { id: string }[]).map((s) => s.id)).toEqual(['b-1', 'b-2']);
    // 일정을 받은 자리의 시각이 남는다.
    const view = await drivers(app, car);
    expect(view.seats.every((s) => s.lastEventsAt === new Date(clockMs).toISOString())).toBe(true);
  });

  it('캘린더 선택·장소 보정·채비·자주 가는 곳·가족 요청도 자리별이다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    for (const seat of [a, b]) await putEvents(app, seat.phoneToken, [ev({ id: 'same-id', title: seat.name })]);

    // 선택
    await call(app, 'PUT', '/calendars/selection', { token: a.phoneToken, body: { selectedIds: ['cal-9'], revision: 1, source: 'device' } });
    expect((await call(app, 'GET', '/calendars/selection', { token: a.phoneToken })).body.selectedIds).toEqual(['cal-9']);
    expect((await call(app, 'GET', '/calendars/selection', { token: b.phoneToken })).body.selectedIds).toBeNull();
    expect(await todayIds(app, car, a.seatId)).toEqual([]);
    expect(await todayIds(app, car, b.seatId)).toEqual(['same-id']);

    // 채비·보정
    expect((await call(app, 'PUT', '/schedules/same-id/care', { token: b.phoneToken, body: { care: '우산' } })).status).toBe(200);
    expect((await call(app, 'PUT', '/schedules/same-id/place', { token: b.phoneToken, body: { placeId: place.id } })).status).toBe(200);
    const bToday = (await call(app, 'GET', `/schedules/today?driver=${b.seatId}`, { token: car.carToken })).body.schedules[0];
    expect(bToday).toMatchObject({ care: '우산', place: { name: place.name } });
    await call(app, 'PUT', '/calendars/selection', { token: a.phoneToken, body: { selectedIds: ['cal-1'], revision: 2, source: 'device' } });
    expect((await call(app, 'GET', `/schedules/today?driver=${a.seatId}`, { token: car.carToken })).body.schedules[0]).toMatchObject({ care: null, place: null });

    // 자주 가는 곳
    await call(app, 'PUT', '/places/favorites/home', { token: a.phoneToken, body: { placeId: place.id } });
    expect((await call(app, 'GET', '/places/favorites', { token: a.phoneToken })).body.home).toMatchObject({ id: place.id });
    expect((await call(app, 'GET', '/places/favorites', { token: b.phoneToken })).body.home).toBeNull();
    const aFav = (await call(app, 'GET', `/schedules/today?driver=${a.seatId}`, { token: car.carToken })).body.favorites as { kind: string }[];
    const bFav = (await call(app, 'GET', `/schedules/today?driver=${b.seatId}`, { token: car.carToken })).body.favorites as unknown[];
    expect(aFav.map((f) => f.kind)).toEqual(['home']);
    expect(bFav).toEqual([]);

    // 가족 요청
    const member = (await call(app, 'GET', '/family/members')).body.members[0];
    expect((await call(app, 'POST', '/schedules/same-id/family-request', { token: b.phoneToken, body: { memberId: member.id } })).status).toBe(200);
    expect((await call(app, 'GET', '/family/requests', { token: b.phoneToken })).body.requests).toHaveLength(1);
    expect((await call(app, 'GET', '/family/requests', { token: a.phoneToken })).body.requests).toHaveLength(0);
  });

  it('driver는 차 토큰(그 자리를 가진 차)이나 그 자리 폰의 토큰이 있어야 한다', async () => {
    const app = makeApp();
    const carA = await registerCar(app);
    const carB = await registerCar(app);
    const a = await connect(app, carA, 'A');
    const b = await connect(app, carB, 'B');
    expect((await call(app, 'GET', `/events?driver=${a.seatId}`)).status).toBe(401); // 토큰 없음
    expect((await call(app, 'GET', `/events?driver=${a.seatId}`, { token: carB.carToken })).status).toBe(403); // 다른 차
    expect((await call(app, 'GET', `/events?driver=${a.seatId}`, { token: b.phoneToken })).status).toBe(403); // 다른 폰
    expect((await call(app, 'GET', '/events?driver=nope', { token: carA.carToken })).status).toBe(403);
    expect((await call(app, 'GET', `/events?driver=${a.seatId}`, { token: a.phoneToken })).status).toBe(200); // 자기 자리
    expect((await call(app, 'GET', `/events?driver=${a.seatId}`, { token: carA.carToken })).status).toBe(200);
    expect((await call(app, 'GET', `/events?driver=${a.seatId}`, { token: 'q'.repeat(64) })).status).toBe(401);
  });

  it('차는 자리별 일정으로 기본 자리·다른 자리의 일정을 받지 못한다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await putEvents(app, undefined, [ev({ id: 'default-ev' })]); // 연결 뒤 토큰 없이 보낸 일정은 기본 자리
    expect((await driverEvents(app, car, a.seatId)).receivedAt).toBeNull();
    // 일정을 받은 적 없는 실제 자리는 목 일정(픽스처)으로 떨어지지 않고 0건이다(픽스처는 기본 자리에서만).
    expect(await todayIds(app, car, a.seatId)).toEqual([]);
  });
});

describe('폰 바꾸기', () => {
  it('같은 자리를 이어받는다: 옛 토큰은 무효, 기억(자주 가는 곳·가족 요청)은 유지, 옛 폰 일정·선택은 비운다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const old = await connect(app, car, '옛 폰');
    const other = await connect(app, car, '다른 사람');
    await putEvents(app, old.phoneToken, [ev({ id: 'old-ev' })]);
    await call(app, 'PUT', '/calendars/selection', { token: old.phoneToken, body: { selectedIds: ['cal-1'], revision: 1, source: 'device' } });
    await call(app, 'PUT', '/places/favorites/home', { token: old.phoneToken, body: { placeId: place.id } });
    await putEvents(app, other.phoneToken, [ev({ id: 'other-ev' })]);

    clockMs += 60_000;
    const replaced = await replaceSeat(app, car, old.seatId, '새 폰', { btDeviceId: 'NEW:BT' });
    expect(replaced).toMatchObject({ seatId: old.seatId, name: '새 폰', mode: 'replace' });
    expect(replaced.phoneToken).not.toBe(old.phoneToken);

    // 옛 토큰은 모든 폰 API에서 401
    expect((await putEvents(app, old.phoneToken, [ev()])).status).toBe(401);
    expect((await call(app, 'GET', '/pair', { token: old.phoneToken })).status).toBe(401);
    expect((await call(app, 'GET', '/places/favorites', { token: old.phoneToken })).status).toBe(401);
    expect((await call(app, 'DELETE', '/pair', { token: old.phoneToken })).status).toBe(401);
    expect((await call(app, 'POST', '/presence', { token: old.phoneToken, body: { connected: true } })).status).toBe(401);

    // 기억은 남고, 옛 폰의 일정·캘린더 선택은 비워진다.
    expect((await call(app, 'GET', '/places/favorites', { token: replaced.phoneToken })).body.home).toMatchObject({ id: place.id });
    expect((await call(app, 'GET', `/calendars/selection`, { token: replaced.phoneToken })).body.selectedIds).toBeNull();
    // 옛 폰의 일정은 '받았고 0건' 상태가 된다(픽스처로 떨어지지 않는다).
    expect(await driverEvents(app, car, old.seatId)).toMatchObject({ receivedAt: new Date(clockMs).toISOString(), events: [] });
    expect(await todayIds(app, car, old.seatId)).toEqual([]);
    // 새 폰이 일정을 보내면 같은 자리로 쌓인다. 다른 자리는 그대로다.
    await putEvents(app, replaced.phoneToken, [ev({ id: 'new-ev' })]);
    expect((await driverEvents(app, car, old.seatId)).events.map((e) => e.id)).toEqual(['new-ev']);
    expect((await driverEvents(app, car, other.seatId)).events.map((e) => e.id)).toEqual(['other-ev']);

    const view = await drivers(app, car);
    expect(view.seats).toHaveLength(2); // 자리는 늘지 않는다
    expect(view.seats.find((s) => s.seatId === old.seatId)).toMatchObject({
      name: '새 폰', btDeviceId: 'NEW:BT', presence: null, pairedAt: new Date(clockMs).toISOString(),
    });
    expect((await call(app, 'GET', '/pair', { token: replaced.phoneToken })).body).toMatchObject({ paired: true, seatId: old.seatId, name: '새 폰' });
  });

  it('바꾸려던 자리가 그 사이 끊기면 코드가 쓸 수 없게 된다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId: a.seatId } });
    expect((await call(app, 'DELETE', '/pair', { token: a.phoneToken })).status).toBe(200);
    expect((await call(app, 'GET', '/pair/status', { token: car.carToken })).body.state).toBe('expired');
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code } })).status).toBe(404);
  });

  it('같은 폰이 같은 차에 다시 연결하면 자리를 늘리지 않고 토큰만 새로 받는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const first = await connect(app, car, 'Pixel');
    await call(app, 'PUT', '/places/favorites/home', { token: first.phoneToken, body: { placeId: place.id } });
    const again = await connect(app, car, 'Pixel', { phoneToken: first.phoneToken });
    expect(again.seatId).toBe(first.seatId);
    expect(again.phoneToken).not.toBe(first.phoneToken);
    expect((await call(app, 'GET', '/pair', { token: first.phoneToken })).status).toBe(401);
    expect((await call(app, 'GET', '/places/favorites', { token: again.phoneToken })).body.home).toMatchObject({ id: place.id });
    expect((await drivers(app, car)).seats).toHaveLength(1);
  });
});

describe('연결 끊기·차곡 초기화', () => {
  it('폰의 연결 끊기는 그 자리의 연결·일정·기억만 지우고 목록에서 뺀다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    for (const seat of [a, b]) {
      await putEvents(app, seat.phoneToken, [ev({ id: `${seat.name}-ev` })]);
      await call(app, 'PUT', '/places/favorites/home', { token: seat.phoneToken, body: { placeId: place.id } });
    }
    await call(app, 'PUT', '/drivers/selected', { token: car.carToken, body: { seatId: a.seatId } });

    const res = await call(app, 'DELETE', '/pair', { token: a.phoneToken });
    expect(res).toMatchObject({ status: 200, body: { disconnected: true, seatId: a.seatId } });
    expect((await call(app, 'GET', '/pair', { token: a.phoneToken })).status).toBe(401);
    expect((await call(app, 'GET', '/places/favorites', { token: a.phoneToken })).status).toBe(401);
    const view = await drivers(app, car);
    expect(view.seats.map((s) => s.seatId)).toEqual([b.seatId]);
    expect(view.lastSelectedSeatId).toBe(b.seatId); // 지운 자리는 '지난번 고른 자리'에서 빠진다
    expect((await call(app, 'GET', `/events?driver=${a.seatId}`, { token: car.carToken })).status).toBe(403);
    // B의 데이터는 그대로다.
    expect((await driverEvents(app, car, b.seatId)).events.map((e) => e.id)).toEqual(['B-ev']);
    expect((await call(app, 'GET', '/places/favorites', { token: b.phoneToken })).body.home).toMatchObject({ id: place.id });

    // 같은 폰이 다시 연결하면 새 자리이고 지워진 기억은 돌아오지 않는다.
    const back = await connect(app, car, 'A');
    expect(back.seatId).not.toBe(a.seatId);
    expect((await call(app, 'GET', '/places/favorites', { token: back.phoneToken })).body.home).toBeNull();
    expect((await driverEvents(app, car, back.seatId)).receivedAt).toBeNull();
  });

  it('DELETE /car는 그 차의 모든 자리와 데이터를 지우고, 다른 차는 그대로이며, 차는 새 코드를 낼 수 있다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const other = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    const o = await connect(app, other, 'O');
    await putEvents(app, a.phoneToken, [ev({ id: 'a' })]);
    await putEvents(app, o.phoneToken, [ev({ id: 'o' })]);
    await call(app, 'PUT', '/places/favorites/home', { token: b.phoneToken, body: { placeId: place.id } });
    const waiting = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });

    const res = await call(app, 'DELETE', '/car', { token: car.carToken });
    expect(res).toMatchObject({ status: 200, body: { removedSeats: 2 } });
    for (const seat of [a, b]) expect((await call(app, 'GET', '/pair', { token: seat.phoneToken })).status).toBe(401);
    expect((await drivers(app, car)).seats).toEqual([]);
    expect((await drivers(app, car)).lastSelectedSeatId).toBeNull();
    expect((await call(app, 'POST', '/pair/claim', { body: { code: waiting.body.code } })).status).toBe(404); // 기다리던 코드도 버린다
    expect((await call(app, 'GET', '/pair/status', { token: car.carToken })).body.state).toBe('none');
    // 다른 차는 그대로
    expect((await drivers(app, other)).seats.map((s) => s.seatId)).toEqual([o.seatId]);
    expect((await driverEvents(app, other, o.seatId)).events.map((e) => e.id)).toEqual(['o']);
    // 차는 같은 토큰으로 새 자리를 연결할 수 있고, 지운 기억은 없다.
    const fresh = await connect(app, car, 'B');
    expect((await call(app, 'GET', '/places/favorites', { token: fresh.phoneToken })).body.home).toBeNull();
  });
});

describe('코드: 5분 만료·상태·시도 제한', () => {
  it('5분이 지난 코드는 연결되지 않고, 새 코드를 받으면 이전 코드는 버려진다', async () => {
    const codes = [0.111111, 0.222222, 0.333333, 0.444444];
    const app = makeApp({ seats: createSeatStore(() => new Date(clockMs), () => codes.shift() ?? 0.5) });
    const car = await registerCar(app);
    const first = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    clockMs += CODE_TTL_MS - 1;
    expect((await call(app, 'GET', '/pair/status', { token: car.carToken })).body).toMatchObject({ state: 'waiting', mode: { kind: 'new' } });
    clockMs += 1;
    expect((await call(app, 'GET', '/pair/status', { token: car.carToken })).body.state).toBe('expired');
    expect((await call(app, 'POST', '/pair/claim', { body: { code: first.body.code } })).status).toBe(404);

    const second = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    const third = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    expect(second.body.code).not.toBe(third.body.code);
    expect((await call(app, 'POST', '/pair/claim', { body: { code: second.body.code } })).status).toBe(404);
    expect((await call(app, 'POST', '/pair/claim', { body: { code: third.body.code } })).status).toBe(200);
  });

  it('차는 /pair/status로 코드가 쓰였는지 알고, 쓴 코드는 다시 쓸 수 없다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    expect((await call(app, 'GET', '/pair/status', { token: car.carToken })).body).toMatchObject({ state: 'waiting' });
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name: 'Pixel' } });
    expect((await call(app, 'GET', '/pair/status', { token: car.carToken })).body).toMatchObject({ state: 'claimed', seatId: claimed.body.seatId });
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code } })).status).toBe(404);
    expect((await call(app, 'GET', '/pair/status')).status).toBe(401);
  });

  it('틀린 코드를 한 주소가 5번 넣으면 그 주소만 1분 막힌다(맞는 코드도 막힘, 429+Retry-After)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    const wrong = issued.body.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < MAX_FAILURES; i++) expect((await call(app, 'POST', '/pair/claim', { body: { code: wrong }, ip: '1.1.1.1' })).status).toBe(404);
    const locked = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: '1.1.1.1' });
    expect(locked).toMatchObject({ status: 429, body: { reason: 'locked', retryAfterSeconds: 60 } });
    expect(locked.headers.get('retry-after')).toBe('60');
    // 잠긴 동안의 요청은 잠금을 늘리지 않는다.
    clockMs += CLAIM_LOCK_MS - 1;
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: '1.1.1.1' })).status).toBe(429);
    // 다른 주소는 막히지 않는다.
    const ok = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: '2.2.2.2' });
    expect(ok.status).toBe(200);
  });

  it('잠금이 풀리면 다시 연결할 수 있고, 4번만 틀리고 맞히면 횟수가 지워진다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    const wrong = issued.body.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < MAX_FAILURES; i++) await call(app, 'POST', '/pair/claim', { body: { code: wrong }, ip: '1.1.1.1' });
    clockMs += CLAIM_LOCK_MS;
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: '1.1.1.1' })).status).toBe(200);

    const next = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    for (let i = 0; i < MAX_FAILURES - 1; i++) await call(app, 'POST', '/pair/claim', { body: { code: wrong }, ip: '3.3.3.3' });
    expect((await call(app, 'POST', '/pair/claim', { body: { code: next.body.code }, ip: '3.3.3.3' })).status).toBe(200);
    // 맞힌 뒤에는 다시 5번까지 틀릴 수 있다.
    for (let i = 0; i < MAX_FAILURES - 1; i++) expect((await call(app, 'POST', '/pair/claim', { body: { code: wrong }, ip: '3.3.3.3' })).status).toBe(404);
  });

  it('옛 /pairing/claim도 같은 시도 제한을 쓴다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
    const wrong = issued.body.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < MAX_FAILURES; i++) await call(app, 'POST', '/pairing/claim', { body: { code: wrong }, ip: '9.9.9.9' });
    expect((await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code }, ip: '9.9.9.9' })).status).toBe(429);
    expect((await call(app, 'POST', '/pairing/claim', { body: { code: issued.body.code }, ip: '9.9.9.9' })).status).toBe(429);
  });

  it.each([null, {}, { code: '12345' }, { code: 'abcdef' }, { code: 123456 }, { code: '123456', extra: 1 }, { code: '123456', name: 5 }, { code: '123456', name: 'x'.repeat(101) }])(
    '잘못된 연결 요청 %j는 400',
    async (body) => {
      expect((await call(makeApp(), 'POST', '/pair/claim', { body })).status).toBe(400);
    },
  );
});

describe('폰 연결 상태 GET /pair', () => {
  it('토큰이 맞으면 자리 정보를, 없거나 모르는 토큰이면 401을 준다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'Pixel');
    const status = await call(app, 'GET', '/pair', { token: a.phoneToken });
    expect(status.body).toMatchObject({ paired: true, seatId: a.seatId, name: 'Pixel', pairedAt: a.pairedAt, lastEventsAt: null });
    expect(status.body).not.toHaveProperty('carId'); // 폰에는 차 id를 주지 않는다
    expect((await call(app, 'GET', '/pair')).status).toBe(401);
    expect((await call(app, 'GET', '/pair', { token: car.carToken })).status).toBe(401);
  });

  it('쓰기·읽기에서 모르는 폰 토큰이나 이상한 Authorization 형식은 기본 자리로 흘리지 않고 401이다', async () => {
    const app = makeApp();
    expect((await putEvents(app, 'f'.repeat(64), [ev()])).status).toBe(401);
    expect((await call(app, 'GET', '/schedules/today', { token: 'f'.repeat(64) })).status).toBe(401);
    const res = await app.request('/events', { method: 'PUT', headers: { authorization: 'Basic abc', 'content-type': 'application/json' }, body: JSON.stringify({ events: [] }) });
    expect(res.status).toBe(401);
    const get = await app.request('/schedules/today', { headers: { authorization: 'Bearer' } });
    expect(get.status).toBe(401);
  });
});

describe('식별 없는 기존 경로(기본 자리·픽스처) 호환', () => {
  it('식별이 없으면 읽기·쓰기 모두 기본 자리다: 픽스처를 쓰고, 보낸 일정은 기본 자리에 쌓인다', async () => {
    const app = makeApp({ isLoopback: () => true });
    expect(((await call(app, 'GET', '/schedules/today')).body.schedules as { id: string }[]).map((s) => s.id)).toContain('gwangju-lunch');
    expect((await call(app, 'GET', '/events')).body.receivedAt).toBeNull();
    expect((await putEvents(app, undefined, [ev({ id: 'x' })])).status).toBe(200);
    expect(((await call(app, 'GET', '/schedules/today')).body.schedules as { id: string }[]).map((s) => s.id)).toEqual(['x']);
    expect((await call(app, 'DELETE', '/events')).body).toEqual({ receivedAt: null }); // 개발용 초기화로 픽스처 복귀
    expect(((await call(app, 'GET', '/schedules/today')).body.schedules as { id: string }[]).map((s) => s.id)).toContain('gwangju-lunch');
  });

  it('새 자리는 기본 자리의 데이터를 이어받지 않는다(이어받기 없음)', async () => {
    const app = makeApp();
    // 식별 없이 보낸 연결 전 데이터(데모·옛 클라이언트)는 기본 자리에 남는다.
    await putEvents(app, undefined, [ev({ id: 'pre' })]);
    await call(app, 'PUT', '/schedules/pre/care', { body: { care: '충전기' } });
    await call(app, 'PUT', '/places/favorites/home', { body: { placeId: place.id } });
    const car = await registerCar(app);
    const first = await connect(app, car, 'Pixel');
    expect((await driverEvents(app, car, first.seatId)).receivedAt).toBeNull();
    expect((await call(app, 'GET', '/places/favorites', { token: first.phoneToken })).body.home).toBeNull();
    // 기본 자리는 그대로다.
    expect((await call(app, 'GET', '/events')).body.events.map((e: { id: string }) => e.id)).toEqual([]); // 차가 하나뿐이라 옛 읽기는 그 자리를 본다
    expect((await call(app, 'GET', '/places/favorites', { token: car.carToken })).body.home).toBeNull();
  });

  it('옛 /pairing 경로: 차 id만으로 코드·상태·초기화가 되고, 같은 저장소의 자리·토큰이 함께 생긴다', async () => {
    const app = makeApp({ isLoopback: () => true });
    const issue = async () => (await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-1' } })).body as { code: string; qr: string; carToken: string | null };
    const first = await issue();
    expect(first.carToken).toMatch(/^[0-9a-f]{64}$/); // 처음 만든 응답에만 차 토큰이 실린다
    expect((await issue()).carToken).toBeNull();
    const claimed = await call(app, 'POST', '/pairing/claim', { body: { code: (await issue()).code, name: '옛 앱 폰' } });
    expect(claimed.body).toMatchObject({ seatId: expect.any(String), name: '옛 앱 폰', pairedAt: expect.any(String) });
    expect(claimed.body).not.toHaveProperty('carId');
    // 새 API로도 같은 자리가 보인다.
    const view = await drivers(app, { carId: 'car-1', carToken: first.carToken as string });
    expect(view.seats.map((s) => s.name)).toEqual(['옛 앱 폰']);
    expect((await call(app, 'GET', '/pairing/cars/car-1')).body).toMatchObject({ paired: true, codeActive: false });
    // 자리가 있어도 같은 기기(루프백)의 옛 경로는 carId만으로 새 코드를 받는다(에뮬레이터 차 앱 호환).
    expect((await call(app, 'POST', '/pairing/codes', { body: { carId: 'car-1' } })).status).toBe(200);
    expect((await call(app, 'GET', '/pairing/cars/car-1')).body).toMatchObject({ paired: true, codeActive: true });
    // 데모 초기화는 모든 자리를 지운다.
    expect((await call(app, 'DELETE', '/pairing/cars/car-1')).body).toEqual({ paired: false, pairedAt: null, codeActive: false });
    expect((await call(app, 'GET', '/pair', { token: claimed.body.phoneToken })).status).toBe(401);
    expect((await drivers(app, { carId: 'car-1', carToken: first.carToken as string })).seats).toEqual([]);
  });
});

describe('SeatStore 단위', () => {
  it('자리 이벤트(생성·교체·삭제)를 구독자에게 알린다', () => {
    const store = createSeatStore(() => new Date(clockMs), () => 0.5);
    const events: string[] = [];
    store.subscribe((e) => events.push(`${e.type}`));
    const created = store.createCar('addr', 'c');
    if (!created.ok) throw new Error('차를 만들지 못했습니다');
    const car = created.car;
    const issued = store.issueCode(car.carId, { kind: 'new' });
    expect(issued.ok).toBe(true);
    const claim = store.claim({ code: '500000', source: 's', name: 'A' });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    store.issueCode(car.carId, { kind: 'replace', seatId: claim.seat.seatId });
    store.claim({ code: '500000', source: 's', name: 'B' });
    expect(events).toEqual(['created', 'replaced']);
    expect(store.resetCar('c')).toBe(1);
    expect(events).toEqual(['created', 'replaced', 'removed']);
  });
});
