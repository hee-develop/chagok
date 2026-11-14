/// <reference types="node" />
// app.ts가 기본값으로 이 파일을 쓰고, 폰 앱은 AppType을 가져오며 이 파일까지 타입체크한다. 폰의 tsconfig는 node 타입을 싣지 않아 여기서 직접 싣는다.
import { readFileSync } from 'node:fs';
import { haversineMeters } from './geo.js';
import type { Charger, ChargerSource, ChargerSpeed, ChargerState, EnergySources, FuelStation, FuelStationSource, RestStop, RestStopSource } from './types.js';

/** 저장소 루트 fixtures/energy/. 이 파일(server/src/energy) 기준 상대 경로로 푼다. */
export const ENERGY_FIXTURES_URL = new URL('../../../fixtures/energy/', import.meta.url);

export type FixtureFuelStation = Omit<FuelStation, 'price'> & { prices: { gasoline: number; diesel: number } };
export type EnergyFixtures = { chargers: Charger[]; fuelStations: FixtureFuelStation[]; restStops: RestStop[] };

const SPEEDS: ChargerSpeed[] = ['slow', 'fast'];
const STATES: ChargerState[] = ['available', 'charging', 'unavailable', 'unknown'];

const fail = (what: string, item: unknown): never => {
  throw new Error(`에너지 픽스처 형식이 올바르지 않습니다(${what}): ${JSON.stringify(item)}`);
};
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const listOf = (v: unknown, key: string): unknown[] => {
  const list = isObj(v) ? v[key] : undefined;
  return Array.isArray(list) ? list : fail(`${key} 배열이 필요합니다`, v);
};

export function parseChargerFixture(value: unknown): Charger[] {
  const out: Charger[] = [];
  for (const s of listOf(value, 'stations')) {
    if (!isObj(s) || !isStr(s.stationId) || !isStr(s.name) || !isNum(s.lat) || !isNum(s.lng) || !Array.isArray(s.chargers)) fail('충전소', s);
    const st = s as Record<string, unknown>;
    for (const c of st.chargers as unknown[]) {
      if (!isObj(c) || !isStr(c.chargerId) || !SPEEDS.includes(c.speed as ChargerSpeed) || !STATES.includes(c.state as ChargerState)) fail('충전기', c);
      const ch = c as Record<string, unknown>;
      out.push({
        stationId: st.stationId as string,
        chargerId: ch.chargerId as string,
        name: st.name as string,
        address: typeof st.address === 'string' ? st.address : null,
        lat: st.lat as number,
        lng: st.lng as number,
        speed: ch.speed as ChargerSpeed,
        state: ch.state as ChargerState,
        powerKw: isNum(ch.powerKw) ? ch.powerKw : null,
        operator: typeof st.operator === 'string' ? st.operator : null,
        parkingFree: typeof st.parkingFree === 'boolean' ? st.parkingFree : null,
      });
    }
  }
  return out;
}

export function parseFuelFixture(value: unknown): FixtureFuelStation[] {
  return listOf(value, 'stations').map((s) => {
    const p = isObj(s) && isObj(s.prices) ? s.prices : null;
    if (!isObj(s) || !isStr(s.id) || !isStr(s.name) || !isNum(s.lat) || !isNum(s.lng) || !p || !isNum(p.gasoline) || !isNum(p.diesel)) fail('주유소', s);
    const st = s as Record<string, unknown>;
    return {
      id: st.id as string,
      name: st.name as string,
      brand: typeof st.brand === 'string' ? st.brand : null,
      lat: st.lat as number,
      lng: st.lng as number,
      prices: { gasoline: (st.prices as Record<string, number>).gasoline, diesel: (st.prices as Record<string, number>).diesel },
    };
  });
}

export function parseRestStopFixture(value: unknown): RestStop[] {
  return listOf(value, 'restStops').map((s) => {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.name) || !isNum(s.lat) || !isNum(s.lng) || typeof s.hasFood !== 'boolean') fail('휴게소', s);
    const r = s as Record<string, unknown>;
    return { id: r.id as string, name: r.name as string, lat: r.lat as number, lng: r.lng as number, hasFood: r.hasFood as boolean };
  });
}

const readJson = (name: string, base: URL): unknown => {
  try {
    return JSON.parse(readFileSync(new URL(name, base), 'utf8'));
  } catch (e) {
    throw new Error(`에너지 픽스처를 읽을 수 없습니다(${name}): ${(e as Error).message}`);
  }
};

export function loadEnergyFixtures(base: URL = ENERGY_FIXTURES_URL): EnergyFixtures {
  return {
    chargers: parseChargerFixture(readJson('chargers.json', base)),
    fuelStations: parseFuelFixture(readJson('fuel-stations.json', base)),
    restStops: parseRestStopFixture(readJson('rest-stops.json', base)),
  };
}

export const createFixtureChargerSource = (chargers: Charger[]): ChargerSource => ({
  kind: 'fixture',
  findNear: async (center, radiusMeters) => chargers.filter((c) => haversineMeters(center, c) <= radiusMeters),
});

export const createFixtureFuelSource = (stations: FixtureFuelStation[]): FuelStationSource => ({
  kind: 'fixture',
  findNear: async (center, radiusMeters, fuel) =>
    stations
      .filter((s) => haversineMeters(center, s) <= radiusMeters)
      .map(({ prices, ...s }) => ({ ...s, price: prices[fuel] })),
});

export const createFixtureRestStopSource = (restStops: RestStop[]): RestStopSource => ({ list: () => restStops });

/** `fixtures/energy/` 목으로 만든 세 포트. `createApp`의 기본값이다. */
export function createFixtureEnergySources(fixtures: EnergyFixtures = loadEnergyFixtures()): EnergySources {
  return {
    chargers: createFixtureChargerSource(fixtures.chargers),
    fuelStations: createFixtureFuelSource(fixtures.fuelStations),
    restStops: createFixtureRestStopSource(fixtures.restStops),
  };
}
