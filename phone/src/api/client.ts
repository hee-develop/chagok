import { hc } from 'hono/client';
import type { AppType } from '@chagok/server';

// 서버 라우트 타입을 Hono RPC로 공유한다. 타입만 가져오므로 서버 코드는 번들에 들어가지 않는다.
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

export const api = hc<AppType>(baseUrl);

// AppType 추론 확인용: any가 아니라 { ok: true } 응답 타입이어야 한다.
export const fetchHealth = () => api.health.$get();
