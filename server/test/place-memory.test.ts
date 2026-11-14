import { describe, expect, it } from 'vitest';
import { MAX_MEMORIES } from '../src/placeSearch/limits.js';
import { createSeatStore } from '../src/seats.js';
import { catalog, newApp } from './helpers.js';

/** 시계를 고정한다: 서울 2026-11-11 10:00. */
const NOW = '2026-11-11T10:00:00+09:00';
let clockMs = Date.parse(NOW);
const makeApp = (over: Parameters<typeof newApp>[0] = {}) => {
  clockMs = Date.parse(NOW);
  const now = () => new Date(clockMs);
  return newApp({ now, seats: createSeatStore(now), clientAddress: (c) => c.req.header('x-test-ip') ?? 'test', ...over });
};
type App = ReturnType<typeof makeApp>;

type Opts = { token?: string; body?: unknown; device?: string; raw?: string };
const call = async (app: App, method: string, path: string, { token, body, device, raw }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-chagok-device'] = device;
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text; // 깨진 JSON 본문의 400은 평문이다
  }
  return { status: res.status, body: parsed };
};

type Car = { carId: string; carToken: string };
const registerCar = async (app: App): Promise<Car> => {
  const res = await call(app, 'POST', '/pair/code', { body: {} });
  return { carId: res.body.carId, carToken: res.body.carToken };
};
const connect = async (app: App, car: Car, name: string, opts: { device?: string } = {}) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device: opts.device });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; phoneToken: string };
};
const replaceSeat = async (app: App, car: Car, seatId: string, name: string) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId } });
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name } });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; phoneToken: string };
};

const HOME = { name: '샘플 아파트', lat: 35.1743, lng: 126.9121, address: '광주 북구 샘플로 12' };
const GYM = { name: '체육관', lat: 35.1527, lng: 126.8483 };
const memoryBody = (name: string, place: object = HOME, ambiguous = false) => ({ name, place, ambiguous });
/** 차가 driver를 지정해 기억을 쓴다. */
const carPut = (app: App, car: Car, seatId: string, body: unknown) => call(app, 'PUT', `/places/memory?driver=${seatId}`, { token: car.carToken, body });
const phoneList = async (app: App, token: string) => (await call(app, 'GET', '/places/memory', { token })).body.memories as { name: string; place: any; ambiguous: boolean; updatedAt: string }[];
const names = async (app: App, token: string) => (await phoneList(app, token)).map((m) => m.name);
const resolveVia = async (app: App, car: Car, seatId: string, name: string) =>
  (await call(app, 'POST', `/places/resolve?driver=${seatId}`, { token: car.carToken, body: { name } })).body as { via: string; memory: { ambiguous: boolean } | null };

