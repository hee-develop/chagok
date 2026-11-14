import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_KEY_DAYS,
  ARRIVAL_PAST_LIMIT_MS,
  FREQUENT_ARRIVALS_OVER,
  HOME_RADIUS_METERS,
  MAX_ARRIVAL_KEYS,
  MAX_ARRIVAL_PLACES,
  SAME_PLACE_METERS,
  createArrivalsStore,
  distanceMeters,
  favoriteSpots,
  normalizeName,
  rankCandidates,
  samePlace,
  withoutCurrentHome,
} from '../src/arrivals.js';
import { createSeatDataRegistry } from '../src/seatData.js';
import { createSeatStore } from '../src/seats.js';
import { DAY_MS } from '../src/time.js';
import { fixture, newApp } from './helpers.js';
import { call, connectPhone, registerCar, type Car } from './pairHelpers.js';

const seoul = (s: string) => Date.parse(`${s}+09:00`);
let clockMs = seoul('2026-11-11T09:00:00');
const now = () => new Date(clockMs);

type App = ReturnType<typeof newApp>;
const setup = (over: Parameters<typeof newApp>[0] = {}) => {
  clockMs = seoul('2026-11-11T09:00:00');
  const seats = createSeatStore(now);
  const registry = createSeatDataRegistry({ now, fixtureIds: new Set(fixture.schedules.map((s) => s.id)) });
  const app = newApp({ now, seats, seatData: registry, ...over });
  return { app, seats, registry };
};
type Seat = { seatId: string; phoneToken: string };

/** 차 하나에 폰 자리 하나. */
const pairOne = async (app: App, name = '폰') => {
  const car = await registerCar(app);
  const seat = await connectPhone(app, car, name);
  return { car, seat };
};
const place = (name = '광주 육전집', lat = 35.1595, lng = 126.8526, extra: Record<string, unknown> = {}) => ({ name, lat, lng, ...extra });
const arrive = (app: App, car: Car, seat: Seat, body: unknown) => call(app, 'POST', `/arrivals?driver=${seat.seatId}`, { token: car.carToken, body });
const frequent = (app: App, car: Car, seat: Seat, query = '') => call(app, 'GET', `/places/frequent?driver=${seat.seatId}${query}`, { token: car.carToken });
const names = (res: { body: { candidates: { name: string }[] } }) => res.body.candidates.map((c) => c.name);
const arrivalsOf = (app: App, seat: Seat) => call(app, 'GET', '/places/arrivals', { token: seat.phoneToken });

/** 위도만 `meters`만큼 옮긴 좌표(적도 근처가 아니어도 위도 1도 ≈ 111.19km). */
const northOf = (lat: number, lng: number, meters: number) => ({ lat: lat + meters / 111_195, lng });

describe('장소 동일성(이름 정규화 + 100m)', () => {
  it('상수와 거리 계산', () => {
    expect(SAME_PLACE_METERS).toBe(100);
    expect(FREQUENT_ARRIVALS_OVER).toBe(3);
    expect(HOME_RADIUS_METERS).toBe(300);
    const a = { lat: 35.1595, lng: 126.8526 };
    expect(distanceMeters(a, a)).toBe(0);
    expect(Math.abs(distanceMeters(a, northOf(a.lat, a.lng, 250)) - 250)).toBeLessThan(1);
  });

  it('이름 정규화: 앞뒤·안쪽 공백, 대소문자, 유니코드 정규형을 무시한다', () => {
    expect(normalizeName('  광주   육전집 ')).toBe(normalizeName('광주 육전집'));
    expect(normalizeName('KIA Champions Field')).toBe(normalizeName('kia champions  field'));
    expect(normalizeName('각'.normalize('NFD'))).toBe(normalizeName('각'.normalize('NFC')));
    expect(normalizeName('육전집')).not.toBe(normalizeName('육전 집'));
  });

  it('100m 이내면 같은 곳이고 넘으면 다른 곳이다. 이름이 다르면 좌표가 같아도 다른 곳이다', () => {
    const base = { name: '광주 육전집', lat: 35.1595, lng: 126.8526 };
    expect(samePlace(base, { name: ' 광주  육전집', ...northOf(base.lat, base.lng, 99) })).toBe(true);
    expect(samePlace(base, { name: '광주 육전집', ...northOf(base.lat, base.lng, 101) })).toBe(false);
    expect(samePlace(base, { name: '다른 집', lat: base.lat, lng: base.lng })).toBe(false);
  });
});

