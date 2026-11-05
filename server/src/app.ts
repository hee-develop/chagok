import { Hono } from 'hono';

// RPC 타입 추론을 위해 라우트는 반드시 체이닝으로 정의한다.
const app = new Hono().get('/health', (c) => c.json({ ok: true as const }));

export default app;
export type AppType = typeof app;
