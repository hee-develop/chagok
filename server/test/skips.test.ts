import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayEventName, normalizeEventName } from '../src/eventName.js';
import { MAX_BUCKET_SKIPS, MAX_SKIPS, MAX_SKIP_CHANGES } from '../src/limits.js';
import { createSkipsStore } from '../src/routes/skips.js';
import { createSeatStore } from '../src/seats.js';
import { catalog, newApp } from './helpers.js';

// 정책서 10.3 4번·10.8·10.9·11장: 자리별 '이동 없음' 일정 이름 기억(GET·PUT /skips)과 서버 안전망.

const NOW = '2026-11-11T10:00:00+09:00';
let clockMs = Date.parse(NOW);
const makeApp = (over: Parameters<typeof newApp>[0] = {}) => {
  clockMs = Date.parse(NOW);
  const now = () => new Date(clockMs);
  return newApp({ now, seats: createSeatStore(now), clientAddress: (c) => c.req.header('x-test-ip') ?? 'test', ...over });
};
type App = ReturnType<typeof makeApp>;

type Opts = { token?: string; body?: unknown; raw?: string; ip?: string; device?: string };
const call = async (app: App, method: string, path: string, { token, body, raw, ip, device }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (ip) headers['x-test-ip'] = ip;
  if (device) headers['x-chagok-device'] = device;
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = { error: text }; // JSON이 깨진 본문은 hono가 글자 오류를 돌려준다
  }
  return { status: res.status, body: parsed };
};

const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);

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
const registerCar = async (app: App): Promise<Car> => {
  const res = await call(app, 'POST', '/pair/code', { body: {} });
  expect(res.status).toBe(200);
  return { carId: res.body.carId, carToken: res.body.carToken };
};
const connect = async (app: App, car: Car, name: string, o: { device?: string } = {}) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device: o.device });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; phoneToken: string };
};
const replaceSeat = async (app: App, car: Car, seatId: string, name: string, device?: string) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId } });
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; phoneToken: string };
};

const names = (res: { body: any }) => (res.body.skips as { name: string }[]).map((s) => s.name);
const put = (app: App, o: Opts, query = '') => call(app, 'PUT', `/skips${query}`, o);
const get = (app: App, o: Opts = {}, query = '') => call(app, 'GET', `/skips${query}`, o);

