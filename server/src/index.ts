import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadDayFixture, loadFamilyMembers, loadMockCalendars, loadPlacesCatalog, resolveFixtureLocation } from './fixtures.js';

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';

let app: ReturnType<typeof createApp>;
try {
  const calendars = loadMockCalendars();
  app = createApp({
    fixture: loadDayFixture(resolveFixtureLocation(process.env.FIXTURE_PATH), calendars),
    calendars,
    places: loadPlacesCatalog(),
    familyMembers: loadFamilyMembers(),
    eventsLoopbackOnly: process.env.EVENTS_LOOPBACK_ONLY === '1',
    // 목 캘린더로 도는 폰 E2E·PT 시연에서만 켠다. 실제 사용자 서버에서는 일정을 받은 적 없는 자리가 0건이다.
    fixtureSeats: process.env.FIXTURE_SEATS === '1',
  });
} catch (e) {
  console.error(`차곡 서버를 시작할 수 없습니다: ${(e as Error).message}`);
  process.exit(1);
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`차곡 서버 실행 중: http://${hostname}:${info.port}`);
});
