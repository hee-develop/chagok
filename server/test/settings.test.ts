import { describe, expect, it } from 'vitest';
import { createSeatStore } from '../src/seats.js';
import { newApp } from './helpers.js';

const NOW = '2026-11-11T10:00:00+09:00';
let clockMs = Date.parse(NOW);
const makeApp = (over: Parameters<typeof newApp>[0] = {}) => {
  clockMs = Date.parse(NOW);
  const now = () => new Date(clockMs);
  return newApp({ now, seats: createSeatStore(now), clientAddress: (c) => c.req.header('x-test-ip') ?? 'test', ...over });
};
type App = ReturnType<typeof makeApp>;

type Opts = { token?: string; body?: unknown; device?: string; raw?: string; contentType?: string | null };
const call = async (app: App, method: string, path: string, { token, body, device, raw, contentType }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-chagok-device'] = device;
  if (contentType !== null && (body !== undefined || raw !== undefined)) headers['content-type'] = contentType ?? 'application/json';
  const res = await app.request(path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
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
const replaceSeat = async (app: App, car: Car, seatId: string, name: string, opts: { device?: string } = {}) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId } });
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device: opts.device });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; phoneToken: string };
};

const DEVICE_A = 'device-aaaaaaaaaaaaaaaaaaaaaa';
const DEVICE_B = 'device-bbbbbbbbbbbbbbbbbbbbbb';
const OFF = { plusMode: false, lateContact: false, voiceOnly: false };
const put = (app: App, opts: Opts) => call(app, 'PUT', '/settings', opts);
const get = (app: App, opts: Opts = {}) => call(app, 'GET', '/settings', opts);
const today = (app: App, opts: Opts = {}) => call(app, 'GET', '/schedules/today', opts);

describe('설정 API · 기본값과 저장', () => {
  it('아무것도 정하지 않았으면 모두 꺼짐이다(기본 자리: 자리 있는 차가 없는 서버의 식별 없는 요청)', async () => {
    const app = makeApp();
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(OFF);
  });

  it('폰 토큰으로 보낸 키만 바꾸고 나머지는 그대로 둔다(부분 갱신). 바뀐 전체를 돌려준다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const first = await put(app, { token: a.phoneToken, body: { plusMode: true } });
    expect(first).toEqual({ status: 200, body: { ...OFF, plusMode: true } });
    const second = await put(app, { token: a.phoneToken, body: { lateContact: true, voiceOnly: true } });
    expect(second.body).toEqual({ plusMode: true, lateContact: true, voiceOnly: true });
    const third = await put(app, { token: a.phoneToken, body: { plusMode: false } });
    expect(third.body).toEqual({ plusMode: false, lateContact: true, voiceOnly: true });
    expect((await get(app, { token: a.phoneToken })).body).toEqual({ plusMode: false, lateContact: true, voiceOnly: true });
  });

  it('모르는 폰 토큰(바뀜·끊김)은 401이고 기본 자리나 버킷으로 흘리지 않는다', async () => {
    const app = makeApp();
    const stale = 'a'.repeat(64);
    expect((await get(app, { token: stale, device: DEVICE_A })).status).toBe(401);
    expect((await put(app, { token: stale, device: DEVICE_A, body: { plusMode: true } })).status).toBe(401);
    expect((await get(app)).body).toEqual(OFF);
  });
});

describe('설정 API · 검증', () => {
  const cases: [string, Opts][] = [
    ['빈 객체', { body: {} }],
    ['알 수 없는 키', { body: { plusMode: true, loud: true } }],
    ['boolean이 아닌 값(문자열)', { body: { plusMode: 'true' } }],
    ['boolean이 아닌 값(숫자)', { body: { lateContact: 1 } }],
    ['null 값', { body: { voiceOnly: null } }],
    ['배열 본문', { body: [{ plusMode: true }] }],
    ['null 본문', { raw: 'null' }],
    ['깨진 JSON', { raw: '{"plusMode":' }],
    ['JSON이 아닌 content-type', { raw: '{"plusMode":true}', contentType: 'text/plain' }],
    ['__proto__ 키', { raw: '{"__proto__":{"plusMode":true}}' }],
  ];
  it.each(cases)('%s는 400이고 아무것도 바꾸지 않는다', async (_name, opts) => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    expect((await put(app, { token: a.phoneToken, ...opts })).status).toBe(400);
    expect((await get(app, { token: a.phoneToken })).body).toEqual(OFF);
  });

  it('너무 큰 본문은 413이다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const res = await put(app, { token: a.phoneToken, raw: JSON.stringify({ plusMode: true, pad: 'x'.repeat(70 * 1024) }) });
    expect(res.status).toBe(413);
    expect((await get(app, { token: a.phoneToken })).body).toEqual(OFF);
  });

  it('잘못된 기기 id 헤더는 400이다', async () => {
    const app = makeApp();
    expect((await put(app, { device: 'short', body: { plusMode: true } })).status).toBe(400);
    expect((await get(app, { device: 'short' })).status).toBe(400);
  });
});