describe('일정 이름 정규화(폰과 공용)', () => {
  it('앞뒤 공백 제거·연속 공백 하나·대소문자 무시', () => {
    expect(normalizeEventName('  KIA   직관 ')).toBe('kia 직관');
    expect(displayEventName('  KIA\t 직관 ')).toBe('KIA 직관');
    expect(normalizeEventName('Zoom 미팅')).toBe(normalizeEventName('zoom  미팅'));
  });

  it.each([
    ['NFD로 쓴 한글은 NFC와 같은 이름', '\u1112\u1161\u11ab', '한'],
    ['제로폭 공백·단어 결합 금지·소프트 하이픈은 없는 글자', '팀\u200b 회\u2060의\u00ad', '팀 회의'],
    ['제어 문자는 지우고 줄바꿈·탭은 공백', 'a\u0000b\u0007c\nd\te', 'abc d e'],
    ['NBSP·BOM·전각 공백도 공백', '팀\u00a0회의\ufeff점심\u3000끝', '팀 회의 점심 끝'],
    ['이모지는 그대로(ZWJ 이모지도 깨지지 않음)', '⚽ 축구 👨\u200d👩\u200d👧', '⚽ 축구 👨\u200d👩\u200d👧'],
    ['보이지 않는 글자뿐이면 빈 이름', '\u200b\u2060\u0000', ''],
  ])('보이는 이름: %s', (_label, input, expected) => {
    expect(displayEventName(input)).toBe(expected);
  });

  it('같은 이름 판정은 NFC·보이지 않는 글자·대소문자·공백을 모두 무시한다', () => {
    expect(normalizeEventName('KIA\u200b 직관')).toBe(normalizeEventName(' kia  직관'));
    expect(normalizeEventName('\u1112\u1161\u11ab 점심')).toBe(normalizeEventName('한 점심'));
  });

  it('폰이 소스 그대로 읽는 파일이라 다른 모듈을 가져오지 않는다', () => {
    const source = readFileSync(new URL('../src/eventName.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

describe('SkipsStore', () => {
  const store = () => createSkipsStore(() => new Date(clockMs));

  it('최근에 더한 이름부터 보이고, 같은 이름(공백·대소문자 무시)은 한 번만 두며 처음 글자를 유지한다', () => {
    const s = store();
    s.apply({ add: ['KIA 직관'], remove: [] });
    clockMs += 1000;
    s.apply({ add: ['  육전집   점심 ', 'kia  직관', '육전집 점심'], remove: [] });
    expect(s.list().map((e) => e.name)).toEqual(['육전집 점심', 'KIA 직관']);
    expect(s.list().map((e) => e.addedAt)).toEqual(['2026-11-11T01:00:01.000Z', '2026-11-11T01:00:00.000Z']);
    expect(s.has('KIA  직관')).toBe(true);
    expect(s.has('kia 직관 2')).toBe(false);
  });

  it('없는 이름을 빼도 오류가 아니고, 이미 있는 이름을 더해도 시각이 바뀌지 않는다', () => {
    const s = store();
    s.apply({ add: ['치과'], remove: [] });
    const before = s.list();
    clockMs += 5000;
    expect(s.apply({ add: ['치과'], remove: ['없는 이름'] })).toEqual({ ok: true, skips: before });
    expect(s.apply({ add: [], remove: [' 치과 '] })).toEqual({ ok: true, skips: [] });
  });
});

describe('GET·PUT /skips', () => {
  it('폰이 이름을 더하고 빼면 바뀐 전체 목록을 돌려주고, GET이 같은 목록을 준다', async () => {
    const app = makeApp();
    const added = await put(app, { body: { add: ['KIA 직관', '치과'] } });
    expect(added.status).toBe(200);
    expect(names(added)).toEqual(['치과', 'KIA 직관']); // 최근에 더한 것부터(같은 요청 안에서는 뒤에 적은 것이 최근)
    expect(added.body.skips[1]).toEqual({ name: 'KIA 직관', addedAt: '2026-11-11T01:00:00.000Z' });
    const removed = await put(app, { body: { remove: ['kia  직관'] } });
    expect(names(removed)).toEqual(['치과']);
    expect(names(await get(app))).toEqual(['치과']);
    // 더하기와 빼기를 한 번에, 같은 요청을 다시 보내도 같다.
    for (let i = 0; i < 2; i++) expect(names(await put(app, { body: { add: ['콩물 픽업'], remove: ['치과'] } }))).toEqual(['콩물 픽업']);
  });

  it.each([
    ['본문이 객체가 아님', { raw: '[]' }],
    ['JSON이 아님', { raw: '{' }],
    ['빈 객체', { body: {} }],
    ['빈 배열만', { body: { add: [], remove: [] } }],
    ['모르는 키', { body: { add: ['a'], extra: 1 } }],
    ['add가 배열이 아님', { body: { add: '치과' } }],
    ['remove가 배열이 아님', { body: { remove: { 0: 'a' } } }],
    ['문자열이 아닌 이름', { body: { add: [1] } }],
    ['null 이름', { body: { add: [null] } }],
    ['공백뿐인 이름', { body: { add: ['   '] } }],
    ['200자를 넘는 이름', { body: { add: ['가'.repeat(201)] } }],
    ['한 번에 너무 많은 이름', { body: { add: Array.from({ length: MAX_SKIP_CHANGES + 1 }, (_, i) => `n${i}`) } }],
    ['add와 remove 합계가 너무 많음', { body: { add: Array.from({ length: MAX_SKIP_CHANGES }, (_, i) => `n${i}`), remove: ['x'] } }],
    ['같은 이름을 add와 remove에 함께', { body: { add: ['KIA 직관'], remove: ['kia  직관'] } }],
  ] as [string, Opts][])('잘못된 요청(%s)은 400이고 아무것도 바꾸지 않는다', async (_label, opts) => {
    const app = makeApp();
    await put(app, { body: { add: ['기존'] } });
    const res = await put(app, opts);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(names(await get(app))).toEqual(['기존']);
  });

  it('200자 이름은 받고, 너무 큰 본문은 413이다', async () => {
    const app = makeApp();
    expect((await put(app, { body: { add: ['가'.repeat(200)] } })).status).toBe(200);
    expect((await put(app, { raw: JSON.stringify({ add: ['x'.repeat(70 * 1024)] }) })).status).toBe(413);
  });

  it(`자리 하나에 ${MAX_SKIPS}개까지만 두고, 넘으면 409 full이며 아무것도 바꾸지 않는다`, async () => {
    const app = makeApp();
    for (let i = 0; i < MAX_SKIPS / MAX_SKIP_CHANGES; i++) {
      const res = await put(app, { body: { add: Array.from({ length: MAX_SKIP_CHANGES }, (_, j) => `일정 ${i * MAX_SKIP_CHANGES + j}`) } });
      expect(res.status).toBe(200);
    }
    expect((await get(app)).body.skips).toHaveLength(MAX_SKIPS);
    const full = await put(app, { body: { add: ['새 일정', '일정 3'] } });
    expect(full.status).toBe(409);
    expect(full.body.reason).toBe('full');
    expect(names(await get(app))).not.toContain('새 일정');
    // 이미 있는 이름을 더하는 것은 새 이름이 아니라 받고, 빼면서 더하면 자리가 난다.
    expect((await put(app, { body: { add: ['일정 3'] } })).status).toBe(200);
    expect(names(await put(app, { body: { add: ['새 일정'], remove: ['일정 0'] } }))).toContain('새 일정');
    expect((await get(app)).body.skips).toHaveLength(MAX_SKIPS);
  });
});

describe('자리별 기억 (J1 자리 규칙)', () => {
  it('두 자리의 기억은 서로 보이지 않는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await put(app, { token: a.phoneToken, body: { add: ['A만 아는 일정'] } });
    await put(app, { token: b.phoneToken, body: { add: ['B만 아는 일정'] } });
    expect(names(await get(app, { token: a.phoneToken }))).toEqual(['A만 아는 일정']);
    expect(names(await get(app, { token: b.phoneToken }))).toEqual(['B만 아는 일정']);
    expect(names(await get(app, { token: car.carToken }, `?driver=${a.seatId}`))).toEqual(['A만 아는 일정']);
  });

  it('연결 전 폰은 기기 id 버킷에 쌓이고 서로 보이지 않으며, 연결하면 그 폰의 기억만 새 자리로 간다', async () => {
    const app = makeApp();
    await put(app, { device: DEV_A, body: { add: ['A 폰의 일정'] } });
    await put(app, { device: DEV_B, body: { add: ['B 폰의 일정'] } });
    expect(names(await get(app, { device: DEV_A }))).toEqual(['A 폰의 일정']);
    expect(names(await get(app, { device: DEV_B }))).toEqual(['B 폰의 일정']);
    expect(names(await get(app))).toEqual([]); // 식별 없는 기본 자리는 둘 다 못 본다
    const car = await registerCar(app);
    const a = await connect(app, car, 'A', { device: DEV_A });
    expect(names(await get(app, { token: a.phoneToken }))).toEqual(['A 폰의 일정']);
    expect(names(await get(app, { device: DEV_B }))).toEqual(['B 폰의 일정']);
  });

  it('읽기는 버킷을 만들지 않는다(없는 기기는 빈 목록)', async () => {
    const app = makeApp({ capacity: { maxBuckets: 1 } });
    expect(names(await get(app, { device: DEV_A }))).toEqual([]);
    expect((await put(app, { device: DEV_B, body: { add: ['x'] } })).status).toBe(200);
    expect(names(await get(app, { device: DEV_B }))).toEqual(['x']);
  });

  it('연결을 끊으면 그 자리의 기억이 지워지고(다른 자리는 그대로), 같은 폰이 다시 연결해도 비어 있다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await put(app, { token: a.phoneToken, body: { add: ['치과'] } });
    await put(app, { token: b.phoneToken, body: { add: ['치과'] } });
    expect((await call(app, 'DELETE', '/pair', { token: a.phoneToken })).status).toBe(200);
    expect((await get(app, { token: a.phoneToken })).status).toBe(401);
    expect(names(await get(app, { token: b.phoneToken }))).toEqual(['치과']);
    const again = await connect(app, car, 'A');
    expect(names(await get(app, { token: again.phoneToken }))).toEqual([]);
  });

  it('차곡 초기화(DELETE /car)도 모든 자리의 기억을 지운다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { add: ['치과'] } });
    expect((await call(app, 'DELETE', '/car', { token: car.carToken })).status).toBe(200);
    const again = await connect(app, car, 'A');
    expect(names(await get(app, { token: again.phoneToken }))).toEqual([]);
  });

  it('폰을 바꿔도(같은 자리를 이어받기) 기억이 남는다. 옛 폰의 토큰은 쓸 수 없다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { add: ['치과', 'KIA 직관'] } });
    const replaced = await replaceSeat(app, car, a.seatId, '새 폰');
    expect(replaced.seatId).toBe(a.seatId);
    expect(names(await get(app, { token: replaced.phoneToken }))).toEqual(['KIA 직관', '치과']);
    expect((await get(app, { token: a.phoneToken })).status).toBe(401);
    // 새 폰의 연결 전 버킷에 쌓인 기억은 자리의 기억에 합친다(없는 이름만).
    await put(app, { device: DEV_B, body: { add: ['새 폰 버킷의 일정', '치과'] } });
    const second = await replaceSeat(app, car, a.seatId, '또 새 폰', DEV_B);
    expect(names(await get(app, { token: second.phoneToken }))).toEqual(['새 폰 버킷의 일정', 'KIA 직관', '치과']);
    // 합친 버킷은 비워진다(같은 기기 id로 다시 읽어도 자리와 무관한 빈 버킷).
    expect(names(await get(app, { device: DEV_B }))).toEqual([]);
  });

  it('폰 바꾸기 때 버킷의 기억을 합칠 때 상한(자리 상한) 안에서만 더하고, 자리에 이미 있는 이름이 먼저다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    for (let i = 0; i < MAX_SKIPS / MAX_SKIP_CHANGES; i++) {
      await put(app, { token: a.phoneToken, body: { add: Array.from({ length: MAX_SKIP_CHANGES }, (_, j) => `자리 ${i * MAX_SKIP_CHANGES + j}`) } });
    }
    await put(app, { token: a.phoneToken, body: { remove: ['자리 0', '자리 1'] } });
    await put(app, { device: DEV_B, body: { add: ['버킷 1', '버킷 2', '버킷 3'] } });
    const replaced = await replaceSeat(app, car, a.seatId, '새 폰', DEV_B);
    const merged = names(await get(app, { token: replaced.phoneToken }));
    expect(merged).toHaveLength(MAX_SKIPS);
    expect(merged.filter((n) => n.startsWith('버킷'))).toHaveLength(2); // 빈 자리 2개만큼만
    expect(merged).toContain('자리 499');
  });

  it('처음 연결할 때 버킷을 이어받으면 자리 상한(500)으로 늘어난다', async () => {
    const app = makeApp();
    await put(app, { device: DEV_A, body: { add: ['A 폰의 일정'] } });
    const car = await registerCar(app);
    const a = await connect(app, car, 'A', { device: DEV_A });
    for (let i = 0; i < MAX_SKIPS / MAX_SKIP_CHANGES; i++) {
      const res = await put(app, { token: a.phoneToken, body: { add: Array.from({ length: MAX_SKIP_CHANGES }, (_, j) => `연결 후 ${i * MAX_SKIP_CHANGES + j}`) } });
      expect(res.status).toBe(i === MAX_SKIPS / MAX_SKIP_CHANGES - 1 ? 409 : 200);
    }
  });
});

