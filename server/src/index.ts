import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadDayFixture, loadMockCalendars, loadPlacesCatalog, resolveFixtureLocation } from './fixtures.js';

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';

let app: ReturnType<typeof createApp>;
try {
  const calendars = loadMockCalendars();
  app = createApp({
    fixture: loadDayFixture(resolveFixtureLocation(process.env.FIXTURE_PATH), calendars),
    calendars,
    places: loadPlacesCatalog(),
  });
} catch (e) {
  console.error(`차곡 서버를 시작할 수 없습니다: ${(e as Error).message}`);
  process.exit(1);
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`차곡 서버 실행 중: http://${hostname}:${info.port}`);
});
