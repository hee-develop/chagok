import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH } from '../src/limits.js';
import { createSeatStore } from '../src/seats.js';
import { newApp } from './helpers.js';

const NOW = '2026-11-11T10:00:00+09:00';
const makeApp = (over: Parameters<typeof newApp>[0] = {}) => {
  const now = () => new Date(NOW);
  return newApp({ now, seats: createSeatStore(now), ...over });
};
type App = ReturnType<typeof makeApp>;

type Opts = { token?: string; body?: unknown; device?: string };
const call = async (app: App, method: string, path: string, { token, body, device }: Opts = {}) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-chagok-device'] = device;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as any) };
};
const registerCar = async (app: App) => {
  const res = await call(app, 'POST', '/pair/code', { body: {} });
  return { carId: res.body.carId as string, carToken: res.body.carToken as string };
};
const connect = async (app: App, car: { carToken: string }, name: string, device?: string) => {
  const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} });
  const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name }, device });
  expect(claimed.status).toBe(200);
  return claimed.body as { seatId: string; phoneToken: string };
};

const DEVICE = 'device-aaaaaaaaaaaaaaaaaaaaaa';
const DEVICE_B = 'device-bbbbbbbbbbbbbbbbbbbbbb';
const del = (app: App, id: string, opts: Opts = {}) => call(app, 'DELETE', `/places/favorites/others/${encodeURIComponent(id)}`, opts);
const addOther = (app: App, placeId: string, opts: Opts = {}) => call(app, 'POST', '/places/favorites/others', { ...opts, body: { placeId } });
const list = async (app: App, opts: Opts = {}) => (await call(app, 'GET', '/places/favorites', opts)).body as { home: any; work: any; others: { id: string }[]; revision: number };
const ids = (f: { others: { id: string }[] }) => f.others.map((p) => p.id);