describe('차가 부를 때: 차 토큰 + driver', () => {
  it('차 토큰과 driver로 그 자리의 이름을 더하고 뺀다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    const added = await put(app, { token: car.carToken, body: { add: ['KIA 직관'] } }, `?driver=${a.seatId}`);
    expect(added.status).toBe(200);
    expect(names(added)).toEqual(['KIA 직관']);
    expect(names(await get(app, { token: a.phoneToken }))).toEqual(['KIA 직관']); // 폰도 같은 목록을 본다
    expect(names(await get(app, { token: b.phoneToken }))).toEqual([]);
    expect(names(await put(app, { token: car.carToken, body: { remove: ['kia 직관'] } }, `?driver=${a.seatId}`))).toEqual([]);
  });

  it('driver 없이 차 토큰만으로는 쓸 수 없고(400 driver-required), 식별 없이 driver만 주거나 남의 자리·없는 자리를 고르면 거절한다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const other = await registerCar(app);
    const otherSeat = await connect(app, other, 'O');
    const noDriver = await put(app, { token: car.carToken, body: { add: ['x'] } });
    expect([noDriver.status, noDriver.body.reason]).toEqual([400, 'driver-required']);
    expect((await put(app, { body: { add: ['x'] } }, `?driver=${a.seatId}`)).status).toBe(429); // 식별 없음: 저장하지 않는 빈 범위
    expect((await put(app, { token: car.carToken, body: { add: ['x'] } }, `?driver=${otherSeat.seatId}`)).status).toBe(403);
    expect((await put(app, { token: car.carToken, body: { add: ['x'] } }, '?driver=no-such-seat')).status).toBe(403);
    expect((await put(app, { token: car.carToken, body: { add: ['x'] } }, '?driver=')).status).toBe(403);
    expect((await put(app, { token: 'f'.repeat(64), body: { add: ['x'] } }, `?driver=${a.seatId}`)).status).toBe(401);
    // 폰 토큰은 늘 자기 자리에만 쓴다(driver는 폰 토큰에는 쓰이지 않는다: 다른 자리 driver를 줘도 남의 자리에 쓰지 않는다).
    expect((await put(app, { token: a.phoneToken, body: { add: ['x'] } }, `?driver=${otherSeat.seatId}`)).status).toBe(200);
    expect(names(await get(app, { token: a.phoneToken }))).toEqual(['x']);
    expect(names(await get(app, { token: otherSeat.phoneToken }))).toEqual([]);
  });

  it('검증을 통과한 요청만 쓰고, 잘못된 본문은 차에서도 400이다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    expect((await put(app, { token: car.carToken, body: { add: [''] } }, `?driver=${a.seatId}`)).status).toBe(400);
    expect(names(await get(app, { token: a.phoneToken }))).toEqual([]);
  });
});