describe('POST /arrivals', () => {
  it('도착을 세고 장소·횟수·마지막 날짜(서울)만 돌려준다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const res = await arrive(app, car, seat, { scheduleId: 'e1', place: place('광주 육전집', 35.1595, 126.8526, { address: '광주 서구 상무중앙로 1' }), at: '2026-11-11T08:30:00+09:00' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      counted: true,
      place: { id: expect.any(String), name: '광주 육전집', address: '광주 서구 상무중앙로 1', lat: 35.1595, lng: 126.8526, count: 1, lastDate: '2026-11-11' },
    });
  });

  it('마지막 날짜는 서울 날짜다(서울 자정 직후는 UTC로는 전날)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    clockMs = seoul('2026-11-12T00:30:00'); // UTC 11-11 15:30
    const res = await arrive(app, car, seat, { scheduleId: 'e1', place: place(), at: '2026-11-12T00:20:00+09:00' });
    expect(res.body.place.lastDate).toBe('2026-11-12');
    const before = await arrive(app, car, seat, { scheduleId: 'e2', place: place(), at: '2026-11-11T23:59:59+09:00' });
    expect(before.body.place).toMatchObject({ count: 2, lastDate: '2026-11-12' }); // 마지막 날짜는 뒤로 가지 않는다
  });

  it('주소가 없으면 null이고, at이 없으면 서버 시각을 쓴다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const res = await arrive(app, car, seat, { place: place('단골 콩물집', 35.146, 126.922) });
    expect(res.body.place).toMatchObject({ address: null, lastDate: '2026-11-11', count: 1 });
  });

  it('같은 일정 id의 도착이 다시 오면 중복으로 세지 않는다(멱등). `at`의 날짜가 달라도 한 번이고 다른 일정은 센다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const first = await arrive(app, car, seat, { scheduleId: 'kia', place: place() });
    expect(first.body).toMatchObject({ counted: true, place: { count: 1 } });
    const again = await arrive(app, car, seat, { scheduleId: 'kia', place: place() });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ counted: false, place: { count: 1, id: first.body.place.id } });
    expect((await arrive(app, car, seat, { scheduleId: 'other', place: place() })).body.place.count).toBe(2);
    // 일정 id는 그날의 일정이라, `at`의 날짜(서울)만 바꿔 다시 보내도 다시 세지 않는다(기억이 살아 있는 동안).
    expect((await arrive(app, car, seat, { scheduleId: 'kia', place: place(), at: '2026-11-10T20:00:00+09:00' })).body).toMatchObject({ counted: false, place: { count: 2, lastDate: '2026-11-11' } });
    expect((await arrive(app, car, seat, { scheduleId: 'kia', place: place(), at: '2026-11-11T08:00:00+09:00' })).body.counted).toBe(false);
    // scheduleId가 없으면 부를 때마다 센다.
    expect((await arrive(app, car, seat, { place: place() })).body.place.count).toBe(3);
    expect((await arrive(app, car, seat, { place: place() })).body.place.count).toBe(4);
  });

  it('3일 전 `at`으로 센 도착도 같은 `at`을 다시 보내는 동안은 한 번만 센다(재시도 계약: 처음 `at`을 그대로 보낸다)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const threeDaysAgo = '2026-11-08T09:00:00+09:00'; // 서버 시각(2026-11-11 09:00)의 정확히 3일 전
    const first = await arrive(app, car, seat, { scheduleId: 'old', place: place(), at: threeDaysAgo });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ counted: true, place: { count: 1, lastDate: '2026-11-08' } });
    for (let i = 0; i < 5; i++) {
      const again = await arrive(app, car, seat, { scheduleId: 'old', place: place(), at: threeDaysAgo });
      expect(again.body).toMatchObject({ counted: false, place: { count: 1 } });
    }
    // 같은 일정 id를 `at`의 날짜만 바꿔 보내도 한 번이다.
    for (const at of ['2026-11-09T09:00:00+09:00', '2026-11-10T09:00:00+09:00', '2026-11-11T08:59:00+09:00']) {
      expect((await arrive(app, car, seat, { scheduleId: 'old', place: place(), at })).body.counted).toBe(false);
    }
    expect((await arrivalsOf(app, seat)).body.arrivals).toMatchObject([{ count: 1 }]);
  });

  it('일정 id 기억의 보관 기간은 `at`을 받는 범위(3일 전) 이상이다', () => {
    expect(ARRIVAL_KEY_DAYS * DAY_MS).toBeGreaterThan(ARRIVAL_PAST_LIMIT_MS);
  });

  it('멱등은 일정 id 기준이라 일정 장소가 달라져도 한 번이고, 사용자가 지운 장소는 되살리지 않는다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const first = await arrive(app, car, seat, { scheduleId: 's', place: place('체육관', 35.1527, 126.8483) });
    const moved = await arrive(app, car, seat, { scheduleId: 's', place: place('다른 곳', 35.2, 126.9) });
    expect(moved.body).toMatchObject({ counted: false, place: { name: '체육관', count: 1 } });
    expect((await call(app, 'DELETE', `/places/arrivals/${first.body.place.id}`, { token: seat.phoneToken })).status).toBe(200);
    const after = await arrive(app, car, seat, { scheduleId: 's', place: place('체육관', 35.1527, 126.8483) });
    expect(after.body).toEqual({ counted: false, place: null });
    expect((await arrivalsOf(app, seat)).body.arrivals).toEqual([]);
  });

  it('이름 정규화가 같고 100m 안이면 같은 곳으로 합치고, 넘거나 이름이 다르면 따로 센다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const base = { lat: 35.1681, lng: 126.8888 };
    await arrive(app, car, seat, { place: place('광주-기아 챔피언스필드', base.lat, base.lng) });
    const same = await arrive(app, car, seat, { place: place('  광주-기아  챔피언스필드 ', northOf(base.lat, base.lng, 99).lat, base.lng) });
    expect(same.body.place).toMatchObject({ count: 2, lat: base.lat }); // 처음 좌표를 유지한다(좌표가 떠돌지 않음)
    const far = await arrive(app, car, seat, { place: place('광주-기아 챔피언스필드', northOf(base.lat, base.lng, 101).lat, base.lng) });
    expect(far.body.place.count).toBe(1);
    const renamed = await arrive(app, car, seat, { place: place('챔피언스필드', base.lat, base.lng) });
    expect(renamed.body.place.count).toBe(1);
    expect((await arrivalsOf(app, seat)).body.arrivals).toHaveLength(3);
  });

  it('100m 안에 같은 이름의 곳이 여럿이면 가장 가까운 곳으로 합친다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const a = { lat: 35.15, lng: 126.85 };
    const p0 = await arrive(app, car, seat, { place: place('카페', a.lat, a.lng) });
    const p1 = await arrive(app, car, seat, { place: place('카페', northOf(a.lat, a.lng, 180).lat, a.lng) }); // 180m: 다른 곳
    expect(p1.body.place.id).not.toBe(p0.body.place.id);
    // 85m 지점: p0까지 85m, p1까지 95m — 둘 다 100m 안이지만 더 가까운 p0
    expect((await arrive(app, car, seat, { place: place('카페', northOf(a.lat, a.lng, 85).lat, a.lng) })).body.place.id).toBe(p0.body.place.id);
    // 95m 지점: p0까지 95m, p1까지 85m → p1
    expect((await arrive(app, car, seat, { place: place('카페', northOf(a.lat, a.lng, 95).lat, a.lng) })).body.place.id).toBe(p1.body.place.id);
  });

  it('저장하는 것은 장소·횟수·마지막 날짜뿐이다(시각 이력·일정 id·경로가 응답·목록에 없다)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    await arrive(app, car, seat, { scheduleId: 'secret-id', place: place(), at: '2026-11-11T08:15:30+09:00' });
    const list = (await arrivalsOf(app, seat)).body;
    expect(Object.keys(list.arrivals[0]).sort()).toEqual(['address', 'count', 'id', 'lastDate', 'lat', 'lng', 'name', 'qualifies']);
    expect(JSON.stringify(list)).not.toContain('secret-id');
    expect(JSON.stringify(list)).not.toContain('08:15');
  });

  describe('본문 검증', () => {
    const bad = async (body: unknown, status = 400) => {
      const { app } = setup();
      const { car, seat } = await pairOne(app);
      expect((await arrive(app, car, seat, body)).status).toBe(status);
      expect((await arrivalsOf(app, seat)).body.arrivals).toEqual([]); // 잘못된 요청은 아무것도 세지 않는다
    };
    it.each([
      ['place 없음', {}],
      ['place가 배열', { place: [] }],
      ['이름이 비었음', { place: place('   ') }],
      ['이름이 너무 김', { place: place('가'.repeat(101)) }],
      ['이름이 숫자', { place: { name: 1, lat: 35, lng: 126 } }],
      ['위도 범위 밖', { place: place('a', 91, 126) }],
      ['경도 범위 밖', { place: place('a', 35, 181) }],
      ['좌표가 문자열', { place: { name: 'a', lat: '35', lng: '126' } }],
      ['좌표가 null', { place: { name: 'a', lat: null, lng: null } }],
      ['주소가 너무 김', { place: place('a', 35, 126, { address: '가'.repeat(201) }) }],
      ['주소가 숫자', { place: place('a', 35, 126, { address: 5 }) }],
      ['place에 모르는 키', { place: place('a', 35, 126, { phone: '010' }) }],
      ['본문에 모르는 키', { place: place(), extra: 1 }],
      ['scheduleId가 빈 문자열', { scheduleId: '', place: place() }],
      ['scheduleId가 너무 김', { scheduleId: 'x'.repeat(101), place: place() }],
      ['scheduleId가 숫자', { scheduleId: 7, place: place() }],
      ['at 형식 오류', { place: place(), at: '어제' }],
      ['at 오프셋 없음', { place: place(), at: '2026-11-11T09:00:00' }],
      ['at이 3일보다 과거', { place: place(), at: '2026-11-08T08:59:59+09:00' }],
      ['at이 10분보다 미래', { place: place(), at: '2026-11-11T09:10:01+09:00' }],
      ['본문이 배열', [place()]],
    ])('400: %s', async (_name, body) => bad(body));

    it('경계: at이 정확히 3일 전·10분 뒤면 받는다', async () => {
      const { app } = setup();
      const { car, seat } = await pairOne(app);
      expect((await arrive(app, car, seat, { place: place(), at: '2026-11-08T09:00:00+09:00' })).status).toBe(200);
      expect((await arrive(app, car, seat, { place: place(), at: '2026-11-11T09:10:00+09:00' })).status).toBe(200);
      expect((await arrive(app, car, seat, { place: place('b', 36, 127), at: '2026-11-08T09:00:00+09:00' })).body.place.lastDate).toBe('2026-11-08');
    });

    it('413: 본문이 너무 크면 거절한다', async () => {
      await bad({ place: place('a', 35, 126, { address: 'x'.repeat(70_000) }) }, 413);
    });
  });

  describe('누가 부를 수 있는가(옛 차 앱 호환 읽기 없음)', () => {
    it('차 토큰 + driver가 필수다: driver 없음 400, 남의 자리 403, 모르는 토큰 401', async () => {
      const { app } = setup();
      const { car, seat } = await pairOne(app);
      const other = await pairOne(app, '다른 폰');
      expect((await call(app, 'POST', '/arrivals', { token: car.carToken, body: { place: place() } })).status).toBe(400);
      expect((await call(app, 'POST', '/arrivals', { token: car.carToken, body: { place: place() } })).body.reason).toBe('driver-required');
      expect((await call(app, 'POST', `/arrivals?driver=${other.seat.seatId}`, { token: car.carToken, body: { place: place() } })).status).toBe(403);
      expect((await call(app, 'POST', `/arrivals?driver=${seat.seatId}`, { token: 'f'.repeat(64), body: { place: place() } })).status).toBe(401);
      expect((await arrivalsOf(app, seat)).body.arrivals).toEqual([]);
      expect((await arrivalsOf(app, other.seat)).body.arrivals).toEqual([]);
    });

    it('폰 토큰은 거절한다(403): 도착 기록은 차만 보낸다', async () => {
      const { app } = setup();
      const { seat } = await pairOne(app);
      expect((await call(app, 'POST', '/arrivals', { token: seat.phoneToken, body: { place: place() } })).status).toBe(403);
      expect((await call(app, 'POST', `/arrivals?driver=${seat.seatId}`, { token: seat.phoneToken, body: { place: place() } })).status).toBe(403);
      expect((await arrivalsOf(app, seat)).body.arrivals).toEqual([]);
    });

    it('자리 있는 서버에서 식별 없음·기기 id만은 401이고 연결 전 버킷을 만들지 않는다. 자리가 하나뿐이어도 그 자리로 새지 않는다', async () => {
      const { app, registry } = setup();
      const { seat } = await pairOne(app);
      const device = 'z'.repeat(32);
      expect((await call(app, 'POST', '/arrivals', { body: { place: place() } })).status).toBe(401);
      expect((await call(app, 'POST', '/arrivals', { device, body: { place: place() } })).status).toBe(401);
      expect(registry.peekBucket(device)).toBeNull();
      expect((await arrivalsOf(app, seat)).body.arrivals).toEqual([]);
    });

    it('자리 있는 차가 하나도 없는 서버(데모·E2E)의 식별 없는 요청만 기본 자리에 기록한다', async () => {
      const { app } = setup();
      const res = await call(app, 'POST', '/arrivals', { body: { place: place() } });
      expect(res.status).toBe(200);
      expect(res.body.place.count).toBe(1);
      expect((await call(app, 'GET', '/places/arrivals')).body.arrivals).toHaveLength(1);
      // 차 토큰만 있고 자리가 없는 차는 driver를 줄 수 없어 쓰지 못한다.
      const car = await registerCar(app);
      expect((await call(app, 'POST', '/arrivals', { token: car.carToken, body: { place: place() } })).status).toBe(400);
    });

    it('legacyDriverFallback을 켜 둔 채(기본)여도 호환 읽기를 적용하지 않는다', async () => {
      const { app } = setup({ legacyDriverFallback: true });
      const { car, seat } = await pairOne(app);
      await arrive(app, car, seat, { place: place() });
      for (let i = 0; i < 4; i++) await arrive(app, car, seat, { place: place() });
      // 식별 없는 읽기는 빈 범위, 차 토큰만(driver 없음)은 400
      expect((await call(app, 'GET', '/places/frequent')).body.candidates).toEqual([]);
      expect((await call(app, 'GET', '/places/arrivals')).body.arrivals).toEqual([]);
      expect((await call(app, 'GET', '/places/frequent', { token: car.carToken })).status).toBe(400);
      expect((await frequent(app, car, seat)).body.candidates).toHaveLength(1);
    });
  });
});

