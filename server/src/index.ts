import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadDayFixture, resolveFixtureLocation } from './fixtures.js';

const port = Number(process.env.PORT ?? 8787);

let app: ReturnType<typeof createApp>;
try {
  app = createApp(loadDayFixture(resolveFixtureLocation(process.env.FIXTURE_PATH)));
} catch (e) {
  console.error(`차곡 서버를 시작할 수 없습니다: ${(e as Error).message}`);
  process.exit(1);
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`차곡 서버 실행 중: http://localhost:${info.port}`);
});