describe('서버 안전망: 기억한 이름의 일정은 이동 없음', () => {
  type Row = { id: string; noTravel: boolean; noTravelReason: string | null; place: unknown };
  const at = '?at=2026-11-06T00%3A20%3A00Z';
  const fixtureToday = async (app: App) => ((await call(app, 'GET', `/schedules/today${at}`)).body.schedules as { id: string }[]).map((s) => s.id);
  const fixturePlaces = async (app: App) => (await call(app, 'GET', `/schedules/places${at}`)).body.schedules as Row[];

  it('같은 이름 일정이 차량 응답에서 빠지고 /schedules/places에는 이유 skipped로 남는다(공백·대소문자 무시)', async () => {
    const app = makeApp();
    expect(await fixtureToday(app)).toContain('gwangju-kia');
    await put(app, { body: { add: ['  kia   직관 '] } });
    const today = await fixtureToday(app);
    expect(today).not.toContain('gwangju-kia');
    expect(today).toContain('gwangju-lunch'); // 다른 일정은 그대로
    const rows = await fixturePlaces(app);
    expect(rows.find((r) => r.id === 'gwangju-kia')).toMatchObject({ noTravel: true, noTravelReason: 'skipped', place: null });
    expect(rows.find((r) => r.id === 'gwangju-lunch')).toMatchObject({ noTravel: false, noTravelReason: null });
  });

  it('기억을 지우면 다시 차로 간다', async () => {
    const app = makeApp();
    await put(app, { body: { add: ['KIA 직관'] } });
    await put(app, { body: { remove: ['KIA 직관'] } });
    expect(await fixtureToday(app)).toContain('gwangju-kia');
    expect((await fixturePlaces(app)).find((r) => r.id === 'gwangju-kia')).toMatchObject({ noTravel: false, noTravelReason: null });
  });

  it('종일 일정은 거르지 않는다(첫 탑승 인사에 이름을 쓴다)', async () => {
    const app = makeApp();
    await put(app, { body: { add: ['광주 직관'] } });
    expect(await fixtureToday(app)).toContain('gwangju-allday');
  });

  it('3단계 보정이 이긴다: 그 일정에 장소를 넣으면 차로 가고, 보정을 지우면 다시 기억을 따른다', async () => {
    const app = makeApp();
    await put(app, { body: { add: ['친구 약속'] } });
    expect(await fixtureToday(app)).not.toContain('gwangju-friend');
    const place = (await call(app, 'GET', '/places/search?q=육전')).body.places[0] as { id: string };
    expect((await call(app, 'PUT', '/schedules/gwangju-friend/place', { body: { placeId: place.id } })).status).toBe(200);
    expect(await fixtureToday(app)).toContain('gwangju-friend');
    await call(app, 'PUT', '/schedules/gwangju-friend/place', { body: { placeId: null } });
    expect(await fixtureToday(app)).not.toContain('gwangju-friend');
  });

  it('기억은 자리별이라 다른 자리의 차량 응답에는 영향이 없다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    for (const s of [a, b]) await call(app, 'PUT', '/events', { token: s.phoneToken, body: { events: [ev({ id: `${s.seatId}-1`, title: 'KIA 직관' })] } });
    await put(app, { token: car.carToken, body: { add: ['KIA 직관'] } }, `?driver=${a.seatId}`);
    const todayFor = async (s: { seatId: string }) =>
      ((await call(app, 'GET', `/schedules/today?driver=${s.seatId}`, { token: car.carToken })).body.schedules as { id: string }[]).map((r) => r.id);
    expect(await todayFor(a)).toEqual([]);
    expect(await todayFor(b)).toEqual([`${b.seatId}-1`]);
  });

  it('폰 일정: 차의 "안 가요"가 폰이 보낸 일정을 차량 응답에서 뺀다(폰 일정·travelConfirmed 일정 모두)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await call(app, 'PUT', '/events', {
      token: a.phoneToken,
      body: { events: [ev({ id: 'plain' }), ev({ id: 'confirmed', start: '2026-11-11T16:00:00+09:00', end: '2026-11-11T17:00:00+09:00', travelConfirmed: true }), ev({ id: 'other', title: '다른 일정', start: '2026-11-11T18:00:00+09:00', end: '2026-11-11T19:00:00+09:00' })] },
    });
    const todayIds = async () => ((await call(app, 'GET', `/schedules/today?driver=${a.seatId}`, { token: car.carToken })).body.schedules as { id: string }[]).map((s) => s.id);
    expect(await todayIds()).toEqual(['plain', 'confirmed', 'other']);
    await put(app, { token: car.carToken, body: { add: ['팀 회의'] } }, `?driver=${a.seatId}`);
    expect(await todayIds()).toEqual(['other']);
    const rows = (await call(app, 'GET', '/schedules/places', { token: a.phoneToken })).body.schedules as Row[];
    expect(rows.filter((r) => r.noTravelReason === 'skipped').map((r) => r.id)).toEqual(['plain', 'confirmed']);
  });
});