describe('GET /places/frequent: 자주 가는 곳 후보', () => {
  it('도착 3회는 후보가 아니고 4회부터 올라온다(등록하지 않은 곳)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    for (let i = 1; i <= 3; i++) await arrive(app, car, seat, { scheduleId: `g${i}`, place: place('체육관', 35.1527, 126.8483) });
    expect(names(await frequent(app, car, seat))).toEqual([]);
    expect((await arrivalsOf(app, seat)).body.arrivals[0]).toMatchObject({ count: 3, qualifies: false });
    await arrive(app, car, seat, { scheduleId: 'g4', place: place('체육관', 35.1527, 126.8483, { address: '광주 서구 운동로 7' }) });
    const res = await frequent(app, car, seat);
    expect(res.body).toEqual({
      candidates: [{ kind: 'other', source: 'arrivals', name: '체육관', address: '광주 서구 운동로 7', lat: 35.1527, lng: 126.8483, arrivalCount: 4 }],
      threshold: 3,
      homeExcluded: false,
    });
    expect((await arrivalsOf(app, seat)).body.arrivals[0]).toMatchObject({ count: 4, qualifies: true });
  });

  it('폰 앱에서 등록한 집·회사·단골이 먼저 있고, 도착 횟수가 없으면 등록한 순서 그대로다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const t = seat.phoneToken;
    await call(app, 'POST', '/places/favorites/others', { token: t, body: { placeId: 'mock-station' } });
    await call(app, 'PUT', '/places/favorites/work', { token: t, body: { placeId: 'mock-work-gwangju' } });
    await call(app, 'PUT', '/places/favorites/home', { token: t, body: { placeId: 'mock-home-apt' } });
    await arrive(app, car, seat, { place: place('광주송정역', 35.1378, 126.7912) }); // 1회뿐
    const res = await frequent(app, car, seat);
    expect(res.body.candidates.map((c: { kind: string; source: string; arrivalCount: number }) => [c.kind, c.source, c.arrivalCount])).toEqual([
      ['home', 'favorite', 0],
      ['work', 'favorite', 0],
      ['other', 'both', 1],
    ]);
  });

  it('1순위는 도착 횟수가 가장 많은 곳이고, 등록한 곳과 같은 곳은 합쳐 한 번만 나온다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const t = seat.phoneToken;
    await call(app, 'PUT', '/places/favorites/home', { token: t, body: { placeId: 'mock-home-apt' } });
    await call(app, 'PUT', '/places/favorites/work', { token: t, body: { placeId: 'mock-work-gwangju' } });
    const times = async (n: number, p: ReturnType<typeof place>, tag: string) => {
      for (let i = 0; i < n; i++) await arrive(app, car, seat, { scheduleId: `${tag}${i}`, place: p });
    };
    await times(4, place('단골 콩물집', 35.146, 126.922), 'k'); // 4: 등록 안 한 곳
    await times(6, place('광주-기아 챔피언스필드', 35.1681, 126.8888), 'c'); // 6: 등록 안 한 곳, 최다
    await times(5, place(' 광주 예시 업무지구 ', 35.1531, 126.8514), 'w'); // 5: 등록한 회사와 같은 곳
    await times(2, place('예시 아파트 101동', 35.1743, 126.9121), 'h'); // 2: 등록한 집, 기준 이하
    const res = await frequent(app, car, seat);
    expect(res.body.candidates.map((c: { name: string; kind: string; arrivalCount: number; source: string }) => [c.name, c.kind, c.arrivalCount, c.source])).toEqual([
      ['광주-기아 챔피언스필드', 'other', 6, 'arrivals'],
      ['광주 예시 업무지구', 'work', 5, 'both'], // 합쳐져 회사 종류와 등록한 이름을 유지
      ['단골 콩물집', 'other', 4, 'arrivals'],
      ['예시 아파트 101동', 'home', 2, 'both'], // 기준 이하는 순서를 바꾸지 않고 뒤로
    ]);
  });

  it('도착 횟수가 같으면 마지막 날짜가 가까운 곳이 앞이다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    for (let i = 0; i < 4; i++) await arrive(app, car, seat, { scheduleId: `a${i}`, place: place('A', 35.1, 126.1), at: '2026-11-09T10:00:00+09:00' });
    for (let i = 0; i < 4; i++) await arrive(app, car, seat, { scheduleId: `b${i}`, place: place('B', 35.2, 126.2), at: '2026-11-10T10:00:00+09:00' });
    expect(names(await frequent(app, car, seat))).toEqual(['B', 'A']);
  });

  describe('현재 위치가 집이면 집을 뺀다', () => {
    const home = { lat: 35.1743, lng: 126.9121 };
    const withHome = async () => {
      const s = setup();
      const { car, seat } = await pairOne(s.app);
      await call(s.app, 'PUT', '/places/favorites/home', { token: seat.phoneToken, body: { placeId: 'mock-home-apt' } });
      await call(s.app, 'PUT', '/places/favorites/work', { token: seat.phoneToken, body: { placeId: 'mock-work-gwangju' } });
      for (let i = 0; i < 5; i++) await arrive(s.app, car, seat, { scheduleId: `h${i}`, place: place('예시 아파트 101동', home.lat, home.lng) }); // 집이 최다 도착
      return { ...s, car, seat };
    };
    const q = (p: { lat: number; lng: number }) => `&lat=${p.lat}&lng=${p.lng}`;

    it('집이 1순위여도 집 반경(300m) 안이면 빼고, 밖이면 둔다', async () => {
      const { app, car, seat } = await withHome();
      expect(names(await frequent(app, car, seat))).toEqual(['예시 아파트 101동', '광주 예시 업무지구']);
      const inside = await frequent(app, car, seat, q(northOf(home.lat, home.lng, 299)));
      expect(names(inside)).toEqual(['광주 예시 업무지구']);
      expect(inside.body.homeExcluded).toBe(true);
      const outside = await frequent(app, car, seat, q(northOf(home.lat, home.lng, 301)));
      expect(names(outside)).toEqual(['예시 아파트 101동', '광주 예시 업무지구']);
      expect(outside.body.homeExcluded).toBe(false);
      expect(names(await frequent(app, car, seat, q(home)))).toEqual(['광주 예시 업무지구']);
    });

    it('집이 아닌 곳(회사·도착 횟수로 올라온 곳)은 현재 위치와 가까워도 빼지 않는다', async () => {
      const { app, car, seat } = await withHome();
      const work = { lat: 35.1531, lng: 126.8514 };
      expect(names(await frequent(app, car, seat, q(work)))).toEqual(['예시 아파트 101동', '광주 예시 업무지구']);
    });

    it('lat·lng는 함께 올바른 숫자로 보내야 한다(400)', async () => {
      const { app, car, seat } = await withHome();
      for (const bad of ['&lat=35.1', '&lng=126.9', '&lat=abc&lng=126.9', '&lat=95&lng=126.9', '&lat=35.1&lng=181', '&lat=&lng=', '&lat=1&lat=2&lng=3']) {
        expect((await frequent(app, car, seat, bad)).status, bad).toBe(400);
      }
    });
  });

  it('자리끼리 격리된다: 다른 자리의 도착·등록은 후보에 섞이지 않는다', async () => {
    const { app } = setup();
    const a = await pairOne(app, '폰A');
    const b = await pairOne(app, '폰B');
    for (let i = 0; i < 5; i++) await arrive(app, a.car, a.seat, { scheduleId: `x${i}`, place: place('A만 가는 곳', 35.3, 126.3) });
    await call(app, 'PUT', '/places/favorites/home', { token: a.seat.phoneToken, body: { placeId: 'mock-home-apt' } });
    expect(names(await frequent(app, a.car, a.seat))).toEqual(['A만 가는 곳', '예시 아파트 101동']);
    expect(names(await frequent(app, b.car, b.seat))).toEqual([]);
    expect((await arrivalsOf(app, b.seat)).body.arrivals).toEqual([]);
    // 같은 차의 다른 자리도 따로다.
    const a2 = await connectPhone(app, a.car, '폰A2');
    expect(names(await frequent(app, a.car, a2))).toEqual([]);
    // 남의 자리를 driver로 지정할 수 없다.
    expect((await call(app, 'GET', `/places/frequent?driver=${b.seat.seatId}`, { token: a.car.carToken })).status).toBe(403);
    expect((await call(app, 'POST', `/arrivals?driver=${b.seat.seatId}`, { token: a.car.carToken, body: { place: place() } })).status).toBe(403);
  });

  it('폰 토큰으로도 읽을 수 있고(그 자리), 식별 없음·기기 id만은 빈 후보다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    for (let i = 0; i < 4; i++) await arrive(app, car, seat, { scheduleId: `p${i}`, place: place('체육관', 35.1527, 126.8483) });
    expect(names(await call(app, 'GET', '/places/frequent', { token: seat.phoneToken }))).toEqual(['체육관']);
    expect(names(await call(app, 'GET', '/places/frequent', { device: 'q'.repeat(32) }))).toEqual([]);
    expect(names(await call(app, 'GET', '/places/frequent'))).toEqual([]);
  });
});

