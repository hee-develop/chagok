import { describe, expect, it } from 'vitest';
import { parsePlaceSnapshot } from '../src/placeSnapshot.js';
import { createSeatStore } from '../src/seats.js';
import { catalog, newApp } from './helpers.js';

/** 외부 검색(카카오) 결과를 폰이 장소 스냅숏으로 자주 가는 곳·일정 보정에 저장하는 경로(M7). 기존 placeId 요청은 그대로다. */
const NOW = '2026-11-11T10:00:00+09:00';
const makeApp = () => {
  const now = () => new Date(NOW);
  return newApp({ now, seats: createSeatStore(now), clientAddress: () => 'test' });
};
type App = ReturnType<typeof makeApp>;
const call = async (app: App, method: string, path: string, o: { token?: string; device?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.device) headers['x-chagok-device'] = o.device;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  return { status: res.status, body: (await res.json()) as any };
};
const DEV = 'd'.repeat(32);
const KAKAO = { name: '카카오 약국', address: '광주 서구 약국로 9', lat: 35.151, lng: 126.851, externalId: 'kakao:12345' };
const SNAP_ID = 'ext:kakao:12345';

describe('parsePlaceSnapshot', () => {
  it('외부 id가 있으면 ext:, 없으면 geo:<위도>,<경도>로 id를 만들고 주소는 없으면 빈 글자다', () => {
    expect(parsePlaceSnapshot(KAKAO)).toEqual({ ok: true, place: { id: SNAP_ID, name: '카카오 약국', address: '광주 서구 약국로 9', lat: 35.151, lng: 126.851 } });
    expect(parsePlaceSnapshot({ name: ' 임의  장소 ', lat: 35.1, lng: 126.8 })).toEqual({ ok: true, place: { id: 'geo:35.1,126.8', name: '임의 장소', address: '', lat: 35.1, lng: 126.8 } });
  });
  it.each([
    ['배열', []],
    ['name 없음', { lat: 1, lng: 2 }],
    ['name 너무 김', { name: '가'.repeat(201), lat: 1, lng: 2 }],
    ['lat 범위 밖', { name: 'a', lat: 91, lng: 2 }],
    ['lng 문자열', { name: 'a', lat: 1, lng: '2' }],
    ['address 너무 김', { name: 'a', lat: 1, lng: 2, address: '가'.repeat(301) }],
    ['externalId에 공백', { name: 'a', lat: 1, lng: 2, externalId: 'a b' }],
    ['externalId 너무 김', { name: 'a', lat: 1, lng: 2, externalId: 'a'.repeat(100) }],
    ['모르는 필드', { name: 'a', lat: 1, lng: 2, id: 'x' }],
  ])('거절: %s', (_n, raw) => {
    expect(parsePlaceSnapshot(raw).ok).toBe(false);
  });
});