describe('가장 최근 선택이 이긴다', () => {
  const todayIds = async (app: App, car: Car, seatId: string) =>
    ((await call(app, 'GET', `/schedules/today?driver=${seatId}`, { token: car.carToken })).body.schedules as { id: string }[]).map((s) => s.id);
  const sendEvent = (app: App, token: string, over: Record<string, unknown> = {}) =>
    call(app, 'PUT', '/events', { token, body: { events: [ev({ id: 'meet', title: '고객사 회의', locationText: 'Zoom', ...over })] } });

  it('이동 일정이에요(예외): 폰이 이름의 기억을 지운 뒤 travelConfirmed로 보내면 온라인 일정도 차로 간다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    // 차가 "안 가요"로 기억했다.
    await put(app, { token: car.carToken, body: { add: ['고객사 회의'] } }, `?driver=${a.seatId}`);
    await sendEvent(app, a.phoneToken);
    expect(await todayIds(app, car, a.seatId)).toEqual([]);
    // 폰: 예외를 더하며 같은 이름의 기억을 지우고(폰이 먼저), 일정을 travelConfirmed로 다시 보낸다.
    await put(app, { token: a.phoneToken, body: { remove: ['고객사 회의'] } });
    await sendEvent(app, a.phoneToken, { travelConfirmed: true });
    expect(await todayIds(app, car, a.seatId)).toEqual(['meet']);
  });

  it('이동 없음 기억(skip) 추가가 더 나중이면 같은 이름의 예외(travelConfirmed)보다 이긴다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await sendEvent(app, a.phoneToken, { travelConfirmed: true });
    expect(await todayIds(app, car, a.seatId)).toEqual(['meet']);
    await put(app, { token: car.carToken, body: { add: ['고객사 회의'] } }, `?driver=${a.seatId}`);
    expect(await todayIds(app, car, a.seatId)).toEqual([]);
    const rows = (await call(app, 'GET', '/schedules/places', { token: a.phoneToken })).body.schedules as { noTravelReason: string | null }[];
    expect(rows[0]?.noTravelReason).toBe('skipped');
  });
});

