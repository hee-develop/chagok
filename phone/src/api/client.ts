import { hc } from 'hono/client';
import type { AppType } from '@chagok/server';

import { authHeaders, session, withSessionReset } from './session';

// 서버 라우트 타입을 Hono RPC로 공유한다. 타입만 가져오므로 서버 코드는 번들에 들어가지 않는다.
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

// 차와 연결하면(폰 토큰이 있으면) 모든 요청에 토큰을 붙여 운전자 자리로 다룬다. 연결 전에는 토큰이 없어 기본 자리다(계약: docs/pairing.md).
export const api = hc<AppType>(baseUrl, { headers: authHeaders(session), fetch: withSessionReset(session) });

// AppType 추론 확인용: any가 아니라 { ok: true } 응답 타입이어야 한다.
export const fetchHealth = () => api.health.$get();
