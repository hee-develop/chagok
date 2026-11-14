import { describe, expect, it } from 'vitest';
import { MAX_BUCKET_MEMORIES, MAX_MEMORIES } from '../src/placeSearch/limits.js';
import { createSeatStore } from '../src/seats.js';
import { catalog, newApp } from './helpers.js';

/** 시계를 고정한다: 서울 2026-11-11 10:00. */
const NOW = '2026-11-11T10:00:00+09:00';
let clockMs = Date.parse(NOW);
const makeApp = (over: Parameters<typeof newApp>[0] = {}) => {
  clockMs = Date.parse(NOW);
  const now = () => new Date(clockMs);
  // 용량 테스트가 200번 넘게 저장하므로 저장 속도 제한은 기본으로 넉넉히 푼다(속도 제한 테스트는 따로 켠다).
  return newApp({ now, seats: createSeatStore(now), clientAddress: (c) => c.req.header('x-test-ip') ?? 'test', placeMemoryRateLimit: { max: 100_000 }, ...over });
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
const resolveBare = async (app: App, name: string) => (await call(app, 'POST', '/places/resolve', { body: { query: name } })).body as { via: string; memory: { ambiguous: boolean } | null };
const resolveVia = async (app: App, car: Car, seatId: string, name: string) =>
  (await call(app, 'POST', `/places/resolve?driver=${seatId}`, { token: car.carToken, body: { query: name } })).body as { via: string; memory: { ambiguous: boolean } | null };

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

describe('PUT /places/memory · 용량 예산(M8)', () => {
  it(`연결 전 버킷은 ${MAX_BUCKET_MEMORIES}개까지만 기억하고, 연결해 자리가 되면 ${MAX_MEMORIES}개까지 늘어난다`, async () => {
    const app = makeApp();
    const dev = 'd'.repeat(32);
    for (let i = 0; i < MAX_BUCKET_MEMORIES + 5; i++) expect((await call(app, 'PUT', '/places/memory', { device: dev, body: memoryBody(`장소 ${i}`) })).status).toBe(200);
    const kept = (await call(app, 'GET', '/places/memory', { device: dev })).body.memories as { name: string }[];
    expect(kept).toHaveLength(MAX_BUCKET_MEMORIES);
    expect(kept.map((m) => m.name)).not.toContain('장소 0');
    const car = await registerCar(app);
    const a = await connect(app, car, 'A', { device: dev });
    expect(await names(app, a.phoneToken)).toHaveLength(MAX_BUCKET_MEMORIES);
    for (let i = 0; i < MAX_MEMORIES; i++) await carPut(app, car, a.seatId, memoryBody(`자리 장소 ${i}`));
    expect(await names(app, a.phoneToken)).toHaveLength(MAX_MEMORIES);
  });

  it('PUT /places/memory는 요청 주소별 속도 제한이 있고 넘으면 429 rate-limited이며 저장하지 않는다(주소가 다르면 따로 센다)', async () => {
    const app = makeApp({ placeMemoryRateLimit: { max: 3, windowMs: 60_000 } });
    const ip = (n: string) => ({ 'x-test-ip': n });
    const put = (n: string, name: string) =>
      app.request('/places/memory', { method: 'PUT', headers: { 'content-type': 'application/json', ...ip(n) }, body: JSON.stringify(memoryBody(name)) });
    for (let i = 0; i < 3; i++) expect((await put('1.1.1.1', `장소 ${i}`)).status).toBe(200);
    const blocked = await put('1.1.1.1', '넷째');
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { reason: string }).reason).toBe('rate-limited');
    expect((await put('2.2.2.2', '다른 주소')).status).toBe(200);
    const list = (await (await app.request('/places/memory')).json()) as { memories: { name: string }[] };
    expect(list.memories.map((m) => m.name)).not.toContain('넷째');
    clockMs += 61_000;
    expect((await put('1.1.1.1', '다시')).status).toBe(200);
  });

  it('검증에서 떨어진 요청은 속도 제한을 쓰지 않는다', async () => {
    const app = makeApp({ placeMemoryRateLimit: { max: 1, windowMs: 60_000 } });
    for (let i = 0; i < 5; i++) expect((await call(app, 'PUT', '/places/memory', { body: { name: '' } })).status).toBe(400);
    expect((await call(app, 'PUT', '/places/memory', { body: memoryBody('집') })).status).toBe(200);
  });
});