describe('엄격한 자리 규칙: 옛 차 앱 호환 읽기를 쓰지 않는다 (/skips는 새 API)', () => {
  /** 자리 있는 차 하나와 그 자리의 기억(옛 호환이 열려 있으면 식별 없는 읽기가 이 자리로 갔을 것). */
  const withSeatedCar = async (over: Parameters<typeof makeApp>[0] = {}) => {
    const app = makeApp(over);
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { add: ['산부인과 진료', '이혼 상담'] } });
    return { app, car, a };
  };

  it('자리 있는 차가 하나여도(legacyDriverFallback 기본 켜짐) 식별 없는 GET은 그 자리가 아니라 빈 목록이다', async () => {
    const { app } = await withSeatedCar();
    expect(names(await get(app))).toEqual([]);
  });

  it('차 토큰만 있고 driver가 없는 GET은 400 driver-required다(지난번 고른 자리로 짐작하지 않는다)', async () => {
    const { app, car } = await withSeatedCar();
    const noDriver = await get(app, { token: car.carToken });
    expect([noDriver.status, noDriver.body.reason]).toEqual([400, 'driver-required']);
    expect(names(await get(app, { token: car.carToken }, '?driver=' + (await call(app, 'GET', '/drivers', { token: car.carToken })).body.seats[0].seatId))).toEqual(['이혼 상담', '산부인과 진료']);
  });

  it('식별 없는 PUT은 자리 있는 차가 있으면 저장하지 않는 빈 범위라 429 unwritable이고 어느 자리·기본 자리에도 쓰지 않는다', async () => {
    const { app, a } = await withSeatedCar();
    const anonymous = await put(app, { body: { add: ['육전집 점심'] } });
    expect([anonymous.status, anonymous.body.reason]).toEqual([429, 'unwritable']);
    expect(names(await get(app, { token: a.phoneToken }))).toEqual(['이혼 상담', '산부인과 진료']);
    // 기본 자리(픽스처 경로)도 오염되지 않는다: 자리 있는 서버에서는 식별 없는 읽기가 빈 범위라 기본 자리의 기억은 보이지 않지만, 식별 없는 일정 읽기도 막혀 있다.
    expect((await call(app, 'GET', '/schedules/today')).body.schedules).toEqual([]);
  });

  it('자리 있는 차가 하나도 없는 서버에서만 식별 없는 요청이 기본 자리다(데모·E2E)', async () => {
    const app = makeApp();
    expect((await put(app, { body: { add: ['데모 일정'] } })).status).toBe(200);
    expect(names(await get(app))).toEqual(['데모 일정']);
  });

  it('차 토큰 PUT은 driver가 꼭 있어야 하고(없으면 400), 있으면 그 차의 자리에만 쓴다', async () => {
    const { app, car, a } = await withSeatedCar();
    expect((await put(app, { token: car.carToken, body: { add: ['x'] } })).status).toBe(400);
    expect(names(await put(app, { token: car.carToken, body: { add: ['x'] } }, `?driver=${a.seatId}`))).toContain('x');
  });

  it('토큰 없는 기기 id 요청은 자리 있는 차가 있어도 그 기기의 연결 전 버킷이다', async () => {
    const { app } = await withSeatedCar();
    expect((await put(app, { device: DEV_B, body: { add: ['버킷만'] } })).status).toBe(200);
    expect(names(await get(app, { device: DEV_B }))).toEqual(['버킷만']);
    expect(names(await get(app))).toEqual([]);
  });

  it('모르는 토큰은 읽기·쓰기 모두 401이다', async () => {
    const { app } = await withSeatedCar();
    expect((await get(app, { token: 'f'.repeat(64) })).status).toBe(401);
    expect((await put(app, { token: 'f'.repeat(64), body: { add: ['x'] } })).status).toBe(401);
  });
});