describe('DELETE /places/favorites/others/:id', () => {
  it('단골 하나를 빼고 집·회사와 나머지 순서는 그대로 두며 revision을 올린다', async () => {
    const app = makeApp();
    await call(app, 'PUT', '/places/favorites/home', { body: { placeId: 'mock-home-apt' } });
    await call(app, 'PUT', '/places/favorites/work', { body: { placeId: 'mock-work-tower' } });
    await addOther(app, 'mock-gym');
    await addOther(app, 'mock-champions-field');
    await addOther(app, 'mock-station');
    const before = await list(app);
    const res = await del(app, 'mock-champions-field');
    expect(res.status).toBe(200);
    expect(res.body.home.id).toBe('mock-home-apt');
    expect(res.body.work.id).toBe('mock-work-tower');
    expect(ids(res.body)).toEqual(['mock-gym', 'mock-station']);
    expect(res.body.revision).toBe(before.revision + 1);
    expect(await list(app)).toEqual(res.body);
  });

  it('없는 장소는 404이고 저장도 revision도 그대로다', async () => {
    const app = makeApp();
    await addOther(app, 'mock-gym');
    const before = await list(app);
    const res = await del(app, 'mock-nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/자주 가는 곳/);
    expect(await list(app)).toEqual(before);
  });

  it('같은 장소를 두 번 지우면 두 번째는 404다', async () => {
    const app = makeApp();
    await addOther(app, 'mock-gym');
    expect((await del(app, 'mock-gym')).status).toBe(200);
    expect((await del(app, 'mock-gym')).status).toBe(404);
  });

  it('집·회사는 이 경로로 지우지 않는다(단골에 없는 id는 404)', async () => {
    const app = makeApp();
    await call(app, 'PUT', '/places/favorites/home', { body: { placeId: 'mock-home-apt' } });
    await call(app, 'PUT', '/places/favorites/work', { body: { placeId: 'mock-work-tower' } });
    expect((await del(app, 'mock-home-apt')).status).toBe(404);
    expect((await del(app, 'mock-work-tower')).status).toBe(404);
    const after = await list(app);
    expect([after.home.id, after.work.id]).toEqual(['mock-home-apt', 'mock-work-tower']);
  });

  it.each([
    ['외부 검색 결과', { place: { name: '카페 상무', address: '광주 서구', lat: 35.15, lng: 126.85, externalId: 'kakao:1234.5-a_b' } }, 'ext:kakao:1234.5-a_b'],
    ['좌표만 있는 장소', { place: { name: '임시 장소', lat: 35.15, lng: 126.85 } }, 'geo:35.15,126.85'],
  ])('%s의 id(콜론·쉼표·점이 든 경로)도 지운다', async (_label, body, id) => {
    const app = makeApp();
    const added = await call(app, 'POST', '/places/favorites/others', { body });
    expect(ids(added.body)).toEqual([id]);
    const res = await del(app, id);
    expect(res.status).toBe(200);
    expect(res.body.others).toEqual([]);
  });

  it('id가 너무 길면 400이다', async () => {
    const app = makeApp();
    const res = await del(app, 'x'.repeat(MAX_ID_LENGTH + 1));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /places/favorites/others/:id · 자리', () => {
  it('폰 토큰은 그 자리의 단골만 지우고 다른 자리는 그대로다(남의 단골은 404)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    const b = await connect(app, car, 'B');
    await addOther(app, 'mock-gym', { token: a.phoneToken });
    await addOther(app, 'mock-gym', { token: b.phoneToken });
    expect((await del(app, 'mock-gym', { token: a.phoneToken })).status).toBe(200);
    expect(ids(await list(app, { token: a.phoneToken }))).toEqual([]);
    expect(ids(await list(app, { token: b.phoneToken }))).toEqual(['mock-gym']);
    // A에는 이제 없으므로 A의 두 번째 요청은 404이고 B는 영향이 없다.
    expect((await del(app, 'mock-gym', { token: a.phoneToken })).status).toBe(404);
    expect(ids(await list(app, { token: b.phoneToken }))).toEqual(['mock-gym']);
  });

  it('모르는 폰 토큰은 401이고 아무것도 지우지 않는다', async () => {
    const app = makeApp();
    await addOther(app, 'mock-gym');
    expect((await del(app, 'mock-gym', { token: 'a'.repeat(64) })).status).toBe(401);
    expect(ids(await list(app))).toEqual(['mock-gym']);
  });

  it('차 토큰으로는 지울 수 없다(폰의 쓰기와 같은 가드)', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    const a = await connect(app, car, 'A');
    await addOther(app, 'mock-gym', { token: a.phoneToken });
    expect((await del(app, 'mock-gym', { token: car.carToken })).status).toBe(401);
    expect(ids(await list(app, { token: a.phoneToken }))).toEqual(['mock-gym']);
  });

  it('잘못된 기기 id 헤더는 400이다', async () => {
    const app = makeApp();
    expect((await del(app, 'mock-gym', { device: 'short' })).status).toBe(400);
  });

  it('연결 전 기기 id 버킷은 그 기기의 단골만 지우고, 연결하면 지운 채로 이어진다', async () => {
    const app = makeApp();
    const car = await registerCar(app);
    await addOther(app, 'mock-gym', { device: DEVICE });
    await addOther(app, 'mock-station', { device: DEVICE });
    await addOther(app, 'mock-gym', { device: DEVICE_B });
    expect((await del(app, 'mock-gym', { device: DEVICE })).status).toBe(200);
    expect(ids(await list(app, { device: DEVICE }))).toEqual(['mock-station']);
    expect(ids(await list(app, { device: DEVICE_B }))).toEqual(['mock-gym']);
    const seat = await connect(app, car, 'A', DEVICE);
    expect(ids(await list(app, { token: seat.phoneToken }))).toEqual(['mock-station']);
  });

  it('지우기는 연결 전 버킷을 만들지 않는다(버킷이 없는 기기의 지우기는 404이고 주소별 생성 한도를 쓰지 않는다)', async () => {
    const app = makeApp({ capacity: { maxBucketCreatesPerSource: 1 } });
    expect((await del(app, 'mock-gym', { device: DEVICE })).status).toBe(404);
    // 한도(1개)가 남아 있어 다른 기기가 버킷을 만들 수 있다.
    expect((await addOther(app, 'mock-gym', { device: DEVICE_B })).status).toBe(200);
  });

  it('자리 있는 차가 없는 서버의 식별 없는 요청은 기본 자리를 지운다(데모·E2E 경로)', async () => {
    const app = makeApp();
    await addOther(app, 'mock-gym');
    expect((await del(app, 'mock-gym')).status).toBe(200);
    expect(ids(await list(app))).toEqual([]);
  });
});
