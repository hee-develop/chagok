import { describe, expect, it, vi } from 'vitest';
import { LONG_STAY_MINUTES, MAX_CANDIDATES, MAX_STAY_MINUTES } from '../src/energy/constants.js';
import {
  createFixtureChargerSource,
  createFixtureFuelSource,
  createFixtureRestStopSource,
  parseChargerFixture,
  parseFuelFixture,
  parseRestStopFixture,
} from '../src/energy/fixtureSources.js';
import { isMealTimeSeoul, type EnergyOptions } from '../src/energy/options.js';
import { createRateLimiter } from '../src/energy/rateLimit.js';
import type { Charger, ChargerSource, EnergySources, FuelStation, FuelStationSource, NearInfo, RestStop } from '../src/energy/types.js';
import { MAX_BODY_BYTES } from '../src/limits.js';
import { createApp } from '../src/app.js';
import { calendars, catalog, energyFixtures, familyMembers, fixture, fixtureEnergy, newApp } from './helpers.js';

const GWANGJU = { lat: 35.1595, lng: 126.8526 }; // 광주 육전집
const KIA = { lat: 35.1681, lng: 126.8888 }; // 챔피언스필드
const GYM = { lat: 35.1527, lng: 126.8483 };
const SEOUL_TOWER = { lat: 37.5012, lng: 127.0396 };
const NOON = '2026-11-06T12:00:00+09:00';
const AFTERNOON = '2026-11-06T15:00:00+09:00';