describe('연결 전 버킷의 기억 개수 상한', () => {
  it(`버킷은 ${MAX_BUCKET_SKIPS}개까지만 두고 넘으면 409 full(limit 포함)이다. 기본 자리·연결된 자리는 ${MAX_SKIPS}개다`, async () => {
    const app = makeApp();
    const fifty = Array.from({ length: MAX_BUCKET_SKIPS }, (_, i) => `버킷 일정 ${i}`);
    expect((await put(app, { device: DEV_A, body: { add: fifty } })).status).toBe(200);
    const full = await put(app, { device: DEV_A, body: { add: ['하나 더'] } });
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ reason: 'full', limit: MAX_BUCKET_SKIPS });
    expect(names(await get(app, { device: DEV_A }))).toHaveLength(MAX_BUCKET_SKIPS);
    // 다른 기기 버킷은 따로 센다.
    expect((await put(app, { device: DEV_B, body: { add: ['하나'] } })).status).toBe(200);
  });

  it('상한은 설정으로 바꿀 수 있다(capacity.maxBucketSkips)', async () => {
    const app = makeApp({ capacity: { maxBucketSkips: 2 } });
    expect((await put(app, { device: DEV_A, body: { add: ['a', 'b'] } })).status).toBe(200);
    expect((await put(app, { device: DEV_A, body: { add: ['c'] } })).status).toBe(409);
  });

  it('기억만 있는 버킷은 빈 버킷이 아니라서 밀어낼 때 빈 버킷이 먼저 나간다', async () => {
    const app = makeApp({ capacity: { maxBuckets: 2 } });
    await put(app, { device: DEV_A, body: { add: ['기억 있음'] } });
    expect((await put(app, { device: DEV_B, body: { add: ['x'] } })).status).toBe(200);
    await put(app, { device: DEV_B, body: { remove: ['x'] } }); // B는 비었다
    expect((await put(app, { device: 'c'.repeat(32), body: { add: ['새 기기'] } })).status).toBe(200);
    expect(names(await get(app, { device: DEV_A }))).toEqual(['기억 있음']);
  });
});

describe('이름 검사', () => {
  it('보이지 않는 글자뿐인 이름은 400이고, 보이는 글자 사이의 제로폭 공백은 같은 이름으로 본다', async () => {
    const app = makeApp();
    expect(names(await put(app, { body: { add: ['a\u0000b'] } }))).toEqual(['ab']); // 제어 문자는 지운다
    expect((await put(app, { body: { add: ['\u200b'] } })).status).toBe(400);
    await put(app, { body: { add: ['팀\u200b 회의'] } });
    expect(names(await get(app))).toContain('팀 회의');
    expect(names(await put(app, { body: { remove: ['팀 회의'] } }))).not.toContain('팀 회의');
  });

  it('200자 상한은 글자 수(이모지는 한 글자)로 센다', async () => {
    const app = makeApp();
    expect((await put(app, { body: { add: ['😀'.repeat(200)] } })).status).toBe(200);
    expect((await put(app, { body: { add: ['😀'.repeat(201)] } })).status).toBe(400);
  });
});