describe('설정 API · 자리 격리', () => {
  it('자리마다 따로 쌓이고 서로 보이지 않는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await put(app, { token: a.phoneToken, body: { plusMode: true } });
    await put(app, { token: b.phoneToken, body: { lateContact: true } });
    expect((await get(app, { token: a.phoneToken })).body).toEqual({ ...OFF, plusMode: true });
    expect((await get(app, { token: b.phoneToken })).body).toEqual({ ...OFF, lateContact: true });
  });

  it('다른 차의 자리도 섞이지 않는다', async () => {
    const app = makeApp();
    const car1 = await registerCar(app);
    const car2 = await registerCar(app);
    const a = await connect(app, car1, 'A');
    const b = await connect(app, car2, 'B');
    await put(app, { token: a.phoneToken, body: { voiceOnly: true } });
    expect((await get(app, { token: b.phoneToken })).body).toEqual(OFF);
  });

  it('차 토큰은 driver=<자리>가 꼭 있어야 읽고(없으면 400, 남의 자리는 403), 쓸 수는 없다(403)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const other = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, other, 'B');
    await put(app, { token: a.phoneToken, body: { plusMode: true } });
    expect((await get(app, { token: car.carToken })).status).toBe(400);
    expect((await get(app, { token: car.carToken, device: DEVICE_A })).body.reason).toBe('driver-required');
    expect(await call(app, 'GET', `/settings?driver=${a.seatId}`, { token: car.carToken })).toEqual({ status: 200, body: { ...OFF, plusMode: true } });
    expect((await call(app, 'GET', `/settings?driver=${b.seatId}`, { token: car.carToken })).status).toBe(403);
    const write = await call(app, 'PUT', `/settings?driver=${a.seatId}`, { token: car.carToken, body: { plusMode: false } });
    expect(write.status).toBe(403);
    expect((await get(app, { token: a.phoneToken })).body.plusMode).toBe(true);
  });

  it('자리 있는 차가 생기면 식별 없는 요청은 옛 호환 읽기 없이 빈 범위다(읽으면 기본값, 쓰면 거절)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { plusMode: true, lateContact: true } });
    // 자리 있는 차가 정확히 하나여도 옛 차 앱 호환이 적용되지 않는다.
    expect(await get(app)).toEqual({ status: 200, body: OFF });
    const denied = await put(app, { body: { plusMode: true } });
    expect(denied.status).toBe(429);
    expect(denied.body.reason).toBe('unwritable');
    expect((await get(app, { token: a.phoneToken })).body).toEqual({ ...OFF, plusMode: true, lateContact: true });
  });

  it('자리 있는 차가 없는 서버의 식별 없는 요청은 기본 자리를 쓴다(데모·E2E 경로)', async () => {
    const app = makeApp();
    expect((await put(app, { body: { voiceOnly: true } })).status).toBe(200);
    expect((await get(app)).body).toEqual({ ...OFF, voiceOnly: true });
    expect((await today(app)).body.settings).toEqual({ ...OFF, voiceOnly: true });
  });
});