describe('GET·DELETE /places/arrivals: 폰이 보고 지우기', () => {
  it('횟수 많은 순으로 보이고, 장소 하나씩 지운다(지운 장소는 후보에서도 빠진다)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    for (let i = 0; i < 5; i++) await arrive(app, car, seat, { scheduleId: `a${i}`, place: place('A', 35.1, 126.1) });
    for (let i = 0; i < 2; i++) await arrive(app, car, seat, { scheduleId: `b${i}`, place: place('B', 35.2, 126.2) });
    const list = (await arrivalsOf(app, seat)).body;
    expect(list.threshold).toBe(3);
    expect(list.arrivals.map((p: { name: string; count: number; qualifies: boolean }) => [p.name, p.count, p.qualifies])).toEqual([['A', 5, true], ['B', 2, false]]);
    expect(names(await frequent(app, car, seat))).toEqual(['A']);
    const id = list.arrivals[0].id;
    expect((await call(app, 'DELETE', `/places/arrivals/${id}`, { token: seat.phoneToken })).body).toEqual({ removed: true, id });
    expect((await arrivalsOf(app, seat)).body.arrivals.map((p: { name: string }) => p.name)).toEqual(['B']);
    expect(names(await frequent(app, car, seat))).toEqual([]);
    expect((await call(app, 'DELETE', `/places/arrivals/${id}`, { token: seat.phoneToken })).status).toBe(404);
  });

  it('다른 자리의 기록은 id를 알아도 지울 수 없다', async () => {
    const { app } = setup();
    const a = await pairOne(app, '폰A');
    const b = await pairOne(app, '폰B');
    const made = await arrive(app, a.car, a.seat, { place: place() });
    expect((await call(app, 'DELETE', `/places/arrivals/${made.body.place.id}`, { token: b.seat.phoneToken })).status).toBe(404);
    expect((await arrivalsOf(app, a.seat)).body.arrivals).toHaveLength(1);
  });

  it('차 토큰은 목록·삭제 모두 403이다(폰에서만 지운다)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    const made = await arrive(app, car, seat, { place: place() });
    expect((await call(app, 'GET', `/places/arrivals?driver=${seat.seatId}`, { token: car.carToken })).status).toBe(403);
    expect((await call(app, 'DELETE', `/places/arrivals/${made.body.place.id}?driver=${seat.seatId}`, { token: car.carToken })).status).toBe(403);
    expect((await arrivalsOf(app, seat)).body.arrivals).toHaveLength(1);
  });

  it('토큰이 없는 폰(기기 id만·식별 없음)은 빈 목록이고 지우기는 404이며 버킷을 만들지 않는다. 모르는 토큰은 401', async () => {
    const { app, registry } = setup();
    const { car, seat } = await pairOne(app);
    await arrive(app, car, seat, { place: place() });
    const device = 'm'.repeat(32);
    expect((await call(app, 'GET', '/places/arrivals', { device })).body.arrivals).toEqual([]);
    expect((await call(app, 'DELETE', '/places/arrivals/a1', { device })).status).toBe(404);
    expect(registry.peekBucket(device)).toBeNull();
    expect((await call(app, 'GET', '/places/arrivals')).body.arrivals).toEqual([]);
    expect((await call(app, 'GET', '/places/arrivals', { token: 'e'.repeat(64) })).status).toBe(401);
    expect((await call(app, 'DELETE', '/places/arrivals/a1', { token: 'e'.repeat(64) })).status).toBe(401);
  });
});