describe('PUT /places/memory · 저장', () => {
  it('차 토큰 + driver로 그 자리에 저장하고 저장한 내용을 돌려준다(주소는 없으면 null, 이름 앞뒤 공백 정리)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const res = await carPut(app, car, a.seatId, memoryBody('  스타벅스   상무점 ', { name: ' 스타벅스 상무점 ', lat: 35.15, lng: 126.85 }, true));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: '스타벅스 상무점',
      place: { name: '스타벅스 상무점', address: null, lat: 35.15, lng: 126.85 },
      ambiguous: true,
      updatedAt: new Date(clockMs).toISOString(),
    });
    expect(await phoneList(app, a.phoneToken)).toEqual([res.body]);
  });

  it('같은 이름(공백·대소문자만 다른 것)은 하나로 덮어쓰고 최근에 쓴 순으로 나열한다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await carPut(app, car, a.seatId, memoryBody('Gym One', GYM, true));
    clockMs += 1000;
    await carPut(app, car, a.seatId, memoryBody('치과', HOME));
    clockMs += 1000;
    const again = await carPut(app, car, a.seatId, memoryBody('  gym   ONE ', HOME, false));
    expect(again.body).toMatchObject({ name: 'gym ONE', ambiguous: false, place: { name: '샘플 아파트' } });
    const list = await phoneList(app, a.phoneToken);
    expect(list.map((m) => m.name)).toEqual(['gym ONE', '치과']);
    expect(list[0]?.updatedAt).toBe(new Date(clockMs).toISOString());
  });

  it.each([
    ['본문이 배열', []],
    ['name 없음', { place: HOME, ambiguous: false }],
    ['name이 공백뿐', memoryBody('  ')],
    ['name이 너무 길다', memoryBody('가'.repeat(301))],
    ['place 없음', { name: 'x', ambiguous: false }],
    ['place가 배열', { name: 'x', place: [], ambiguous: false }],
    ['place.name 없음', memoryBody('x', { lat: 1, lng: 2 })],
    ['place.name이 너무 길다', memoryBody('x', { name: '가'.repeat(201), lat: 1, lng: 2 })],
    ['lat이 문자열', memoryBody('x', { name: 'p', lat: '1', lng: 2 })],
    ['lat 범위 밖', memoryBody('x', { name: 'p', lat: 91, lng: 2 })],
    ['lng 범위 밖', memoryBody('x', { name: 'p', lat: 1, lng: -181 })],
    ['address가 숫자', memoryBody('x', { name: 'p', lat: 1, lng: 2, address: 3 })],
    ['address가 너무 길다', memoryBody('x', { name: 'p', lat: 1, lng: 2, address: '가'.repeat(301) })],
    ['place의 모르는 필드', memoryBody('x', { name: 'p', lat: 1, lng: 2, id: 'z' })],
    ['ambiguous 없음', { name: 'x', place: HOME }],
    ['ambiguous가 문자열', { name: 'x', place: HOME, ambiguous: 'true' }],
    ['모르는 필드', { name: 'x', place: HOME, ambiguous: false, extra: 1 }],
  ])('400이고 저장하지 않는다: %s', async (_n, body) => {
    const app = makeApp();
    const res = await call(app, 'PUT', '/places/memory', { body });
    expect(res.status).toBe(400);
    expect((await call(app, 'GET', '/places/memory')).body.memories).toEqual([]);
  });

  it('깨진 JSON은 400, 너무 큰 본문은 413', async () => {
    const app = makeApp();
    expect((await call(app, 'PUT', '/places/memory', { raw: '{' })).status).toBe(400);
    expect((await call(app, 'PUT', '/places/memory', { body: memoryBody('x'.repeat(70_000)) })).status).toBe(413);
  });

  it(`자리 하나는 ${MAX_MEMORIES}개까지이고 넘으면 가장 오래 전에 쓴 기억부터 버린다`, async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    for (let i = 0; i <= MAX_MEMORIES; i++) expect((await carPut(app, car, a.seatId, memoryBody(`장소 ${i}`))).status).toBe(200);
    const list = await names(app, a.phoneToken);
    expect(list).toHaveLength(MAX_MEMORIES);
    expect(list).not.toContain('장소 0');
    expect(list[0]).toBe(`장소 ${MAX_MEMORIES}`);
  });
});

