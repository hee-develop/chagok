import { readFileSync } from 'node:fs';
import { parseChargerFixture, parseFuelFixture, parseRestStopFixture, type EnergyFixtures } from './fixtureSources.js';

// fs로 `fixtures/energy/`를 읽는 node 전용 코드. app.ts의 import 그래프에 들어가면 폰 앱 타입체크에 node 타입이 끌려 들어오므로
// 서버 시작 코드(index.ts → sources.ts)와 테스트(helpers.ts)만 가져온다.

/** 저장소 루트 fixtures/energy/. 이 파일(server/src/energy) 기준 상대 경로로 푼다. */
export const ENERGY_FIXTURES_URL = new URL('../../../fixtures/energy/', import.meta.url);

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