const post = (target: ReturnType<typeof newApp>, body: unknown, raw = false) =>
  target.request('/energy/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
const ok = async (target: ReturnType<typeof newApp>, body: unknown) => {
  const res = await post(target, body);
  expect(res.status).toBe(200);
  return (await res.json()) as EnergyOptions;
};
const ids = (r: EnergyOptions) => r.candidates.map((c) => c.id);

// 위도 1도 = 111194.9m(지구 반지름 6371km 기준). 동서 직선 경로에서 남북으로 m미터 벗어난 위도.
const metersNorth = (m: number) => m / 111_194.93;

const charger = (o: Partial<Charger> & Pick<Charger, 'stationId'>): Charger => ({
  chargerId: '01',
  name: `충전소 ${o.stationId}`,
  address: null,
  lat: 35,
  lng: 127,
  speed: 'slow',
  state: 'available',
  powerKw: 7,
  operator: null,
  parkingFree: null,
  ...o,
});
const stop = (id: string, lat: number, lng: number, hasFood: boolean): RestStop => ({ id, name: `휴게소 ${id}`, lat, lng, hasFood });
const station = (id: string, price: number, lat = 35, lng = 127.05): FuelStation => ({ id, name: `주유소 ${id}`, brand: null, lat, lng, price });

const sourcesOf = (o: { chargers?: Charger[]; stops?: RestStop[]; stations?: FuelStation[] }): EnergySources => ({
  chargers: createFixtureChargerSource(o.chargers ?? []),
  fuelStations: { kind: 'fixture', findNear: async () => o.stations ?? [] },
  restStops: createFixtureRestStopSource(o.stops ?? []),
});
const appOf = (energy: EnergySources, extra: Parameters<typeof newApp>[0] = {}) => newApp({ energy, ...extra });

// 동서 직선 경로(위도 35, 경도 127.0 → 127.1, 약 9km)와 그 위의 목적지.
const ORIGIN = { lat: 35, lng: 127 };
const DEST = { lat: 35, lng: 127.1 };

describe('픽스처', () => {
  it('충전소·주유소·휴게소 목이 읽히고 완속·급속·휴게소가 모두 있다', () => {
    expect(energyFixtures.chargers.some((c) => c.speed === 'slow')).toBe(true);
    expect(energyFixtures.chargers.some((c) => c.speed === 'fast')).toBe(true);
    expect(energyFixtures.fuelStations.length).toBeGreaterThanOrEqual(5);
    expect(energyFixtures.restStops.some((s) => s.hasFood)).toBe(true);
    expect(energyFixtures.restStops.some((s) => !s.hasFood)).toBe(true);
  });

  it('형식이 틀리면 읽기에서 오류가 난다', () => {
    expect(() => parseChargerFixture({ stations: [{ stationId: 'a', name: 'n', lat: 1, lng: 2, chargers: [{ chargerId: '1', speed: 'ultra', state: 'available' }] }] })).toThrow('충전기');
    expect(() => parseChargerFixture({})).toThrow('stations');
    expect(() => parseFuelFixture({ stations: [{ id: 'a', name: 'n', lat: 1, lng: 2, prices: { gasoline: 1 } }] })).toThrow('주유소');
    expect(() => parseRestStopFixture({ restStops: [{ id: 'a', name: 'n', lat: 1, lng: 2 }] })).toThrow('휴게소');
  });
});

describe('POST /energy/options 전기차', () => {
  it('2시간 이상 머무는 일정이면 500m 안의 빈 완속 충전기를 가까운 순으로 준다', async () => {
    const r = await ok(newApp(), { fuel: 'ev', origin: GWANGJU, destination: KIA, stayMinutes: 180, at: AFTERNOON });
    expect(r).toMatchObject({ fuel: 'ev', source: 'fixture', stage: 'destination', mealBundle: false });
    // 002는 전부 충전 중, 003은 500m 밖이라 빠진다.
    expect(ids(r)).toEqual(['EX-GJ-001', 'EX-GJ-004']);
    expect(r.candidates[0]).toMatchObject({
      kind: 'slow_charger',
      name: '예시 챔필 주차장 충전소',
      routeProgress: null,
      detourMeters: 204,
      price: null,
      hasFood: null,
      charger: { status: 'available', availableCount: 2, totalCount: 3, powerKw: 7 },
    });
  });

  it('머무는 시간이 2시간 미만이면 완속 충전기가 있어도 목적지 근처를 찾지 않는다', async () => {
    const sources = sourcesOf({ chargers: [charger({ stationId: 'near', lat: 35, lng: 127.1 })] });
    const app = appOf(sources);
    const at = { fuel: 'ev', origin: ORIGIN, destination: DEST, at: AFTERNOON };
    expect((await ok(app, { ...at, stayMinutes: LONG_STAY_MINUTES })).stage).toBe('destination');
    expect((await ok(app, { ...at, stayMinutes: LONG_STAY_MINUTES - 1 })).stage).toBe('none');
    expect((await ok(app, at)).stage).toBe('none');
  });

  it('500m 경계: 500m 안은 포함, 밖은 제외', async () => {
    const lng = (m: number) => 127.1 + m / (111_194.93 * Math.cos((35 * Math.PI) / 180));
    const sources = sourcesOf({
      chargers: [charger({ stationId: 'in', lat: 35, lng: lng(495) }), charger({ stationId: 'out', lat: 35, lng: lng(505) })],
    });
    const r = await ok(appOf(sources), { fuel: 'ev', origin: ORIGIN, destination: DEST, stayMinutes: 240 });
    expect(ids(r)).toEqual(['in']);
  });

  it('근처 완속이 모두 사용 중이거나 점검이면 경로상 휴게소 급속 충전으로 넘어간다', async () => {
    const sources = sourcesOf({
      chargers: [
        charger({ stationId: 'busy', lat: 35, lng: 127.1, state: 'charging' }),
        charger({ stationId: 'down', lat: 35, lng: 127.1, state: 'unavailable' }),
        charger({ stationId: 'fast', speed: 'fast', lat: 35, lng: 127.05, powerKw: 100 }),
      ],
      stops: [stop('rs', 35, 127.05, true)],
    });
    const r = await ok(appOf(sources), { fuel: 'ev', origin: ORIGIN, destination: DEST, stayMinutes: 240, at: AFTERNOON });
    expect(r.stage).toBe('route');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ id: 'fast', kind: 'fast_charger', name: '휴게소 rs', hasFood: true, charger: { stationName: '충전소 fast', status: 'available', powerKw: 100 } });
  });

  it('픽스처: 목적지 근처에 빈 완속이 없으면 광주→서울 경로의 휴게소 급속 후보를 준다', async () => {
    const r = await ok(newApp(), { fuel: 'ev', origin: GWANGJU, destination: SEOUL_TOWER, stayMinutes: 180, at: AFTERNOON });
    expect(r.stage).toBe('route');
    // 논산은 경로에서 5km 넘게 벗어나 제외, 천안은 급속이 모두 점검 중이라 제외, 정읍은 모두 충전 중이라 맨 뒤.
    expect(ids(r)).toEqual(['EX-RS-001', 'EX-RS-006', 'EX-RS-003', 'EX-RS-002']);
    expect(r.candidates.map((c) => c.charger?.status)).toEqual(['available', 'available', 'available', 'busy']);
    expect(r.candidates.every((c) => c.kind === 'fast_charger' && c.routeProgress !== null && c.detourMeters <= 3000)).toBe(true);
    expect(r.mealBundle).toBe(false);
  });

  it('식사 시간대이고 식사 가능한 휴게소가 있으면 mealBundle이 true다', async () => {
    const lunch = await ok(newApp(), { fuel: 'ev', origin: GWANGJU, destination: SEOUL_TOWER, stayMinutes: 180, at: NOON });
    expect(lunch.mealBundle).toBe(true);
    const evening = await ok(newApp(), { fuel: 'ev', origin: GWANGJU, destination: SEOUL_TOWER, at: '2026-11-06T17:30:00+09:00' });
    expect(evening.mealBundle).toBe(true);
    const night = await ok(newApp(), { fuel: 'ev', origin: GWANGJU, destination: SEOUL_TOWER, at: '2026-11-06T22:00:00+09:00' });
    expect(night.mealBundle).toBe(false);
  });

  it('at이 없으면 서버 시계(now)로 식사 시간대를 판단한다', async () => {
    const at = (iso: string) => newApp({ now: () => new Date(iso) });
    const body = { fuel: 'ev', origin: GWANGJU, destination: SEOUL_TOWER };
    expect((await ok(at('2026-11-06T12:10:00+09:00'), body)).mealBundle).toBe(true);
    expect((await ok(at('2026-11-06T15:10:00+09:00'), body)).mealBundle).toBe(false);
  });

  it('식사 시간대여도 후보에 식사할 수 있는 휴게소가 없으면 mealBundle은 false다', async () => {
    const sources = sourcesOf({
      chargers: [charger({ stationId: 'f1', speed: 'fast', lat: 35, lng: 127.05 })],
      stops: [stop('nofood', 35, 127.05, false)],
    });
    const r = await ok(appOf(sources), { fuel: 'ev', origin: ORIGIN, destination: DEST, at: NOON });
    expect(r).toMatchObject({ stage: 'route', mealBundle: false });
  });

  it('식사 시간대에는 같은 충전 상태끼리 식사 가능한 휴게소를 앞에 둔다', async () => {
    const sources = sourcesOf({
      chargers: [
        charger({ stationId: 'near-nofood', speed: 'fast', lat: 35, lng: 127.02 }),
        charger({ stationId: 'far-food', speed: 'fast', lat: 35 + metersNorth(1500), lng: 127.06 }),
        charger({ stationId: 'busy-food', speed: 'fast', lat: 35, lng: 127.04, state: 'charging' }),
      ],
      stops: [stop('a', 35, 127.02, false), stop('b', 35 + metersNorth(1500), 127.06, true), stop('c', 35, 127.04, true)],
    });
    const app = appOf(sources);
    const body = { fuel: 'ev', origin: ORIGIN, destination: DEST };
    expect(ids(await ok(app, { ...body, at: AFTERNOON }))).toEqual(['near-nofood', 'far-food', 'busy-food']);
    const lunch = await ok(app, { ...body, at: NOON });
    expect(lunch.mealBundle).toBe(true);
    expect(ids(lunch)).toEqual(['far-food', 'near-nofood', 'busy-food']);
  });

  it('mealBundle은 맨 앞 후보가 식사 가능일 때만 true다(점심, A=식사 없음·빈 곳, B=식사 가능·전부 충전 중)', async () => {
    const sources = sourcesOf({
      chargers: [
        charger({ stationId: 'A', speed: 'fast', lat: 35, lng: 127.03, state: 'available' }),
        charger({ stationId: 'B', speed: 'fast', lat: 35, lng: 127.06, state: 'charging' }),
      ],
      stops: [stop('a', 35, 127.03, false), stop('b', 35, 127.06, true)],
    });
    const r = await ok(appOf(sources), { fuel: 'ev', origin: ORIGIN, destination: DEST, at: NOON });
    expect(ids(r)).toEqual(['A', 'B']); // 빈 곳이 먼저
    expect(r.candidates[0].hasFood).toBe(false);
    expect(r.mealBundle).toBe(false); // 식사 가능한 후보가 뒤에 있어도 묶지 않는다
  });

  it('식사 시간대에는 빈 급속 충전기가 있는 식사 가능 휴게소가 더 멀어도 맨 앞이고 mealBundle이 true다', async () => {
    const sources = sourcesOf({
      chargers: [
        charger({ stationId: 'near', speed: 'fast', lat: 35, lng: 127.02, state: 'available' }),
        charger({ stationId: 'food', speed: 'fast', lat: 35 + metersNorth(2500), lng: 127.07, state: 'available' }),
      ],
      stops: [stop('near', 35, 127.02, false), stop('food', 35 + metersNorth(2500), 127.07, true)],
    });
    const app = appOf(sources);
    const body = { fuel: 'ev', origin: ORIGIN, destination: DEST };
    const lunch = await ok(app, { ...body, at: NOON });
    expect(ids(lunch)).toEqual(['food', 'near']);
    expect(lunch.mealBundle).toBe(true);
    const afternoon = await ok(app, { ...body, at: AFTERNOON });
    expect(ids(afternoon)).toEqual(['near', 'food']);
    expect(afternoon.mealBundle).toBe(false);
  });

  it('휴게소는 경로에서 3km 안만, 급속 충전기가 있는 곳만 후보가 된다', async () => {
    const sources = sourcesOf({
      chargers: [
        charger({ stationId: 'on', speed: 'fast', lat: 35 + metersNorth(2990), lng: 127.03 }),
        charger({ stationId: 'off', speed: 'fast', lat: 35 + metersNorth(3010), lng: 127.06 }),
        charger({ stationId: 'slow-only', speed: 'slow', lat: 35, lng: 127.08 }),
      ],
      stops: [stop('on', 35 + metersNorth(2990), 127.03, true), stop('off', 35 + metersNorth(3010), 127.06, true), stop('slow-only', 35, 127.08, true)],
    });
    const r = await ok(appOf(sources), { fuel: 'ev', origin: ORIGIN, destination: DEST, at: AFTERNOON });
    expect(ids(r)).toEqual(['on']);
    expect(r.candidates[0].detourMeters).toBe(2990);
  });

  it('후보는 상한(MAX_CANDIDATES)까지만 주고 가까운 순이다', async () => {
    const many = Array.from({ length: 8 }, (_, i) => charger({ stationId: `s${i}`, lat: 35, lng: 127.1 + (7 - i) * 0.0004 }));
    const r = await ok(appOf(sourcesOf({ chargers: many })), { fuel: 'ev', origin: ORIGIN, destination: DEST, stayMinutes: 300 });
    expect(r.candidates).toHaveLength(MAX_CANDIDATES);
    expect(ids(r)).toEqual(['s7', 's6', 's5', 's4', 's3']);
  });

  it('여러 대 중 한 대만 비어 있어도 충전소 하나로 세고, 개수를 알려 준다', async () => {
    const sources = sourcesOf({
      chargers: [
        charger({ stationId: 'x', chargerId: '1', lat: 35, lng: 127.1, state: 'charging' }),
        charger({ stationId: 'x', chargerId: '2', lat: 35, lng: 127.1, state: 'available', powerKw: 11 }),
        charger({ stationId: 'x', chargerId: '3', lat: 35, lng: 127.1, state: 'unavailable' }),
        charger({ stationId: 'x', chargerId: '4', lat: 35, lng: 127.1, speed: 'fast' }),
      ],
    });
    const r = await ok(appOf(sources), { fuel: 'ev', origin: ORIGIN, destination: DEST, stayMinutes: 300 });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].charger).toMatchObject({ availableCount: 1, totalCount: 3, powerKw: 11 });
  });

  it('후보가 없으면 stage none과 빈 목록이다(source는 fixture)', async () => {
    const r = await ok(appOf(sourcesOf({})), { fuel: 'ev', origin: ORIGIN, destination: DEST, stayMinutes: 300 });
    expect(r).toEqual({ fuel: 'ev', source: 'fixture', stage: 'none', mealBundle: false, partial: false, stale: false, asOf: null, candidates: [] });
  });
});