describe('설정 API · 연결 전 버킷', () => {
  it('연결 전 기기 id별 버킷에 쌓이고 다른 기기는 못 본다', async () => {
    const app = makeApp();
    await put(app, { device: DEVICE_A, body: { plusMode: true } });
    expect((await get(app, { device: DEVICE_A })).body).toEqual({ ...OFF, plusMode: true });
    expect((await get(app, { device: DEVICE_B })).body).toEqual(OFF);
    expect((await get(app)).body).toEqual(OFF);
  });

  it('연결하면 그 기기 버킷의 설정이 새 자리로 이어진다(다른 기기의 버킷은 안 가져간다)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    await put(app, { device: DEVICE_A, body: { plusMode: true, lateContact: true } });
    await put(app, { device: DEVICE_B, body: { voiceOnly: true } });
    const a = await connect(app, car, 'A', { device: DEVICE_A });
    expect((await get(app, { token: a.phoneToken })).body).toEqual({ ...OFF, plusMode: true, lateContact: true });
    // B의 버킷은 그대로 남아 B가 연결할 때 이어진다.
    expect((await get(app, { device: DEVICE_B })).body).toEqual({ ...OFF, voiceOnly: true });
    // 기기 id 없이 연결한 폰은 빈 자리로 시작한다.
    const c = await connect(app, car, 'C');
    expect((await get(app, { token: c.phoneToken })).body).toEqual(OFF);
  });

  it('연결 뒤에는 버킷이 비어 같은 기기 id로 읽어도 기본값이다(자리로 옮겨졌다)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    await put(app, { device: DEVICE_A, body: { plusMode: true } });
    await connect(app, car, 'A', { device: DEVICE_A });
    expect((await get(app, { device: DEVICE_A })).body).toEqual(OFF);
  });

  it('잘못된 쓰기는 버킷을 만들지 않고, 읽기도 만들지 않는다(주소별 생성 한도에 안 걸린다)', async () => {
    const app = makeApp({ capacity: { maxBucketCreatesPerSource: 1 } });
    expect((await put(app, { device: DEVICE_A, body: { plusMode: 'x' } })).status).toBe(400);
    expect((await get(app, { device: DEVICE_A })).status).toBe(200);
    expect((await put(app, { device: DEVICE_B, body: { plusMode: true } })).status).toBe(200);
    // 한도(1개)를 쓴 같은 주소의 다른 기기는 새 버킷을 못 만든다.
    expect((await put(app, { device: 'device-cccccccccccccccccccccc', body: { plusMode: true } })).status).toBe(429);
  });

  it('기본값이 아닌 설정이 든 버킷은 빈 버킷이 아니라서 밀어낼 때 빈 버킷이 먼저 나간다', async () => {
    const app = makeApp({ capacity: { maxBuckets: 2 } });
    await put(app, { device: DEVICE_A, body: { plusMode: true } });
    clockMs += 1000;
    await put(app, { device: DEVICE_B, body: { plusMode: false } }); // 아무것도 모으지 않은 버킷
    clockMs += 1000;
    await put(app, { device: 'device-cccccccccccccccccccccc', body: { lateContact: true } }); // 가득 참 → 빈 B가 나간다
    expect((await get(app, { device: DEVICE_A })).body).toEqual({ ...OFF, plusMode: true });
  });
});

describe('데모 초기화(DELETE /events)', () => {
  const loopback = () => makeApp({ isLoopback: () => true });

  it('기본 자리의 설정을 기본값으로 되돌린다(다음 시연이 앞 시연의 스위치를 물려받지 않는다)', async () => {
    const app = loopback();
    await put(app, { body: { plusMode: true, lateContact: true, voiceOnly: true } });
    expect((await get(app)).body).toEqual({ plusMode: true, lateContact: true, voiceOnly: true });
    expect((await call(app, 'DELETE', '/events')).status).toBe(200);
    expect((await get(app)).body).toEqual(OFF);
    expect((await today(app)).body.settings).toEqual(OFF);
  });

  it('실제 자리(폰 토큰)와 연결 전 버킷(기기 id)의 설정은 건드리지 않는다', async () => {
    const app = loopback();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { plusMode: true } });
    await put(app, { device: DEVICE_B, body: { voiceOnly: true } });
    expect((await call(app, 'DELETE', '/events', { token: a.phoneToken })).status).toBe(200);
    expect((await call(app, 'DELETE', '/events', { device: DEVICE_B })).status).toBe(200);
    expect((await get(app, { token: a.phoneToken })).body).toEqual({ ...OFF, plusMode: true });
    expect((await get(app, { device: DEVICE_B })).body).toEqual({ ...OFF, voiceOnly: true });
  });

  it('같은 기기 요청이 아니면 403이고 아무것도 바꾸지 않는다', async () => {
    const app = makeApp({ isLoopback: () => false });
    await put(app, { body: { plusMode: true } });
    expect((await call(app, 'DELETE', '/events')).status).toBe(403);
    expect((await get(app)).body).toEqual({ ...OFF, plusMode: true });
  });
});

