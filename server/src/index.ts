import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createEnergySources } from './energy/sources.js';
import { loadDayFixture, loadFamilyMembers, loadMockCalendars, loadPlacesCatalog, resolveFixtureLocation } from './fixtures.js';

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';

const fixtureSeats = process.env.FIXTURE_SEATS === '1';
if (fixtureSeats) {
  console.warn(
    '경고: FIXTURE_SEATS=1 — 데모 전용 옵션입니다. 일정을 받은 적 없는 연결된 자리·버킷에도 목 일정(픽스처)이 보입니다. 실제 사용자가 쓰는 서버에서는 켜지 마세요.',
  );
}

let app: ReturnType<typeof createApp>;
try {
  const calendars = loadMockCalendars();
  app = createApp({
    fixture: loadDayFixture(resolveFixtureLocation(process.env.FIXTURE_PATH), calendars),
    calendars,
    places: loadPlacesCatalog(),
    familyMembers: loadFamilyMembers(),
    energy: createEnergySources(process.env),
    eventsLoopbackOnly: process.env.EVENTS_LOOPBACK_ONLY === '1',
    // 차량 Maestro(e2e-car.sh)·PT 시연(pt-demo.sh) 같은 데모 서버에서만 켠다. 실제 사용자 서버에서는 일정을 받은 적 없는 자리가 0건이다.
    fixtureSeats,
  });
} catch (e) {
  console.error(`차곡 서버를 시작할 수 없습니다: ${(e as Error).message}`);
  process.exit(1);
}

const energyLive = Boolean(process.env.EV_CHARGER_KEY?.trim() || process.env.OPINET_KEY?.trim());
if (energyLive && !['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
  console.warn(
    `[energy] 실제 API 키(EV_CHARGER_KEY·OPINET_KEY)가 설정된 채로 HOST=${hostname}으로 엽니다. POST /energy/options는 인증이 없어 서버에 닿는 누구나 부를 수 있고 부를 때마다 키의 외부 호출 한도를 씁니다. 신뢰할 수 있는 망·프록시 뒤에서만 여세요(docs/energy.md).`,
  );
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`차곡 서버 실행 중: http://${hostname}:${info.port}`);
});