describe('POST /energy/options 내연·하이브리드', () => {
  it('경로에서 3km 안 주유소 중 가장 싼 곳을 맨 앞에 둔다(휘발유)', async () => {
    const r = await ok(newApp(), { fuel: 'gasoline', origin: GWANGJU, destination: KIA });
    expect(r).toMatchObject({ source: 'fixture', stage: 'route', mealBundle: false });
    // EX-FS-004(1599원)는 가장 싸지만 경로에서 3.4km라 제외된다.
    expect(ids(r)).toEqual(['EX-FS-002', 'EX-FS-003', 'EX-FS-001']);
    expect(r.candidates[0]).toMatchObject({ kind: 'gas_station', name: '예시 서구 알뜰주유소', price: { fuel: 'gasoline', won: 1639 }, brand: 'RTE', charger: null, hasFood: null });
  });

  it('경유는 경유 가격으로 정렬한다', async () => {
    const r = await ok(newApp(), { fuel: 'diesel', origin: GWANGJU, destination: KIA });
    expect(r.candidates.map((c) => c.price)).toEqual([
      { fuel: 'diesel', won: 1519 },
      { fuel: 'diesel', won: 1539 },
      { fuel: 'diesel', won: 1559 },
    ]);
  });

  it('하이브리드는 휘발유 가격으로 본다', async () => {
    const hybrid = await ok(newApp(), { fuel: 'hybrid', origin: GWANGJU, destination: KIA });
    const gasoline = await ok(newApp(), { fuel: 'gasoline', origin: GWANGJU, destination: KIA });
    expect(hybrid.fuel).toBe('hybrid');
    expect(hybrid.candidates).toEqual(gasoline.candidates);
  });

  it('3km 경계: 2990m는 포함, 3010m는 제외(가격이 더 싸도)', async () => {
    const sources = sourcesOf({
      stations: [station('in', 1700, 35 + metersNorth(2990)), station('out', 1500, 35 + metersNorth(3010)), station('exact-south', 1600, 35 - metersNorth(2990))],
    });
    const r = await ok(appOf(sources), { fuel: 'gasoline', origin: ORIGIN, destination: DEST });
    expect(ids(r)).toEqual(['exact-south', 'in']);
    expect(r.candidates.map((c) => c.detourMeters)).toEqual([2990, 2990]);
  });

  it('경로 끝(출발 앞쪽·목적지 뒤쪽)은 끝점까지의 거리로 3km를 잰다', async () => {
    const lng = (m: number) => m / (111_194.93 * Math.cos((35 * Math.PI) / 180));
    const sources = sourcesOf({ stations: [station('behind-ok', 1700, 35, 127 - lng(2900)), station('behind-far', 1500, 35, 127 - lng(3100)), station('beyond-ok', 1710, 35, 127.1 + lng(2900))] });
    const r = await ok(appOf(sources), { fuel: 'diesel', origin: ORIGIN, destination: DEST });
    expect(ids(r)).toEqual(['behind-ok', 'beyond-ok']);
  });

  it('가격이 같으면 경로에 가까운 곳이 먼저이고, 같은 주유소가 여러 번 와도 한 번만 센다', async () => {
    const a = station('a', 1650, 35 + metersNorth(2000));
    const b = station('b', 1650, 35 + metersNorth(500));
    const c = station('c', 1600, 35 + metersNorth(2500));
    const r = await ok(appOf(sourcesOf({ stations: [a, b, c, a, b] })), { fuel: 'gasoline', origin: ORIGIN, destination: DEST });
    expect(ids(r)).toEqual(['c', 'b', 'a']);
  });

  it('후보는 상한까지만, 싼 순으로 준다', async () => {
    const stations = Array.from({ length: 9 }, (_, i) => station(`s${i}`, 1700 - i * 10, 35 + metersNorth(100 * i)));
    const r = await ok(appOf(sourcesOf({ stations })), { fuel: 'gasoline', origin: ORIGIN, destination: DEST });
    expect(ids(r)).toEqual(['s8', 's7', 's6', 's5', 's4']);
  });

  it('긴 경로는 출발점에서 100km까지만 훑는다(검색 원 16개 이하)', async () => {
    const calls: { lat: number; lng: number; radius: number }[] = [];
    const fuelStations: FuelStationSource = { kind: 'fixture', findNear: async (c, radius) => (calls.push({ ...c, radius }), []) };
    const app = appOf({ ...sourcesOf({}), fuelStations });
    await ok(app, { fuel: 'gasoline', origin: GWANGJU, destination: SEOUL_TOWER });
    expect(calls).toHaveLength(16);
    expect(calls.every((c) => c.radius === 5000)).toBe(true);
    expect(calls.at(-1)!.lat).toBeLessThan(36.1); // 광주(35.16)에서 북쪽으로 약 100km
  });

  it('조건에 맞는 주유소가 없으면 stage none', async () => {
    const r = await ok(appOf(sourcesOf({ stations: [station('far', 1500, 35 + metersNorth(9000))] })), { fuel: 'gasoline', origin: ORIGIN, destination: DEST });
    expect(r).toMatchObject({ source: 'fixture', stage: 'none', partial: false, candidates: [] });
  });

  it('출발과 목적지가 같아도 그 지점 3km 안 주유소를 준다', async () => {
    const r = await ok(appOf(sourcesOf({ stations: [station('here', 1600, 35 + metersNorth(1000), 127)] })), { fuel: 'gasoline', origin: ORIGIN, destination: ORIGIN });
    expect(ids(r)).toEqual(['here']);
  });
});