describe('PUT /places/memory · 어느 자리에 쓰는가', () => {
  it('차 토큰만 있고 driver가 없으면 400 driver-required다(옛 차 앱 호환 규칙을 적용하지 않는다). 쓰기·읽기·resolve 모두', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    clockMs += 1000;
    const b = await connect(app, car, 'B');
    await call(app, 'PUT', '/drivers/selected', { token: car.carToken, body: { seatId: a.seatId } });
    const put = await call(app, 'PUT', '/places/memory', { token: car.carToken, body: memoryBody('집') });
    expect(put.status).toBe(400);
    expect(put.body.reason).toBe('driver-required');
    expect((await call(app, 'GET', '/places/memory', { token: car.carToken })).status).toBe(400);
    expect((await call(app, 'POST', '/places/resolve', { token: car.carToken, body: { query: '집' } })).status).toBe(400);
    expect(await names(app, a.phoneToken)).toEqual([]);
    expect(await names(app, b.phoneToken)).toEqual([]);
  });

  it('차가 자기 차의 자리가 아닌 driver를 쓰면 403이고, 자리 없는 차도 driver 없이는 400이다', async () => {
    const app = makeApp();
    const carA = await registerCar(app);
    const carB = await registerCar(app);
    const seatA = await connect(app, carA, 'A');
    expect((await carPut(app, carB, seatA.seatId, memoryBody('집'))).status).toBe(403);
    expect((await carPut(app, carA, 'nope', memoryBody('집'))).status).toBe(403);
    expect((await call(app, 'PUT', '/places/memory', { token: carB.carToken, body: memoryBody('집') })).status).toBe(400);
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

  it('식별이 없는 요청은 서버에 자리 있는 차가 하나도 없을 때만 기본 자리(데모·픽스처 경로)에 쓰고 읽는다', async () => {
    const app = makeApp();
    expect((await call(app, 'PUT', '/places/memory', { body: memoryBody('집') })).status).toBe(200);
    expect((await call(app, 'GET', '/places/memory')).body.memories.map((m: { name: string }) => m.name)).toEqual(['집']);
    expect((await resolveBare(app, '집')).via).toBe('memory');
  });

  it('자리 있는 차가 생기면 식별 없는 요청은 실제 자리의 기억을 읽지도 쓰지도 못한다(저장하지 않는 빈 범위)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await carPut(app, car, a.seatId, memoryBody('우리집', HOME));
    // 자리가 하나뿐이어도(옛 호환이었다면 그 자리를 읽었을 상황) 식별 없는 읽기는 비어 있다.
    expect((await call(app, 'GET', '/places/memory')).body.memories).toEqual([]);
    expect((await resolveBare(app, '우리집')).via).toBe('search');
    expect((await resolveBare(app, '우리집')).memory).toBeNull();
    const w = await call(app, 'PUT', '/places/memory', { body: memoryBody('회사', GYM) });
    expect(w.status).toBe(429);
    expect(w.body.reason).toBe('unwritable');
    expect((await call(app, 'DELETE', `/places/memory?name=${encodeURIComponent('우리집')}`)).status).toBe(404);
    expect(await names(app, a.phoneToken)).toEqual(['우리집']);
    // 자리가 둘이어도 마찬가지다.
    await connect(app, car, 'B');
    expect((await call(app, 'GET', '/places/memory')).body.memories).toEqual([]);
    expect((await call(app, 'PUT', '/places/memory', { body: memoryBody('헬스장', GYM) })).status).toBe(429);
    expect(await names(app, a.phoneToken)).toEqual(['우리집']);
  });

  it('기본 자리에 쌓은 기억은 자리 있는 차가 생겨도 실제 자리에 새지 않는다', async () => {
    const app = makeApp();
    await call(app, 'PUT', '/places/memory', { body: memoryBody('데모집', HOME) });
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    expect(await names(app, a.phoneToken)).toEqual([]);
    expect((await resolveVia(app, car, a.seatId, '데모집')).via).toBe('search');
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
  const del = (app: App, name: string, token?: string, device?: string) =>
    call(app, 'DELETE', `/places/memory?name=${encodeURIComponent(name)}`, { token, device });

  it('이름을 쿼리 name으로 보내 지울 수 있다(공백·대소문자·/·#·?·% 포함), 없으면 404, 다른 자리 기억은 못 지운다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점'));
    for (const odd of ['헬스장/수영장', 'A동#2', '카페?', '50% 할인점']) await carPut(app, car, a.seatId, memoryBody(odd));
    await carPut(app, car, b.seatId, memoryBody('스타벅스 상무점'));
    expect((await del(app, '  스타벅스   상무점', a.phoneToken)).status).toBe(200);
    expect((await names(app, a.phoneToken)).sort()).toEqual(['50% 할인점', 'A동#2', '카페?', '헬스장/수영장'].sort());
    expect(await names(app, b.phoneToken)).toEqual(['스타벅스 상무점']);
    expect((await del(app, '스타벅스 상무점', a.phoneToken)).status).toBe(404);
    for (const odd of ['헬스장/수영장', 'A동#2', '카페?', '50% 할인점']) expect((await del(app, odd, a.phoneToken)).status).toBe(200);
    expect(await names(app, a.phoneToken)).toEqual([]);
  });

  it('name이 없거나 비어 있거나 너무 길면 400이다', async () => {
    const app = makeApp();
    expect((await call(app, 'DELETE', '/places/memory')).status).toBe(400);
    expect((await del(app, '   ')).status).toBe(400);
    expect((await del(app, 'x'.repeat(301))).status).toBe(400);
  });

  it('지운 이름은 resolve에서 다시 검색으로 간다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await carPut(app, car, a.seatId, memoryBody('육전'));
    expect((await resolveVia(app, car, a.seatId, '육전')).via).toBe('memory');
    await del(app, '육전', a.phoneToken);
    expect((await resolveVia(app, car, a.seatId, '육전')).via).toBe('search');
  });

  it('토큰이 틀리면 401, 식별 없는 지우기는 기본 자리만 다루며, 연결 전 기기의 지우기는 버킷을 만들지 않는다', async () => {
    const app = makeApp();
    expect((await del(app, 'x', 'f'.repeat(64))).status).toBe(401);
    expect((await del(app, 'x', undefined, 'a'.repeat(32))).status).toBe(404);
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

  it('애매하게 기억한 이름은 확정하지 않고 suggestion(source: memory, ambiguous: true)으로만 내린다(차가 "지난번처럼 …?"로 확인)', async () => {
    const { app, car, a, rows } = await setup([ev()]);
    await carPut(app, car, a.seatId, memoryBody(' 스타벅스   상무점 ', HOME, true));
    const expected = { placeId: null, name: '샘플 아파트', source: 'memory', ambiguous: true, place: { name: '샘플 아파트', address: '광주 북구 샘플로 12', lat: 35.1743, lng: 126.9121 } };
    for (const path of ['today', 'places'] as const) {
      const row = (await rows(path))[0] as Row;
      expect(row.place).toBeNull();
      expect(row).not.toHaveProperty('placeMemory');
      expect(row.suggestion).toEqual(expected);
    }
    // 애매하지 않게 다시 기억하면(고른 곳이 확실해지면) 확정한다.
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME, false));
    expect((await rows('today'))[0]).toMatchObject({ place: { name: '샘플 아파트' }, placeMemory: { ambiguous: false } });
    expect((await rows('today'))[0]).not.toHaveProperty('suggestion');
  });

  it('애매한 기억은 보정이 있으면 쓰지 않고, 이동 없음이면 오늘 응답에서 빠진다', async () => {
    const { app, car, a, rows } = await setup([ev()]);
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME, true));
    expect(((await rows('places'))[0] as Row).suggestion).toMatchObject({ source: 'memory' });
    await call(app, 'PUT', '/schedules/e1/place', { token: a.phoneToken, body: { placeId: catalog.places[1]?.id } });
    expect(((await rows('places'))[0] as Row).suggestion).toBeNull();
    expect((await rows('today'))[0]).not.toHaveProperty('suggestion');
    await call(app, 'PUT', '/schedules/e1/place', { token: a.phoneToken, body: { noTravel: true } });
    expect(await rows('today')).toEqual([]);
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

  it('보정(장소 넣기)이 기억보다 앞이고, 이동 없음이면 기억을 쓰지 않으며, 보정을 지우면 기억으로 돌아간다', async () => {
    const { app, car, a, rows } = await setup([ev(), ev({ id: 'e2', locationText: '광주 육전집' })]);
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME));
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

  it('실제 자리에서는 목 장소 이름이 완전히 같아도 좌표를 확정하지 않고(목 데이터 없음) 기억만 확정한다', async () => {
    const { app, car, a, rows } = await setup([ev({ id: 'e2', locationText: '광주 육전집', title: '점심' })]);
    expect((await rows('places'))[0]).toMatchObject({ place: null, suggestion: null });
    expect((await rows('today'))[0]).toMatchObject({ place: null });
    await carPut(app, car, a.seatId, memoryBody('광주 육전집', GYM));
    expect((await rows('places'))[0]).toMatchObject({ place: { name: '체육관' }, placeMemory: { ambiguous: false } });
  });

  it('연결 전 버킷도 실제 자리라서 목 장소 완전 일치를 쓰지 않는다(FIXTURE_SEATS=1이면 쓴다)', async () => {
    const dev = 'd'.repeat(32);
    const lunch = [ev({ id: 'e2', locationText: '광주 육전집', title: '점심' })];
    for (const fixtureSeats of [false, true]) {
      const app = makeApp({ fixtureSeats });
      await call(app, 'PUT', '/events', { device: dev, body: { events: lunch } });
      const row = ((await call(app, 'GET', '/schedules/places', { device: dev })).body.schedules as Row[])[0];
      if (fixtureSeats) expect(row?.place).toMatchObject({ name: '광주 육전집' });
      else expect(row?.place).toBeNull();
    }
  });

  it('기본 자리(데모)에서는 기억이 목 장소 완전 일치보다 앞이다', async () => {
    const app = makeApp();
    const lunch = ev({ id: 'e2', locationText: '광주 육전집', title: '점심' });
    await call(app, 'PUT', '/events', { body: { events: [lunch] } });
    const read = async () => ((await call(app, 'GET', '/schedules/places')).body.schedules as Row[])[0] as Row;
    expect(await read()).toMatchObject({ place: { name: '광주 육전집' } });
    expect(await read()).not.toHaveProperty('placeMemory');
    await call(app, 'PUT', '/places/memory', { body: memoryBody('광주 육전집', GYM) });
    expect(await read()).toMatchObject({ place: { name: '체육관' }, placeMemory: { ambiguous: false } });
    await call(app, 'DELETE', `/places/memory?name=${encodeURIComponent('광주 육전집')}`);
    expect(await read()).toMatchObject({ place: { name: '광주 육전집' } });
  });

  it('기억을 지우면 장소가 다시 비고, 다른 자리의 같은 이름 일정에는 영향이 없다', async () => {
    const { app, car, a, rows } = await setup([ev()]);
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME));
    const b = await connect(app, car, 'B');
    await call(app, 'PUT', '/events', { token: b.phoneToken, body: { events: [ev()] } });
    expect(((await call(app, 'GET', '/schedules/places', { token: b.phoneToken })).body.schedules as Row[])[0]?.place).toBeNull();
    await call(app, 'DELETE', `/places/memory?name=${encodeURIComponent('스타벅스 상무점')}`, { token: a.phoneToken });
    expect((await rows('places'))[0]?.place).toBeNull();
  });

  it('차 토큰 + driver로 읽는 오늘 일정에도 같은 기억이 반영된다', async () => {
    const { app, car, a } = await setup([ev()]);
    await carPut(app, car, a.seatId, memoryBody('스타벅스 상무점', HOME, false));
    const today = (await call(app, 'GET', `/schedules/today?driver=${a.seatId}`, { token: car.carToken })).body.schedules as Row[];
    expect(today[0]).toMatchObject({ place: { name: '샘플 아파트', lat: 35.1743 }, placeMemory: { ambiguous: false } });
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
    await call(app, 'DELETE', `/places/memory?name=${encodeURIComponent('치과')}`);
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