describe('우선순위: 일정별 장소 보정 > 이동 없음 기억 > 온라인·건물 안 > 장소 기억·일정 장소', () => {
  const HOME = { name: '샘플 아파트', lat: 35.1743, lng: 126.9121, address: '광주 북구 샘플로 12' };
  const SNAP = { name: '카카오 약국', address: '광주 서구 약국로 9', lat: 35.151, lng: 126.851, externalId: 'kakao:12345' };
  const at = '?at=2026-11-11T10%3A00%3A00%2B09%3A00';
  type Seated = { app: App; car: Car; seat: { seatId: string; phoneToken: string } };
  const setup = async (): Promise<Seated> => {
    const app = makeApp();
    const car = await registerCar(app);
    const seat = await connect(app, car, 'A');
    await call(app, 'PUT', '/calendars/selection', { token: seat.phoneToken, body: { selectedIds: ['cal-1'], revision: 1, source: 'device' } });
    return { app, car, seat };
  };
  const send = (t: Seated, events: unknown[]) => call(t.app, 'PUT', '/events', { token: t.seat.phoneToken, body: { events } });
  const rememberPlace = (t: Seated, name: string) =>
    call(t.app, 'PUT', `/places/memory?driver=${t.seat.seatId}`, { token: t.car.carToken, body: { name, place: HOME, ambiguous: false } });
  const places = async (t: Seated) => (await call(t.app, 'GET', `/schedules/places${at}`, { token: t.seat.phoneToken })).body.schedules as Record<string, any>[];
  const today = async (t: Seated) => ((await call(t.app, 'GET', `/schedules/today${at}`, { token: t.seat.phoneToken })).body.schedules as { id: string }[]).map((s) => s.id);
  const rowOf = async (t: Seated, id: string) => (await places(t)).find((r) => r.id === id)!;

  it('이름으로 이동 없음을 기억한 일정은 장소 기억이 있어도 이동 없음이다(차량 응답에서 빠지고 이유 skipped)', async () => {
    const t = await setup();
    await send(t, [ev({ id: 'e1', title: '친구 약속', locationText: '샘플 아파트' })]);
    await rememberPlace(t, '샘플 아파트');
    expect(await rowOf(t, 'e1')).toMatchObject({ noTravel: false, place: { name: '샘플 아파트' }, placeMemory: { ambiguous: false } });
    await put(t.app, { token: t.seat.phoneToken, body: { add: ['친구 약속'] } });
    expect(await rowOf(t, 'e1')).toMatchObject({ noTravel: true, noTravelReason: 'skipped', place: null, corrected: false });
    expect(await rowOf(t, 'e1')).not.toHaveProperty('placeMemory');
    expect(await today(t)).not.toContain('e1');
  });

  it('온라인·건물 안 자동 판정보다 이동 없음 기억이 앞서 차량 응답에서 빠진다(예외로 보낸 일정도)', async () => {
    const t = await setup();
    await send(t, [ev({ id: 'e1', title: '고객사 회의', locationText: 'Zoom', travelConfirmed: true })]);
    expect(await today(t)).toContain('e1'); // travelConfirmed는 안전망을 건너뜀
    await put(t.app, { token: t.seat.phoneToken, body: { add: ['고객사 회의'] } });
    expect(await today(t)).not.toContain('e1');
  });

  it('그 일정에 장소를 직접 넣으면(목 id든 스냅숏이든) 보정이 이름 기억보다 앞서 차로 간다(corrected)', async () => {
    const t = await setup();
    await send(t, [ev({ id: 'e1', title: '친구 약속' }), ev({ id: 'e2', title: '친구 약속', start: '2026-11-11T16:00:00+09:00', end: '2026-11-11T17:00:00+09:00' })]);
    await put(t.app, { token: t.seat.phoneToken, body: { add: ['친구 약속'] } });
    expect((await rowOf(t, 'e1')).noTravel).toBe(true);
    const snapshot = await call(t.app, 'PUT', '/schedules/e1/place', { token: t.seat.phoneToken, body: { place: SNAP } });
    expect(snapshot.body).toMatchObject({ corrected: true, noTravel: false, title: '친구 약속', place: { name: '카카오 약국' } });
    expect(await rowOf(t, 'e1')).toMatchObject({ corrected: true, noTravel: false, noTravelReason: null });
    expect(await rowOf(t, 'e2')).toMatchObject({ corrected: false, noTravel: true, noTravelReason: 'skipped' }); // 같은 이름의 다른 일정은 여전히 기억을 따름
    expect(await today(t)).toEqual(['e1']);
    const placeId = catalog.places[0].id;
    const byId = await call(t.app, 'PUT', '/schedules/e2/place', { token: t.seat.phoneToken, body: { placeId } });
    expect(byId.body).toMatchObject({ corrected: true, noTravel: false });
  });

  it('장소 기억과 일정 장소는 이동 없음 기억이 없을 때만 쓰인다(기억을 지우면 다시 장소 기억대로 간다)', async () => {
    const t = await setup();
    await send(t, [ev({ id: 'e1', title: '친구 약속', locationText: '샘플 아파트' })]);
    await rememberPlace(t, '샘플 아파트');
    await put(t.app, { token: t.seat.phoneToken, body: { add: ['친구 약속'] } });
    await put(t.app, { token: t.seat.phoneToken, body: { remove: ['친구 약속'] } });
    expect(await rowOf(t, 'e1')).toMatchObject({ noTravel: false, place: { name: '샘플 아파트' }, placeMemory: { ambiguous: false } });
    expect(await today(t)).toContain('e1');
  });

  it('이름 정규화가 하나라서 장소 기억의 키도 제로폭·NFC 차이를 무시한다(eventName.ts 공용)', async () => {
    const t = await setup();
    await send(t, [ev({ id: 'e1', title: '친구 약속', locationText: '샘플​ 아파트' })]);
    await rememberPlace(t, '샘플 아파트');
    expect(await rowOf(t, 'e1')).toMatchObject({ place: { name: '샘플 아파트' }, placeMemory: { ambiguous: false } });
  });
});