describe('외부 어댑터 실패', () => {
  const failing = (message = '연결 실패'): ChargerSource & FuelStationSource => ({
    kind: 'live',
    findNear: async () => {
      throw new Error(message);
    },
  });

  it('충전소 조회가 실패하면 200 + 빈 후보 + source unavailable이고 오류를 알린다', async () => {
    const onError = vi.fn();
    const app = appOf({ ...fixtureEnergy, chargers: failing() }, { onEnergyError: onError });
    const r = await ok(app, { fuel: 'ev', origin: GWANGJU, destination: KIA, stayMinutes: 180 });
    expect(r).toEqual({ fuel: 'ev', source: 'unavailable', stage: 'none', mealBundle: false, partial: false, stale: false, asOf: null, candidates: [] });
    expect(onError).toHaveBeenCalledTimes(1);
    // 실패한 뒤에도 서버는 다음 요청에 정상으로 답한다.
    const again = await ok(newApp(), { fuel: 'ev', origin: GWANGJU, destination: KIA, stayMinutes: 180 });
    expect(again.stage).toBe('destination');
  });

  it('주유소 조회가 실패해도 마찬가지다', async () => {
    const onError = vi.fn();
    const app = appOf({ ...fixtureEnergy, fuelStations: failing() }, { onEnergyError: onError });
    const r = await ok(app, { fuel: 'diesel', origin: GWANGJU, destination: KIA });
    expect(r).toEqual({ fuel: 'diesel', source: 'unavailable', stage: 'none', mealBundle: false, partial: false, stale: false, asOf: null, candidates: [] });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('제한 시간을 넘기면 unavailable로 답한다', async () => {
    const hang: FuelStationSource = { kind: 'live', findNear: () => new Promise(() => undefined) };
    const app = appOf({ ...fixtureEnergy, fuelStations: hang }, { energyTimeoutMs: 20, onEnergyError: () => undefined });
    const r = await ok(app, { fuel: 'gasoline', origin: GWANGJU, destination: KIA });
    expect(r.source).toBe('unavailable');
    expect(r.candidates).toEqual([]);
  });

  it('실제 어댑터가 성공하면 source는 live다', async () => {
    const live: FuelStationSource = { kind: 'live', findNear: async () => [station('x', 1600, 35, 127.05)] };
    const r = await ok(appOf({ ...fixtureEnergy, fuelStations: live }), { fuel: 'gasoline', origin: ORIGIN, destination: DEST });
    expect(r.source).toBe('live');
  });

  it('기본 오류 기록에는 요청 URL이나 키가 들어가지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const app = appOf({ ...fixtureEnergy, chargers: failing('충전소 API에 연결하지 못했습니다') });
      const res = await post(app, { fuel: 'ev', origin: GWANGJU, destination: KIA, stayMinutes: 180 });
      expect(JSON.stringify(await res.json())).not.toMatch(/key|http/i);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toBe('[energy] 외부 조회 실패: 충전소 API에 연결하지 못했습니다');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('입력 검증', () => {
  const valid = { fuel: 'ev', origin: GWANGJU, destination: KIA };
  const bad = async (body: unknown, message: RegExp, raw = false) => {
    const res = await post(newApp(), body, raw);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(message);
  };

  it.each([
    ['fuel 없음', { origin: GWANGJU, destination: KIA }, /fuel/],
    ['fuel 값이 목록에 없음', { ...valid, fuel: 'lpg' }, /fuel/],
    ['fuel이 문자열이 아님', { ...valid, fuel: 1 }, /fuel/],
    ['origin 없음', { fuel: 'ev', destination: KIA }, /origin/],
    ['origin이 배열', { ...valid, origin: [1, 2] }, /origin/],
    ['origin.lat 범위 밖', { ...valid, origin: { lat: 90.1, lng: 127 } }, /origin\.lat/],
    ['origin.lng 범위 밖', { ...valid, origin: { lat: 35, lng: -180.5 } }, /origin\.lng/],
    ['destination.lat이 문자열', { ...valid, destination: { lat: '35', lng: 127 } }, /destination\.lat/],
    ['destination.lng 없음', { ...valid, destination: { lat: 35 } }, /destination\.lng/],
    ['stayMinutes 음수', { ...valid, stayMinutes: -1 }, /stayMinutes/],
    ['stayMinutes 상한 초과', { ...valid, stayMinutes: MAX_STAY_MINUTES + 1 }, /stayMinutes/],
    ['stayMinutes 문자열', { ...valid, stayMinutes: '180' }, /stayMinutes/],
    ['at에 오프셋 없음', { ...valid, at: '2026-11-06T12:00:00' }, /at/],
    ['at이 없는 날짜', { ...valid, at: '2026-02-30T12:00:00+09:00' }, /at/],
    ['at이 숫자', { ...valid, at: 1762398000000 }, /at/],
    ['본문이 배열', [valid], /객체/],
  ])('%s → 400', async (_name, body, message) => bad(body, message));

  it('JSON이 아니면 400이다', async () => {
    const res = await post(newApp(), '{not json', true);
    expect(res.status).toBe(400);
  });

  it('JSON 헤더 없이 보내면 400이다', async () => {
    const res = await newApp().request('/energy/options', { method: 'POST', body: JSON.stringify(valid) });
    expect(res.status).toBe(400);
  });

  it('본문이 상한을 넘으면 413이다', async () => {
    const res = await post(newApp(), JSON.stringify({ ...valid, padding: 'x'.repeat(MAX_BODY_BYTES) }), true);
    expect(res.status).toBe(413);
  });

  it('경계 값(좌표 ±90·±180, stayMinutes 0·상한, null)과 모르는 필드는 받는다', async () => {
    for (const body of [
      { ...valid, origin: { lat: -90, lng: -180 }, destination: { lat: 90, lng: 180 } },
      { ...valid, stayMinutes: 0 },
      { ...valid, stayMinutes: MAX_STAY_MINUTES },
      { ...valid, stayMinutes: null, at: null },
      { ...valid, extra: true },
    ]) {
      expect((await post(newApp(), body)).status).toBe(200);
    }
  });

  it('GET은 열지 않는다', async () => {
    expect((await newApp().request('/energy/options')).status).toBe(404);
  });
});

describe('식사 시간대', () => {
  const at = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00+09:00`);
  it.each([
    ['06:59', false],
    ['07:00', true],
    ['08:59', true],
    ['09:00', false],
    ['10:59', false],
    ['11:00', true],
    ['13:59', true],
    ['14:00', false],
    ['16:59', false],
    ['17:00', true],
    ['19:59', true],
    ['20:00', false],
    ['00:00', false],
  ])('서울 %s → %s', (hhmm, expected) => {
    expect(isMealTimeSeoul(at(hhmm))).toBe(expected);
  });

  it('UTC로 보내도 서울 시각으로 본다', () => {
    expect(isMealTimeSeoul(new Date('2026-11-06T03:00:00Z'))).toBe(true); // 서울 12:00
    expect(isMealTimeSeoul(new Date('2026-11-06T12:00:00Z'))).toBe(false); // 서울 21:00
  });
});

describe('부분 실패', () => {
  const stationsNear = [station('ok1', 1650, 35 + metersNorth(500)), station('ok2', 1600, 35 + metersNorth(800))];

  it('주유소: 일부 지점 조회만 실패하면 받은 결과로 답하고 partial true, 오류는 한 번 알린다', async () => {
    let n = 0;
    const fuelStations: FuelStationSource = {
      kind: 'live',
      findNear: async () => {
        n += 1;
        if (n % 2 === 0) throw new Error('일부 실패');
        return stationsNear;
      },
    };
    const onError = vi.fn();
    const r = await ok(appOf({ ...sourcesOf({}), fuelStations }, { onEnergyError: onError }), { fuel: 'gasoline', origin: GWANGJU, destination: SEOUL_TOWER });
    expect(r.source).toBe('live');
    expect(r.partial).toBe(true);
    expect(r.stage).toBe('none'); // 이 가짜 주유소는 경로(광주→서울) 3km 밖이라 후보가 없다. 비어도 partial이 실패를 알린다.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('주유소: 일부만 실패해도 경로 위 후보는 그대로 준다', async () => {
    let n = 0;
    const fuelStations: FuelStationSource = {
      kind: 'live',
      findNear: async () => {
        n += 1;
        if (n === 1) throw new Error('첫 지점만 실패');
        return [station('x', 1600, 35 + metersNorth(100))];
      },
    };
    // 동서 약 9km 경로라 검색 원이 2개다.
    const r = await ok(appOf({ ...sourcesOf({}), fuelStations }, { onEnergyError: () => undefined }), { fuel: 'gasoline', origin: ORIGIN, destination: DEST });
    expect(ids(r)).toEqual(['x']);
    expect(r.partial).toBe(true);
  });

  it('주유소: 전부 실패해야 unavailable이고 partial은 false다', async () => {
    const fuelStations: FuelStationSource = { kind: 'live', findNear: async () => Promise.reject(new Error('전부 실패')) };
    const r = await ok(appOf({ ...sourcesOf({}), fuelStations }, { onEnergyError: () => undefined }), { fuel: 'gasoline', origin: ORIGIN, destination: DEST });
    expect(r).toMatchObject({ source: 'unavailable', partial: false, candidates: [] });
  });

  it('전기차: 일부 휴게소 조회만 실패하면 받은 곳으로 답하고 partial true', async () => {
    const good = charger({ stationId: 'good', speed: 'fast', lat: 35, lng: 127.03 });
    const chargers: ChargerSource = {
      kind: 'live',
      findNear: async (c) => {
        if (Math.abs(c.lng - 127.07) < 1e-6) throw new Error('이 휴게소만 실패');
        return [good];
      },
    };
    const onError = vi.fn();
    const sources: EnergySources = { ...sourcesOf({ stops: [stop('a', 35, 127.03, true), stop('b', 35, 127.07, true)] }), chargers };
    const r = await ok(appOf(sources, { onEnergyError: onError }), { fuel: 'ev', origin: ORIGIN, destination: DEST, at: AFTERNOON });
    expect(ids(r)).toEqual(['good']);
    expect(r).toMatchObject({ source: 'live', stage: 'route', partial: true });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('전기차: 목적지 조회가 실패해도 경로상 휴게소 조회가 되면 그것으로 답한다(partial true)', async () => {
    const fast = charger({ stationId: 'fast', speed: 'fast', lat: 35, lng: 127.05 });
    const chargers: ChargerSource = {
      kind: 'live',
      findNear: async (c, radius) => {
        if (radius === 500) throw new Error('목적지 조회만 실패');
        return [fast].filter((x) => Math.abs(x.lng - c.lng) < 0.01);
      },
    };
    const sources: EnergySources = { ...sourcesOf({ stops: [stop('rs', 35, 127.05, true)] }), chargers };
    const r = await ok(appOf(sources, { onEnergyError: () => undefined }), { fuel: 'ev', origin: ORIGIN, destination: DEST, stayMinutes: 240, at: AFTERNOON });
    expect(ids(r)).toEqual(['fast']);
    expect(r.partial).toBe(true);
  });

  it('전기차: 목적지 조회만 했는데 실패하면(경로에 휴게소가 없음) unavailable이다', async () => {
    const chargers: ChargerSource = { kind: 'live', findNear: async () => Promise.reject(new Error('실패')) };
    const r = await ok(appOf({ ...sourcesOf({}), chargers }, { onEnergyError: () => undefined }), { fuel: 'ev', origin: ORIGIN, destination: DEST, stayMinutes: 240 });
    expect(r).toMatchObject({ source: 'unavailable', partial: false });
  });
});

describe('제한 시간과 취소', () => {
  it('제한 시간이 지나면 어댑터에 준 signal이 중단되고 아직 시작하지 않은 조회는 시작하지 않는다', async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const fuelStations: FuelStationSource = {
      kind: 'live',
      findNear: (_c, _r, _f, signal) => {
        calls += 1;
        if (signal) signals.push(signal);
        return new Promise(() => undefined); // 끝나지 않는다
      },
    };
    const app = appOf({ ...sourcesOf({}), fuelStations }, { energyTimeoutMs: 30, onEnergyError: () => undefined });
    const r = await ok(app, { fuel: 'gasoline', origin: GWANGJU, destination: SEOUL_TOWER }); // 검색 원 16개
    expect(r.source).toBe('unavailable');
    expect(calls).toBe(4); // 동시 4개까지만 나갔고, 제한 시간 뒤에는 더 나가지 않는다
    expect(signals).toHaveLength(4);
    expect(signals.every((s) => s.aborted)).toBe(true);
    await new Promise((r2) => setTimeout(r2, 20));
    expect(calls).toBe(4);
  });

  it('전기차 휴게소 조회도 제한 시간 뒤에는 더 시작하지 않는다', async () => {
    let calls = 0;
    const signals: (AbortSignal | undefined)[] = [];
    const chargers: ChargerSource = {
      kind: 'live',
      findNear: (_c, _r, signal) => {
        calls += 1;
        signals.push(signal);
        return new Promise(() => undefined);
      },
    };
    const stops = Array.from({ length: 10 }, (_, i) => stop(`s${i}`, 35, 127.01 + i * 0.005, true));
    const r = await ok(appOf({ ...sourcesOf({ stops }), chargers }, { energyTimeoutMs: 30, onEnergyError: () => undefined }), { fuel: 'ev', origin: ORIGIN, destination: DEST });
    expect(r.source).toBe('unavailable');
    expect(calls).toBe(4);
    expect(signals.every((s) => s?.aborted)).toBe(true);
  });
});

describe('POST /energy/options 속도 제한', () => {
  const body = { fuel: 'gasoline', origin: GWANGJU, destination: KIA };
  const clock = (start = '2026-11-06T12:00:00+09:00') => {
    let ms = new Date(start).getTime();
    return { now: () => new Date(ms), advance: (d: number) => (ms += d) };
  };

  it('기본값은 같은 주소에서 분당 20회까지 받고 그 위는 429 + Retry-After', async () => {
    const c = clock();
    const app = newApp({ now: c.now });
    for (let i = 0; i < 20; i++) expect((await post(app, body)).status).toBe(200);
    const blocked = await post(app, body);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/잦습니다/);
    c.advance(61_000); // 창이 지나면 다시 받는다
    expect((await post(app, body)).status).toBe(200);
  });

  it('주소별로 따로 센다', async () => {
    const c = clock();
    let who = 'a';
    const app = newApp({ now: c.now, energyRateLimit: { limit: 2, windowMs: 60_000 }, clientAddress: () => who });
    expect([(await post(app, body)).status, (await post(app, body)).status, (await post(app, body)).status]).toEqual([200, 200, 429]);
    who = 'b';
    expect((await post(app, body)).status).toBe(200);
  });

  it('창 안에 남은 시간만큼 Retry-After를 준다', async () => {
    const c = clock();
    const app = newApp({ now: c.now, energyRateLimit: { limit: 1, windowMs: 60_000 }, clientAddress: () => 'a' });
    await post(app, body);
    c.advance(45_000);
    expect(Number((await post(app, body)).headers.get('retry-after'))).toBe(15);
  });

  it('잘못된 요청도 횟수에 센다(검증 전에 막는다)', async () => {
    const c = clock();
    const app = newApp({ now: c.now, energyRateLimit: { limit: 1, windowMs: 60_000 }, clientAddress: () => 'a' });
    expect((await post(app, { fuel: 'nope' })).status).toBe(400);
    expect((await post(app, body)).status).toBe(429);
  });
});

describe('기본 에너지 소스', () => {
  it('createApp에 energy를 주지 않으면 파일을 읽지 않고 후보가 늘 없는 목으로 답한다(옵션 없이 불러도 깨지지 않는다)', async () => {
    const app = createApp({ fixture, calendars, places: catalog, familyMembers });
    for (const body of [
      { fuel: 'gasoline', origin: GWANGJU, destination: KIA },
      { fuel: 'ev', origin: GWANGJU, destination: KIA, stayMinutes: 180 },
    ]) {
      const res = await post(app, body);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ source: 'fixture', stage: 'none', partial: false, stale: false, asOf: null, candidates: [] });
    }
  });

  it('테스트 도우미와 서버 시작 코드는 픽스처 목을 넘긴다', async () => {
    const r = await ok(newApp(), { fuel: 'gasoline', origin: GWANGJU, destination: KIA });
    expect(r.source).toBe('fixture');
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

describe('충전소 조회의 품질 정보(partial·stale)', () => {
  const near = { fuel: 'ev', origin: GWANGJU, destination: KIA, stayMinutes: 180, at: AFTERNOON } as const;
  /** 픽스처 충전소를 돌려주면서 info를 채우는 포트. */
  const withInfo = (info: NearInfo): ChargerSource => ({
    kind: 'live',
    findNear: async (center, radius, _signal, out) => {
      Object.assign(out ?? {}, info);
      return fixtureEnergy.chargers.findNear(center, radius);
    },
  });

  it('새로 받은 데이터면 stale false·asOf null이다', async () => {
    const r = await ok(appOf({ ...fixtureEnergy, chargers: withInfo({}) }), near);
    expect(r).toMatchObject({ source: 'live', stage: 'destination', partial: false, stale: false, asOf: null });
  });

  it('낡은 캐시로 답하면 stale true와 그 데이터를 받은 시각(asOf, ISO)을 싣는다', async () => {
    const receivedAt = Date.parse('2026-11-06T02:40:00Z');
    const r = await ok(appOf({ ...fixtureEnergy, chargers: withInfo({ staleSince: receivedAt }) }), near);
    expect(r).toMatchObject({ stage: 'destination', stale: true, asOf: '2026-11-06T02:40:00.000Z' });
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('이웃 시도 받기가 실패했으면 후보가 있어도 partial true다', async () => {
    const r = await ok(appOf({ ...fixtureEnergy, chargers: withInfo({ partial: true }) }), near);
    expect(r).toMatchObject({ stage: 'destination', partial: true });
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('경로상 휴게소 조회에서도 품질 정보를 모은다(가장 낡은 시각, 하나라도 partial이면 partial)', async () => {
    let n = 0;
    const chargers: ChargerSource = {
      kind: 'live',
      findNear: async (center, radius, _signal, out) => {
        n += 1;
        if (out) {
          out.staleSince = 1_000_000 * n; // 호출마다 다른 시각
          if (n === 2) out.partial = true;
        }
        return fixtureEnergy.chargers.findNear(center, radius);
      },
    };
    const r = await ok(appOf({ ...fixtureEnergy, chargers }), { fuel: 'ev', origin: GWANGJU, destination: { lat: 37.5665, lng: 126.978 }, at: AFTERNOON });
    expect(n).toBeGreaterThan(1);
    expect(r).toMatchObject({ stale: true, asOf: new Date(1_000_000).toISOString(), partial: true });
  });

  it('주유소 응답은 항상 stale false·asOf null이다', async () => {
    const r = await ok(newApp(), { fuel: 'diesel', origin: GWANGJU, destination: KIA });
    expect(r).toMatchObject({ stale: false, asOf: null });
  });
});

describe('속도 제한 표가 찼을 때', () => {
  const limiter = (maxKeys: number) => {
    let t = 0;
    return { rl: createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys, now: () => t }), advance: (d: number) => (t += d) };
  };

  it('새 주소를 막지 않고 가장 오래된 주소를 밀어낸다', () => {
    const { rl, advance } = limiter(3);
    for (const k of ['a', 'b', 'c']) {
      expect(rl.check(k)).toEqual({ ok: true });
      advance(1_000);
    }
    expect(rl.check('d')).toEqual({ ok: true }); // 표가 찼지만 새 주소를 받는다(가장 오래된 a를 밀어냄)
    expect(rl.check('b').ok).toBe(false); // 밀리지 않은 주소는 횟수를 그대로 가진다
    expect(rl.check('c').ok).toBe(false);
    expect(rl.check('a')).toEqual({ ok: true }); // 밀려난 주소는 횟수를 잃었다(속도 제한이 느슨해지는 대가)
  });

  it('만료된 항목이 있으면 그것부터 지운다', () => {
    const { rl, advance } = limiter(2);
    rl.check('a');
    advance(30_000);
    rl.check('b');
    advance(31_000); // a의 창만 끝났다
    expect(rl.check('c')).toEqual({ ok: true });
    expect(rl.check('b').ok).toBe(false); // 만료된 a가 지워졌고 b는 남아 있다
  });

  it('주소를 계속 바꿔도 표 크기는 상한을 넘지 않고 정상 주소의 새 요청은 막히지 않는다', () => {
    const { rl } = limiter(100);
    for (let i = 0; i < 10_000; i++) rl.check(`attacker-${i}`);
    expect(rl.check('legit')).toEqual({ ok: true });
  });
});