describe('폰 바꾸기는 유지, 연결 끊기는 삭제', () => {
  it('폰 바꾸기 뒤에도 도착 횟수와 후보가 그대로다(새 폰 토큰으로 본다)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    for (let i = 0; i < 4; i++) await arrive(app, car, seat, { scheduleId: `r${i}`, place: place('체육관', 35.1527, 126.8483) });
    const issued = await call(app, 'POST', '/pair/code', { token: car.carToken, body: { mode: 'replace', seatId: seat.seatId } });
    const claimed = await call(app, 'POST', '/pair/claim', { body: { code: issued.body.code, name: '새 폰' } });
    expect(claimed.body.mode).toBe('replace');
    expect((await arrivalsOf(app, seat)).status).toBe(401); // 옛 폰 토큰은 무효
    const list = await arrivalsOf(app, { seatId: seat.seatId, phoneToken: claimed.body.phoneToken });
    expect(list.body.arrivals).toMatchObject([{ name: '체육관', count: 4 }]);
    expect(names(await frequent(app, car, seat))).toEqual(['체육관']);
    // 같은 일정의 도착은 폰 바꾸기 뒤에도 중복으로 세지 않는다.
    expect((await arrive(app, car, seat, { scheduleId: 'r0', place: place('체육관', 35.1527, 126.8483) })).body).toMatchObject({ counted: false, place: { count: 4 } });
  });

  it('연결 끊기·차곡 초기화는 도착 횟수를 지우고, 같은 차에 새로 연결한 자리는 이어받지 않는다', async () => {
    for (const who of ['phone', 'car'] as const) {
      const { app } = setup();
      const { car, seat } = await pairOne(app);
      for (let i = 0; i < 4; i++) await arrive(app, car, seat, { scheduleId: `d${i}`, place: place('체육관', 35.1527, 126.8483) });
      const res = who === 'phone' ? await call(app, 'DELETE', '/pair', { token: seat.phoneToken }) : await call(app, 'DELETE', '/car', { token: car.carToken });
      expect(res.status).toBe(200);
      expect((await arrive(app, car, seat, { place: place() })).status).toBe(403); // 지워진 자리는 driver로 쓸 수 없다
      const again = await connectPhone(app, car, '다시');
      expect((await arrivalsOf(app, again)).body.arrivals).toEqual([]);
      expect(names(await frequent(app, car, again))).toEqual([]);
    }
  });
});