describe('자주 가는 곳에 장소 스냅숏 저장', () => {
  it('집·회사·추가 장소 모두 place 스냅숏으로 저장되고 응답은 id·이름·주소·좌표다. 기존 placeId와 섞여도 된다', async () => {
    const app = makeApp();
    const mock = catalog.places[0]!;
    const home = await call(app, 'PUT', '/places/favorites/home', { device: DEV, body: { place: KAKAO } });
    expect(home.status).toBe(200);
    expect(home.body.home).toEqual({ id: SNAP_ID, name: '카카오 약국', address: '광주 서구 약국로 9', lat: 35.151, lng: 126.851 });
    const work = await call(app, 'PUT', '/places/favorites/work', { device: DEV, body: { placeId: mock.id } });
    expect(work.body.work).toMatchObject({ id: mock.id, name: mock.name });
    const other = await call(app, 'POST', '/places/favorites/others', { device: DEV, body: { place: { name: '임의', lat: 35.2, lng: 126.9 } } });
    expect(other.status).toBe(200);
    expect(other.body.others.map((p: { id: string }) => p.id)).toEqual(['geo:35.2,126.9']);
    expect(other.body.revision).toBe(3);
    const read = await call(app, 'GET', '/places/favorites', { device: DEV });
    expect(read.body.home.id).toBe(SNAP_ID);
  });

  it('같은 외부 장소를 다른 자리로 옮기면 원래 자리에서 빠지고, 같은 추가 장소를 또 넣으면 400이다', async () => {
    const app = makeApp();
    await call(app, 'POST', '/places/favorites/others', { device: DEV, body: { place: KAKAO } });
    expect((await call(app, 'POST', '/places/favorites/others', { device: DEV, body: { place: KAKAO } })).status).toBe(400);
    const moved = await call(app, 'PUT', '/places/favorites/work', { device: DEV, body: { place: KAKAO } });
    expect(moved.body.work.id).toBe(SNAP_ID);
    expect(moved.body.others).toEqual([]);
  });

  it('차에는 스냅숏이 일반 자주 가는 곳으로 내려간다(/schedules/today의 favorites)', async () => {
    const app = makeApp();
    const car = (await call(app, 'POST', '/pair/code', { body: {} })).body;
    const code = (await call(app, 'POST', '/pair/code', { token: car.carToken, body: {} })).body.code;
    const seat = (await call(app, 'POST', '/pair/claim', { body: { code, name: 'A' } })).body;
    await call(app, 'PUT', '/places/favorites/home', { token: seat.phoneToken, body: { place: KAKAO } });
    const today = await call(app, 'GET', `/schedules/today?driver=${seat.seatId}`, { token: car.carToken });
    expect(today.body.favorites).toEqual([{ kind: 'home', name: '카카오 약국', address: '광주 서구 약국로 9', lat: 35.151, lng: 126.851 }]);
  });

  it.each([
    ['placeId와 place를 함께', { placeId: catalog.places[0]!.id, place: KAKAO }],
    ['알 수 없는 목 id', { placeId: 'nope' }],
    ['빈 본문', {}],
    ['잘못된 스냅숏', { place: { name: '', lat: 1, lng: 2 } }],
    ['모르는 필드', { place: KAKAO, extra: 1 }],
  ])('400: %s', async (_n, body) => {
    const app = makeApp();
    expect((await call(app, 'PUT', '/places/favorites/home', { device: DEV, body })).status).toBe(400);
    expect((await call(app, 'GET', '/places/favorites', { device: DEV })).body.home).toBeNull();
  });

  it('집·회사는 placeId: null로 비울 수 있고, 추가 장소는 null을 받지 않는다(기존 계약)', async () => {
    const app = makeApp();
    await call(app, 'PUT', '/places/favorites/home', { device: DEV, body: { place: KAKAO } });
    expect((await call(app, 'PUT', '/places/favorites/home', { device: DEV, body: { placeId: null } })).body.home).toBeNull();
    expect((await call(app, 'POST', '/places/favorites/others', { device: DEV, body: { placeId: null } })).status).toBe(400);
  });
});

describe('일정 보정에 장소 스냅숏 저장', () => {
  const events = [{ id: 'e1', calendarId: 'c', title: '약속', start: '2026-11-11T14:00:00+09:00', end: '2026-11-11T15:00:00+09:00', allDay: false, locationText: null, notes: null, attendees: [] }];
  const setup = async () => {
    const app = makeApp();
    await call(app, 'PUT', '/events', { device: DEV, body: { events } });
    return app;
  };

  it('place 스냅숏으로 보정하면 그 장소가 일정에 확정되고(오늘·장소 목록), placeId: null로 지우면 돌아간다', async () => {
    const app = await setup();
    const put = await call(app, 'PUT', '/schedules/e1/place', { device: DEV, body: { place: KAKAO } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ id: 'e1', place: { name: '카카오 약국', lat: 35.151, lng: 126.851 }, locationText: '카카오 약국', noTravel: false });
    for (const path of ['today', 'places']) {
      const row = (await call(app, 'GET', `/schedules/${path}`, { device: DEV })).body.schedules[0];
      expect(row.place).toEqual({ name: '카카오 약국', lat: 35.151, lng: 126.851 });
    }
    expect((await call(app, 'PUT', '/schedules/e1/place', { device: DEV, body: { placeId: null } })).body.place).toBeNull();
  });

  it('기존 placeId 보정은 그대로 동작한다', async () => {
    const app = await setup();
    const mock = catalog.places[1]!;
    const put = await call(app, 'PUT', '/schedules/e1/place', { device: DEV, body: { placeId: mock.id } });
    expect(put.body.place).toEqual({ name: mock.name, lat: mock.lat, lng: mock.lng });
  });

  it('잘못된 스냅숏·알 수 없는 id·섞어 보내기는 400이다', async () => {
    const app = await setup();
    for (const body of [{ place: { name: 'a', lat: 200, lng: 1 } }, { placeId: 'nope' }, { placeId: null, place: KAKAO }, { place: KAKAO, noTravel: true }]) {
      expect((await call(app, 'PUT', '/schedules/e1/place', { device: DEV, body })).status).toBe(400);
    }
  });
});