describe('PUT /places/memory · 어느 자리에 쓰는가', () => {
  it('driver 없이 차 토큰만이면 그 차의 지난번 고른 자리(없으면 가장 최근 자리)에 쓴다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    clockMs += 1000;
    const b = await connect(app, car, 'B');
    expect((await call(app, 'PUT', '/places/memory', { token: car.carToken, body: memoryBody('집') })).status).toBe(200);
    expect(await names(app, b.phoneToken)).toEqual(['집']); // 가장 최근 자리
    expect(await names(app, a.phoneToken)).toEqual([]);
    expect((await call(app, 'PUT', '/drivers/selected', { token: car.carToken, body: { seatId: a.seatId } })).status).toBe(200);
    await call(app, 'PUT', '/places/memory', { token: car.carToken, body: memoryBody('회사') });
    expect(await names(app, a.phoneToken)).toEqual(['회사']);
  });

  it('차가 자기 차의 자리가 아닌 driver를 쓰면 403, 자리 없는 차가 driver 없이 쓰면 409다', async () => {
    const app = makeApp();
    const carA = await registerCar(app);
    const carB = await registerCar(app);
    const seatA = await connect(app, carA, 'A');
    expect((await carPut(app, carB, seatA.seatId, memoryBody('집'))).status).toBe(403);
    expect((await carPut(app, carA, 'nope', memoryBody('집'))).status).toBe(403);
    expect((await call(app, 'PUT', '/places/memory', { token: carB.carToken, body: memoryBody('집') })).status).toBe(409);
    expect(await names(app, seatA.phoneToken)).toEqual([]);
  });

  it('모르는 토큰은 401이고 기본 자리나 버킷으로 흘리지 않는다', async () => {
    const app = makeApp();
    const bad = 'f'.repeat(64);
    expect((await call(app, 'PUT', '/places/memory', { token: bad, body: memoryBody('집') })).status).toBe(401);
    expect((await call(app, 'PUT', '/places/memory', { token: bad, device: 'a'.repeat(32), body: memoryBody('집') })).status).toBe(401);
    expect((await call(app, 'GET', '/places/memory')).body.memories).toEqual([]);
  });

  it('폰 토큰으로도 자기 자리에 쓸 수 있다(driver는 무시)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    expect((await call(app, 'PUT', `/places/memory?driver=${b.seatId}`, { token: a.phoneToken, body: memoryBody('집') })).status).toBe(200);
    expect(await names(app, a.phoneToken)).toEqual(['집']);
    expect(await names(app, b.phoneToken)).toEqual([]);
  });

  it('식별이 없는 요청(데모·픽스처 경로)은 기본 자리에 쓰고 읽는다', async () => {
    const app = makeApp();
    expect((await call(app, 'PUT', '/places/memory', { body: memoryBody('집') })).status).toBe(200);
    expect((await call(app, 'GET', '/places/memory')).body.memories.map((m: { name: string }) => m.name)).toEqual(['집']);
  });

  it('연결 전 폰(기기 id만)은 그 기기의 버킷에 쌓이고, 연결하면 새 자리가 이어받는다', async () => {
    const app = makeApp();
    const dev = 'd'.repeat(32);
    const other = 'e'.repeat(32);
    await call(app, 'PUT', '/places/memory', { device: dev, body: memoryBody('집') });
    expect((await call(app, 'GET', '/places/memory', { device: dev })).body.memories).toHaveLength(1);
    expect((await call(app, 'GET', '/places/memory', { device: other })).body.memories).toEqual([]);
    const car = await registerCar(app);
    const a = await connect(app, car, 'A', { device: dev });
    expect(await names(app, a.phoneToken)).toEqual(['집']);
  });
});