describe('GET /schedules/today의 favorites 호환', () => {
  const at = encodeURIComponent('2026-11-06T09:20:00+09:00');
  const today = (app: App, seat: Seat, car: Car) => call(app, 'GET', `/schedules/today?at=${at}&driver=${seat.seatId}`, { token: car.carToken });

  it('도착 횟수 기능을 쓰지 않은 응답은 변하지 않는다(필드·순서·항목 모양)', async () => {
    const withArrivals = setup();
    const without = setup();
    const a = await pairOne(withArrivals.app);
    const b = await pairOne(without.app);
    for (const [app, s] of [[withArrivals.app, a], [without.app, b]] as const) {
      await call(app, 'PUT', '/places/favorites/home', { token: s.seat.phoneToken, body: { placeId: 'mock-home-apt' } });
      await call(app, 'PUT', '/places/favorites/work', { token: s.seat.phoneToken, body: { placeId: 'mock-work-gwangju' } });
      await call(app, 'POST', '/places/favorites/others', { token: s.seat.phoneToken, body: { placeId: 'mock-station' } });
    }
    // 기준(3회) 이하의 도착(등록한 곳 포함)은 목록을 바꾸지 않는다.
    for (let i = 0; i < 3; i++) await arrive(withArrivals.app, a.car, a.seat, { scheduleId: `s${i}`, place: place('광주송정역', 35.1378, 126.7912) });
    await arrive(withArrivals.app, a.car, a.seat, { place: place('체육관', 35.1527, 126.8483) });
    const before = (await today(without.app, b.seat, b.car)).body;
    const after = (await today(withArrivals.app, a.seat, a.car)).body;
    expect(after.favorites).toEqual(before.favorites);
    expect(after).toEqual(before);
    expect(after.favorites.map((f: { kind: string }) => f.kind)).toEqual(['home', 'work', 'other']);
  });

  it('픽스처 응답(기본 자리·데모 경로)은 도착 기록이 있어도 그대로다. 4회 이상 도착해도 같다', async () => {
    const plain = setup();
    const recorded = setup();
    for (let i = 0; i < 6; i++) expect((await call(recorded.app, 'POST', '/arrivals', { body: { place: place('데모 장소') } })).status).toBe(200); // 기본 자리의 도착 6회
    const a = (await call(plain.app, 'GET', `/schedules/today?at=${at}`)).body;
    const b = (await call(recorded.app, 'GET', `/schedules/today?at=${at}`)).body;
    expect(b).toEqual(a);
    expect(b.favorites).toEqual([]);
    // 후보 API(`/places/frequent`)는 기본 자리에서도 도착 횟수를 보여 준다(새 API라 옛 호환이 아니다).
    expect(names(await call(recorded.app, 'GET', '/places/frequent'))).toEqual(['데모 장소']);
  });

  describe('도착 기반 장소는 명시 식별로 정해진 자리에서만 favorites에 반영한다(옛 호환 읽기에는 섞지 않는다)', () => {
    const arrived4 = async (app: App, car: Car, seat: Seat) => {
      for (let i = 0; i < 4; i++) expect((await arrive(app, car, seat, { scheduleId: `h${i}`, place: place('비밀 병원', 35.2, 126.9) })).status).toBe(200);
    };
    const favNames = (res: { body: { favorites: { name: string }[] } }) => res.body.favorites.map((f) => f.name);

    it('식별 없는 읽기·차 토큰만(driver 없음)은 등록한 곳만 주고, 차 토큰 + driver·폰 토큰은 도착 횟수를 반영한다', async () => {
      const { app } = setup();
      const { car, seat } = await pairOne(app);
      await call(app, 'PUT', '/places/favorites/home', { token: seat.phoneToken, body: { placeId: 'mock-home-apt' } });
      await arrived4(app, car, seat);
      // 자리가 하나뿐이라 옛 호환이 그 자리로 읽어 주지만(legacyDriverFallback), 등록한 곳만 준다.
      expect(favNames(await call(app, 'GET', '/schedules/today'))).toEqual(['예시 아파트 101동']);
      expect(favNames(await call(app, 'GET', '/schedules/today', { token: car.carToken }))).toEqual(['예시 아파트 101동']);
      // 명시 식별: 반영한다.
      expect(favNames(await call(app, 'GET', `/schedules/today?driver=${seat.seatId}`, { token: car.carToken }))).toEqual(['비밀 병원', '예시 아파트 101동']);
      expect(favNames(await call(app, 'GET', '/schedules/today', { token: seat.phoneToken }))).toEqual(['비밀 병원', '예시 아파트 101동']);
    });

    it('등록한 곳이 없으면 옛 호환 읽기에서 favorites는 빈 배열이다(탐침 p2: 도착 장소가 새지 않는다)', async () => {
      const { app } = setup();
      const { car, seat } = await pairOne(app);
      await arrived4(app, car, seat);
      expect((await call(app, 'GET', '/schedules/today')).body.favorites).toEqual([]);
      expect((await call(app, 'GET', '/schedules/today', { token: car.carToken })).body.favorites).toEqual([]);
      expect((await call(app, 'GET', '/places/frequent')).body.candidates).toEqual([]);
      expect(names(await frequent(app, car, seat))).toEqual(['비밀 병원']);
    });

    it('기기 id 버킷·자리가 여럿이라 정할 수 없는 읽기에도 도착 장소가 섞이지 않는다', async () => {
      const { app } = setup();
      const a = await pairOne(app, '폰A');
      const b = await pairOne(app, '폰B');
      await arrived4(app, a.car, a.seat);
      expect((await call(app, 'GET', '/schedules/today')).body.favorites).toEqual([]);
      expect((await call(app, 'GET', '/schedules/today', { device: 'd'.repeat(32) })).body.favorites).toEqual([]);
      expect(favNames(await call(app, 'GET', `/schedules/today?driver=${b.seat.seatId}`, { token: b.car.carToken }))).toEqual([]);
      expect(favNames(await call(app, 'GET', `/schedules/today?driver=${a.seat.seatId}`, { token: a.car.carToken }))).toEqual(['비밀 병원']);
    });
  });

  it('DELETE /events(같은 기기)는 기본 자리의 도착 횟수도 비우고, 실제 자리의 도착 횟수는 건드리지 않는다', async () => {
    const demo = setup({ isLoopback: () => true });
    for (let i = 0; i < 4; i++) await call(demo.app, 'POST', '/arrivals', { body: { place: place('데모 장소') } });
    expect(names(await call(demo.app, 'GET', '/places/frequent'))).toEqual(['데모 장소']);
    expect((await demo.app.request('/events', { method: 'DELETE' })).status).toBe(200);
    expect((await call(demo.app, 'GET', '/places/frequent')).body.candidates).toEqual([]);
    // 같은 서버에 자리가 생기면 폰 토큰으로 지운 것은 그 자리의 일정뿐이다.
    const real = setup({ isLoopback: () => true });
    const { car, seat } = await pairOne(real.app);
    for (let i = 0; i < 4; i++) await arrive(real.app, car, seat, { scheduleId: `r${i}`, place: place('내 단골') });
    expect((await call(real.app, 'DELETE', '/events', { token: seat.phoneToken })).status).toBe(200);
    expect(names(await frequent(real.app, car, seat))).toEqual(['내 단골']);
  });

  it('도착 횟수가 3회를 넘은 곳은 같은 정렬 결과로 favorites 앞에 올라오고, 항목 모양은 그대로다', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    await call(app, 'PUT', '/places/favorites/home', { token: seat.phoneToken, body: { placeId: 'mock-home-apt' } });
    for (let i = 0; i < 4; i++) await arrive(app, car, seat, { scheduleId: `t${i}`, place: place('체육관', 35.1527, 126.8483, { address: '광주 서구 운동로 7' }) });
    const favorites = (await today(app, seat, car)).body.favorites;
    expect(favorites).toEqual([
      { kind: 'other', name: '체육관', address: '광주 서구 운동로 7', lat: 35.1527, lng: 126.8483 },
      { kind: 'home', name: '예시 아파트 101동', address: '광주 북구 샘플로 12', lat: 35.1743, lng: 126.9121 },
    ]);
    for (const f of favorites) expect(Object.keys(f).sort()).toEqual(['address', 'kind', 'lat', 'lng', 'name']);
    const frequentNow = (await frequent(app, car, seat)).body.candidates;
    expect(favorites.map((f: { name: string }) => f.name)).toEqual(frequentNow.map((c: { name: string }) => c.name));
  });

  it('주소를 모르는 도착 장소는 address가 빈 문자열이다(차 앱은 address를 문자열로 읽는다)', async () => {
    const { app } = setup();
    const { car, seat } = await pairOne(app);
    for (let i = 0; i < 4; i++) await arrive(app, car, seat, { scheduleId: `n${i}`, place: place('이름만 아는 곳', 35.5, 126.5) });
    expect((await today(app, seat, car)).body.favorites).toEqual([{ kind: 'other', name: '이름만 아는 곳', address: '', lat: 35.5, lng: 126.5 }]);
  });
});

