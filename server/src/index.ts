import { serve } from '@hono/node-server';
import app from './app.js';

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`차곡 서버 실행 중: http://localhost:${info.port}`);
});