describe('자리별 격리·연결 끊기·폰 바꾸기', () => {
  it('자리 A의 기억은 자리 B의 목록·resolve·일정에 보이지 않는다(같은 이름이어도 따로)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await carPut(app, car, a.seatId, memoryBody('스타벅스', HOME));
    expect(await names(app, b.phoneToken)).toEqual([]);
    expect((await resolveVia(app, car, a.seatId, '스타벅스')).via).toBe('memory');
    expect((await resolveVia(app, car, b.seatId, '스타벅스')).via).toBe('search');
    await carPut(app, car, b.seatId, memoryBody('스타벅스', GYM, true));
    const ra = (await call(app, 'POST', `/places/resolve?driver=${a.seatId}`, { token: car.carToken, body: { name: '스타벅스' } })).body;
    const rb = (await call(app, 'POST', `/places/resolve?driver=${b.seatId}`, { token: car.carToken, body: { name: '스타벅스' } })).body;
    expect(ra.memory).toMatchObject({ place: { name: '샘플 아파트' }, ambiguous: false });
    expect(rb.memory).toMatchObject({ place: { name: '체육관' }, ambiguous: true });
  });

  it('다른 차의 자리는 차 토큰으로도 읽을 수 없다', async () => {
    const app = makeApp();
    const carA = await registerCar(app);
    const carB = await registerCar(app);
    const a = await connect(app, carA, 'A');
    await carPut(app, carA, a.seatId, memoryBody('집'));
    expect((await call(app, 'GET', `/places/memory?driver=${a.seatId}`, { token: carB.carToken })).status).toBe(403);
    expect((await call(app, 'POST', `/places/resolve?driver=${a.seatId}`, { token: carB.carToken, body: { name: '집' } })).status).toBe(403);
    expect((await call(app, 'GET', `/places/memory?driver=${a.seatId}`, { token: carA.carToken })).body.memories).toHaveLength(1);
  });

  it('연결을 끊으면 그 자리의 기억이 지워지고, 같은 폰이 다시 연결해도 돌아오지 않는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await carPut(app, car, a.seatId, memoryBody('집'));
    await carPut(app, car, b.seatId, memoryBody('회사'));
    expect((await call(app, 'DELETE', '/pair', { token: a.phoneToken })).status).toBe(200);
    expect((await call(app, 'GET', '/places/memory', { token: a.phoneToken })).status).toBe(401);
    const again = await connect(app, car, 'A');
    expect(await names(app, again.phoneToken)).toEqual([]);
    expect(await names(app, b.phoneToken)).toEqual(['회사']); // 다른 자리는 그대로
    // 차 초기화도 그 차의 모든 자리와 기억을 지운다.
    expect((await call(app, 'DELETE', '/car', { token: car.carToken })).status).toBe(200);
    const after = await registerCar(app);
    const fresh = await connect(app, after, 'C');
    expect(await names(app, fresh.phoneToken)).toEqual([]);
  });

  it('폰을 바꿔도(같은 자리 이어받기) 기억은 그대로 남고 옛 토큰은 쓸 수 없다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const old = await connect(app, car, '옛 폰');
    await carPut(app, car, old.seatId, memoryBody('집', HOME, true));
    const replaced = await replaceSeat(app, car, old.seatId, '새 폰');
    expect(replaced.seatId).toBe(old.seatId);
    expect((await call(app, 'GET', '/places/memory', { token: old.phoneToken })).status).toBe(401);
    expect(await phoneList(app, replaced.phoneToken)).toMatchObject([{ name: '집', ambiguous: true }]);
    expect((await resolveVia(app, car, old.seatId, '집')).via).toBe('memory');
  });
});

describe('GET·DELETE /places/memory (폰)', () => {
  it('이름을 URL 인코딩해 지울 수 있다(공백·대소문자·슬래시 포함), 없으면 404, 다른 자리 기억은 못 지운다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점'));
    await carPut(app, car, a.seatId, memoryBody('헬스장/수영장'));
    await carPut(app, car, b.seatId, memoryBody('스타벅스 상무점'));
    expect((await call(app, 'DELETE', `/places/memory/${encodeURIComponent('  스타벅스   상무점')}`, { token: a.phoneToken })).status).toBe(200);
    expect(await names(app, a.phoneToken)).toEqual(['헬스장/수영장']);
    expect(await names(app, b.phoneToken)).toEqual(['스타벅스 상무점']);
    expect((await call(app, 'DELETE', `/places/memory/${encodeURIComponent('스타벅스 상무점')}`, { token: a.phoneToken })).status).toBe(404);
    const slash = await call(app, 'DELETE', `/places/memory/${encodeURIComponent('헬스장/수영장')}`, { token: a.phoneToken });
    expect(slash.status).toBe(200);
    expect(await names(app, a.phoneToken)).toEqual([]);
  });

  it('지운 이름은 resolve에서 다시 검색으로 간다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await carPut(app, car, a.seatId, memoryBody('육전'));
    expect((await resolveVia(app, car, a.seatId, '육전')).via).toBe('memory');
    await call(app, 'DELETE', `/places/memory/${encodeURIComponent('육전')}`, { token: a.phoneToken });
    expect((await resolveVia(app, car, a.seatId, '육전')).via).toBe('search');
  });

  it('토큰이 틀리면 401, 식별 없는 지우기는 기본 자리만 다루며, 연결 전 기기의 지우기는 버킷을 만들지 않는다', async () => {
    const app = makeApp();
    expect((await call(app, 'DELETE', '/places/memory/x', { token: 'f'.repeat(64) })).status).toBe(401);
    expect((await call(app, 'DELETE', '/places/memory/x', { device: 'a'.repeat(32) })).status).toBe(404);
    expect((await call(app, 'GET', '/places/memory', { device: 'a'.repeat(32) })).body.memories).toEqual([]);
  });
});

