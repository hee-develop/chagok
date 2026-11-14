import { createEvChargerSource } from './evCharger.js';
import { createFixtureChargerSource, createFixtureFuelSource, createFixtureRestStopSource, loadEnergyFixtures } from './fixtureSources.js';
import { createOpinetSource } from './opinet.js';
import type { EnergySources } from './types.js';

/**
 * 환경 변수로 포트 구현을 고른다(서버 시작 코드 `index.ts`만 부른다). `EV_CHARGER_KEY`가 있으면 환경부 충전소 API, `OPINET_KEY`가 있으면 오피넷을 실제로 부르고,
 * 없으면 해당 포트는 픽스처 목이다. 휴게소 목록은 항상 픽스처다. 키는 이 함수 밖으로 나가지 않으며 로그에 남기지 않는다.
 */
export function createEnergySources(env: Record<string, string | undefined> = process.env): EnergySources {
  const fixtures = loadEnergyFixtures();
  const evKey = env.EV_CHARGER_KEY?.trim();
  const opinetKey = env.OPINET_KEY?.trim();
  return {
    chargers: evKey ? createEvChargerSource({ serviceKey: evKey }) : createFixtureChargerSource(fixtures.chargers),
    fuelStations: opinetKey ? createOpinetSource({ certKey: opinetKey }) : createFixtureFuelSource(fixtures.fuelStations),
    restStops: createFixtureRestStopSource(fixtures.restStops),
  };
}