describe('저장소 상한', () => {
  const at = (day: number) => new Date(seoul('2026-01-01T12:00:00') + day * DAY_MS);
  const record = (store: ReturnType<typeof createArrivalsStore>, i: number, day: number, scheduleId: string | null = null) =>
    store.record({ name: `장소${i}`, address: null, lat: 35 + i * 0.01, lng: 126, scheduleId, at: at(day) });

  it(`장소는 ${MAX_ARRIVAL_PLACES}곳까지이고 넘으면 가장 오래 안 간 곳부터 지운다`, () => {
    clockMs = at(200).getTime();
    const store = createArrivalsStore(now);
    for (let i = 0; i < MAX_ARRIVAL_PLACES; i++) record(store, i, i); // 장소i의 마지막 날짜는 i일째
    expect(store.list()).toHaveLength(MAX_ARRIVAL_PLACES);
    record(store, 1000, 150); // 새 곳: 가장 오래된 장소0이 밀려난다
    const list = store.list();
    expect(list).toHaveLength(MAX_ARRIVAL_PLACES);
    expect(list.some((p) => p.name === '장소0')).toBe(false);
    expect(list.some((p) => p.name === '장소1')).toBe(true);
    expect(list.some((p) => p.name === '장소1000')).toBe(true);
    // 이미 있는 곳을 다시 세면 마지막 날짜가 갱신돼 밀려나지 않는다.
    record(store, 1, 160);
    record(store, 1001, 170);
    expect(store.list().some((p) => p.name === '장소1')).toBe(true);
    expect(store.list().some((p) => p.name === '장소2')).toBe(false);
  });

  it('마지막 날짜가 같으면 횟수가 적은 곳을 먼저 지운다', () => {
    clockMs = at(10).getTime();
    const store = createArrivalsStore(now);
    for (let i = 0; i < MAX_ARRIVAL_PLACES; i++) record(store, i, 5);
    record(store, 7, 5); // 장소7만 2회
    record(store, 8, 5);
    record(store, 1000, 6);
    const kept = store.list().map((p) => p.name);
    expect(kept).toContain('장소7');
    expect(kept).toContain('장소8');
    expect(kept).not.toContain('장소0'); // 횟수 1회 중 가장 먼저 만든 것
    expect(kept).toHaveLength(MAX_ARRIVAL_PLACES);
  });

  it(`같은 일정 기억은 ${MAX_ARRIVAL_KEYS}개까지이고 넘으면 가장 오래된 것부터 잊는다`, () => {
    clockMs = at(1).getTime();
    const store = createArrivalsStore(now);
    for (let i = 0; i <= MAX_ARRIVAL_KEYS; i++) store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: `s${i}`, at: at(1) });
    expect(store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: `s${MAX_ARRIVAL_KEYS}`, at: at(1) }).counted).toBe(false); // 최근 것은 기억
    expect(store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 's0', at: at(1) }).counted).toBe(true); // 가장 오래된 것은 잊음
  });

  it(`일정 기억은 처음 센 날짜가 ${ARRIVAL_KEY_DAYS}일 넘게 지나면 버린다. 3일 뒤(받는 범위의 끝)까지는 확실히 남는다`, () => {
    clockMs = at(1).getTime();
    const store = createArrivalsStore(now);
    store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 's', at: at(1) });
    clockMs = at(1 + 3).getTime(); // 같은 `at`을 보낼 수 있는 마지막 시각(3일 뒤)
    expect(store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 's', at: at(1) }).counted).toBe(false);
    clockMs = at(1 + ARRIVAL_KEY_DAYS).getTime(); // 마지막 날까지는 기억
    expect(store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 's', at: at(1) }).counted).toBe(false);
    clockMs = at(2 + ARRIVAL_KEY_DAYS).getTime();
    expect(store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 's', at: at(1) }).counted).toBe(true);
  });

  it('purgeExpired는 낡은 일정 id 기억만 버리고 도착 횟수(장소·횟수)는 남긴다', () => {
    clockMs = at(1).getTime();
    const store = createArrivalsStore(now);
    store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 'a', at: at(1) });
    store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 'b', at: at(3) });
    clockMs = at(2 + ARRIVAL_KEY_DAYS).getTime(); // a만 낡았다
    expect(store.purgeExpired()).toBe(1);
    expect(store.purgeExpired()).toBe(0);
    expect(store.list()).toMatchObject([{ count: 2 }]);
    expect(store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 'b', at: at(3) }).counted).toBe(false);
    expect(store.record({ name: '곳', address: null, lat: 35, lng: 126, scheduleId: 'a', at: at(1) }).counted).toBe(true);
  });

  it('상한에서 자주 가는 곳 기준(3회)을 넘은 곳은 한 번만 간 곳보다 나중에 밀려난다', () => {
    clockMs = at(200).getTime();
    const store = createArrivalsStore(now);
    // 장소0은 가장 오래 전(0일째)에 4회 갔고, 나머지는 한 번만 갔다.
    for (let k = 0; k < FREQUENT_ARRIVALS_OVER + 1; k++) record(store, 0, 0);
    for (let i = 1; i < MAX_ARRIVAL_PLACES; i++) record(store, i, i);
    record(store, 1000, 150); // 새 곳: 가장 오래된 곳은 장소0이지만 기준을 넘었으므로 한 번만 간 장소1이 밀려난다
    const names = store.list().map((p) => p.name);
    expect(names).toContain('장소0');
    expect(names).not.toContain('장소1');
    expect(names).toHaveLength(MAX_ARRIVAL_PLACES);
    // 모두 기준을 넘었으면 그중 가장 오래 안 간 곳이 밀려난다.
    const all = createArrivalsStore(now);
    for (let i = 0; i < MAX_ARRIVAL_PLACES; i++) for (let k = 0; k < FREQUENT_ARRIVALS_OVER + 1; k++) record(all, i, i);
    record(all, 1000, 150);
    expect(all.list().some((p) => p.name === '장소0')).toBe(false);
    expect(all.list().some((p) => p.name === '장소1')).toBe(true);
  });
});