describe('일정 장소 정하기에 기억이 쓰인다', () => {
  const ev = (over: Record<string, unknown> = {}) => ({
    id: 'e1', calendarId: 'cal-1', title: '약속', start: '2026-11-11T14:00:00+09:00', end: '2026-11-11T15:00:00+09:00',
    allDay: false, locationText: '스타벅스 상무점', notes: null, attendees: [], ...over,
  });
  type Row = { id: string; place: { name: string; lat: number; lng: number } | null; locationText: string | null; suggestion?: unknown; placeMemory?: { ambiguous: boolean } };
  const setup = async (events: unknown[]) => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await call(app, 'PUT', '/events', { token: a.phoneToken, body: { events } });
    const rows = async (path: 'today' | 'places') => ((await call(app, 'GET', `/schedules/${path}`, { token: a.phoneToken })).body.schedules as Row[]);
    return { app, car, a, rows };
  };

  it('기억이 없으면 장소가 비어 있고(오늘 응답에는 장소 없음) 기억하면 좌표가 확정된다', async () => {
    const { app, car, a, rows } = await setup([ev()]);
    expect((await rows('places'))[0]).toMatchObject({ place: null, suggestion: null });
    expect((await rows('places'))[0]).not.toHaveProperty('placeMemory');
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', { name: '스타벅스 상무점', lat: 35.15, lng: 126.85 }));
    for (const path of ['today', 'places'] as const) {
      expect((await rows(path))[0]).toMatchObject({ place: { name: '스타벅스 상무점', lat: 35.15, lng: 126.85 }, placeMemory: { ambiguous: false } });
    }
    expect(((await rows('places'))[0] as Row).suggestion).toBeNull();
  });

  it('애매하게 기억한 이름은 placeMemory.ambiguous: true로 표시한다(차가 매번 확인)', async () => {
    const { app, car, a, rows } = await setup([ev()]);
    await carPut(app, car, a.seatId, memoryBody(' 스타벅스   상무점 ', HOME, true));
    expect((await rows('today'))[0]).toMatchObject({ place: { name: '샘플 아파트' }, placeMemory: { ambiguous: true } });
  });

  it('장소 칸이 비어 있으면 일정 제목이 기억의 이름 키다', async () => {
    const { app, car, a, rows } = await setup([ev({ locationText: null, title: '친구 만남' })]);
    expect((await rows('places'))[0]).toMatchObject({ place: null });
    await carPut(app, car, a.seatId, memoryBody('친구 만남', GYM));
    expect((await rows('places'))[0]).toMatchObject({ place: { name: '체육관' }, placeMemory: { ambiguous: false } });
    // 장소 칸이 있으면 제목 기억은 쓰지 않는다
    const withText = await setup([ev({ title: '친구 만남' })]);
    await carPut(withText.app, withText.car, withText.a.seatId, memoryBody('친구 만남', GYM));
    expect((await withText.rows('places'))[0]).toMatchObject({ place: null });
  });

  it('보정(장소 넣기)이 기억보다 앞이고, 이동 없음이면 기억을 쓰지 않으며, 목 장소 완전 일치가 기억보다 앞이다', async () => {
    const { app, car, a, rows } = await setup([ev(), ev({ id: 'e2', locationText: '광주 육전집' })]);
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME));
    await carPut(app, car, a.seatId, memoryBody('광주 육전집', HOME));
    const exact = (await rows('places')).find((r) => r.id === 'e2');
    expect(exact).toMatchObject({ place: { name: '광주 육전집' } });
    expect(exact).not.toHaveProperty('placeMemory');
    const put = (body: unknown) => call(app, 'PUT', '/schedules/e1/place', { token: a.phoneToken, body });
    await put({ placeId: catalog.places[1]?.id });
    const fixed = (await rows('places')).find((r) => r.id === 'e1');
    expect(fixed?.place?.name).toBe(catalog.places[1]?.name);
    expect(fixed).not.toHaveProperty('placeMemory');
    await put({ noTravel: true });
    expect((await rows('today')).map((r) => r.id)).toEqual(['e2']);
    await put({ placeId: null }); // 보정을 지우면 기억으로 돌아간다
    expect((await rows('places')).find((r) => r.id === 'e1')).toMatchObject({ place: { name: '샘플 아파트' }, placeMemory: { ambiguous: false } });
  });

  it('기억을 지우면 장소가 다시 비고, 다른 자리의 같은 이름 일정에는 영향이 없다', async () => {
    const { app, car, a, rows } = await setup([ev()]);
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME));
    const b = await connect(app, car, 'B');
    await call(app, 'PUT', '/events', { token: b.phoneToken, body: { events: [ev()] } });
    expect(((await call(app, 'GET', '/schedules/places', { token: b.phoneToken })).body.schedules as Row[])[0]?.place).toBeNull();
    await call(app, 'DELETE', `/places/memory/${encodeURIComponent('스타벅스 상무점')}`, { token: a.phoneToken });
    expect((await rows('places'))[0]?.place).toBeNull();
  });

  it('차 토큰 + driver로 읽는 오늘 일정에도 같은 기억이 반영된다', async () => {
    const { app, car, a } = await setup([ev()]);
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME, true));
    const today = (await call(app, 'GET', `/schedules/today?driver=${a.seatId}`, { token: car.carToken })).body.schedules as Row[];
    expect(today[0]).toMatchObject({ place: { name: '샘플 아파트', lat: 35.1743 }, placeMemory: { ambiguous: true } });
  });
});