describe('설정 API · 폰 바꾸기와 연결 끊기', () => {
  it('폰 바꾸기는 설정을 그대로 둔다. 옛 폰 토큰은 401, 새 폰 토큰이 같은 설정을 읽는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { plusMode: true, voiceOnly: true } });
    const replaced = await replaceSeat(app, car, a.seatId, '새 폰');
    expect((await get(app, { token: a.phoneToken })).status).toBe(401);
    expect(await get(app, { token: replaced.phoneToken })).toEqual({ status: 200, body: { ...OFF, plusMode: true, voiceOnly: true } });
  });

  it('폰 바꾸기에 새 폰의 버킷 설정이 있어도 자리의 설정이 이긴다(가안)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { plusMode: true } });
    await put(app, { device: DEVICE_B, body: { lateContact: true } });
    const replaced = await replaceSeat(app, car, a.seatId, '새 폰', { device: DEVICE_B });
    expect((await get(app, { token: replaced.phoneToken })).body).toEqual({ ...OFF, plusMode: true });
  });

  it('차 연결 끊기(DELETE /pair)는 그 자리의 설정을 지운다. 다른 자리는 그대로이고, 다시 연결하면 기본값으로 시작한다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await put(app, { token: a.phoneToken, body: { plusMode: true, lateContact: true } });
    await put(app, { token: b.phoneToken, body: { voiceOnly: true } });
    expect((await call(app, 'DELETE', '/pair', { token: a.phoneToken })).status).toBe(200);
    expect((await get(app, { token: a.phoneToken })).status).toBe(401);
    expect((await get(app, { token: b.phoneToken })).body).toEqual({ ...OFF, voiceOnly: true });
    const again = await connect(app, car, 'A');
    expect(again.seatId).not.toBe(a.seatId);
    expect((await get(app, { token: again.phoneToken })).body).toEqual(OFF);
  });

  it('차곡 초기화(DELETE /car)도 자리의 설정을 지운다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { plusMode: true } });
    expect((await call(app, 'DELETE', '/car', { token: car.carToken })).status).toBe(200);
    const again = await connect(app, car, 'A');
    expect((await get(app, { token: again.phoneToken })).body).toEqual(OFF);
  });
});

describe('/schedules/today의 settings', () => {
  it('폰 토큰·차 토큰 + driver로 읽으면 그 자리의 설정이 실린다(기존 필드는 그대로)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await put(app, { token: a.phoneToken, body: { plusMode: true, lateContact: true } });
    const phone = await today(app, { token: a.phoneToken });
    expect(phone.status).toBe(200);
    expect(phone.body.settings).toEqual({ ...OFF, plusMode: true, lateContact: true });
    expect(Object.keys(phone.body).sort()).toEqual(['anchor', 'favorites', 'schedules', 'settings']);
    const carRead = await call(app, 'GET', `/schedules/today?driver=${a.seatId}`, { token: car.carToken });
    expect(carRead.body.settings).toEqual({ ...OFF, plusMode: true, lateContact: true });
    // 다른 자리는 자기 설정만 본다.
    expect((await today(app, { token: b.phoneToken })).body.settings).toEqual(OFF);
  });

  it('설정을 받은 적 없는 자리·빈 범위(자리 있는 차가 둘 이상인 서버의 식별 없는 읽기)는 모두 꺼짐이다', async () => {
    const app = makeApp();
    const car1 = await registerCar(app);
    const car2 = await registerCar(app);
    const a = await connect(app, car1, 'A');
    await connect(app, car2, 'B');
    await put(app, { token: a.phoneToken, body: { plusMode: true } });
    expect((await today(app)).body.settings).toEqual(OFF);
  });

  it('옛 차 앱 호환 읽기(자리 있는 차가 하나, 식별 없음)는 /schedules/today에서는 그대로 그 자리의 설정을 싣는다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await put(app, { token: a.phoneToken, body: { voiceOnly: true } });
    expect((await today(app)).body.settings).toEqual({ ...OFF, voiceOnly: true });
  });
});