describe('후보 계산(단위)', () => {
  it('저장된 자주 가는 곳은 목 장소 id로도, 이미 풀린 장소(스냅숏)로도 받는다', () => {
    const catalog = new Map([['mock-a', { name: 'A', address: '가', lat: 35, lng: 126 }]]);
    const snapshot = { id: 'ext:1', name: 'B', address: '나', lat: 36, lng: 127 };
    expect(favoriteSpots(catalog, { home: 'mock-a', work: null, others: [] })).toEqual([{ kind: 'home', name: 'A', address: '가', lat: 35, lng: 126 }]);
    expect(favoriteSpots(catalog, { home: null, work: snapshot, others: ['mock-a', snapshot] }).map((f) => [f.kind, f.name])).toEqual([['work', 'B'], ['other', 'A'], ['other', 'B']]);
  });

  const fav = (kind: 'home' | 'work' | 'other', name: string, lat: number) => ({ kind, name, address: '주소', lat, lng: 126 });
  const arr = (name: string, lat: number, count: number, lastDate = '2026-11-10') => ({ id: name, name, address: null, lat, lng: 126, count, lastDate });

  it('3회는 아니고 4회부터, 등록한 곳과 합쳐지면 한 번만', () => {
    expect(rankCandidates([], [arr('A', 35, 3)])).toEqual([]);
    expect(rankCandidates([], [arr('A', 35, 4)]).map((c) => c.name)).toEqual(['A']);
    const merged = rankCandidates([fav('home', 'A', 35)], [arr('a', 35.0005, 4)]);
    expect(merged).toEqual([{ kind: 'home', name: 'A', address: '주소', lat: 35, lng: 126, arrivalCount: 4, source: 'both' }]);
  });

  it('기준을 넘은 곳이 없으면 등록한 순서 그대로다', () => {
    const list = [fav('home', 'H', 35), fav('work', 'W', 36), fav('other', 'O', 37)];
    expect(rankCandidates(list, [arr('W', 36, 3), arr('Z', 38, 2)]).map((c) => c.name)).toEqual(['H', 'W', 'O']);
  });

  it('집 제외는 집 종류만, 반경 안에서만', () => {
    const list = rankCandidates([fav('home', 'H', 35), fav('work', 'W', 35)], []);
    expect(withoutCurrentHome(list, { lat: 35, lng: 126 }).candidates.map((c) => c.name)).toEqual(['W']);
    expect(withoutCurrentHome(list, northOf(35, 126, 300 - 1)).homeExcluded).toBe(true);
    expect(withoutCurrentHome(list, northOf(35, 126, 300 + 1)).homeExcluded).toBe(false);
  });
});