describe('픽스처·데모 경로(기본 자리) 회귀', () => {
  const at = '?at=2026-11-06T00%3A20%3A00Z';
  type Row = { id: string; place: unknown; suggestion?: { placeId: string; name: string } | null; placeMemory?: unknown };
  const rows = async (app: App, path = 'places') => ((await call(app, 'GET', `/schedules/${path}${at}`)).body.schedules as Row[]);

  it('기억을 쓰지 않으면 응답이 그대로다: 치과는 remembered.json 시드로 suggestion만, placeMemory 필드 없음', async () => {
    const app = makeApp();
    const today = await rows(app, 'today');
    const all = await rows(app);
    expect(all.find((r) => r.id === 'gwangju-dentist')).toMatchObject({ place: null, suggestion: { placeId: 'mock-dentist', name: '예시치과의원' } });
    for (const r of [...today, ...all]) expect(r).not.toHaveProperty('placeMemory');
  });

  it('차가 기억을 쓰면 시드보다 앞서 확정하고, 지우면 시드 suggestion으로 돌아간다. 픽스처 일정의 기존 좌표는 바뀌지 않는다', async () => {
    const app = makeApp();
    const before = await rows(app);
    await call(app, 'PUT', '/places/memory', { body: memoryBody('치과', { name: '내 단골 치과', lat: 35.2, lng: 126.9 }, false) });
    await call(app, 'PUT', '/places/memory', { body: memoryBody('광주 육전집', HOME) }); // 좌표가 이미 있는 일정에는 쓰지 않는다
    const after = await rows(app);
    expect(after.find((r) => r.id === 'gwangju-dentist')).toMatchObject({ place: { name: '내 단골 치과' }, suggestion: null, placeMemory: { ambiguous: false } });
    expect(after.find((r) => r.id === 'gwangju-lunch')).toEqual(before.find((r) => r.id === 'gwangju-lunch'));
    await call(app, 'DELETE', `/places/memory/${encodeURIComponent('치과')}`);
    expect(await rows(app)).toEqual(before);
  });

  it('시드는 실제 자리에 새지 않는다(제목이 치과인 일정에도 suggestion 없음)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const events = [{ id: 'e1', calendarId: 'c', title: '치과', start: '2026-11-11T14:00:00+09:00', end: '2026-11-11T15:00:00+09:00', allDay: false, locationText: null, notes: null, attendees: [] }];
    await call(app, 'PUT', '/events', { token: a.phoneToken, body: { events } });
    const real = (await call(app, 'GET', '/schedules/places', { token: a.phoneToken })).body.schedules as Row[];
    expect(real[0]).toMatchObject({ place: null, suggestion: null });
  });
});
