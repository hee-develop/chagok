import { hc } from 'hono/client';
import type { AppType } from '@chagok/server';

import { session as phoneSession, type Session } from '../../api/session';
import { memberSession, type MemberSession } from './memberSecret';

/** 서버가 구성원 비밀값을 받는 헤더(server/src/family/groups.ts의 `MEMBER_HEADER`와 같다). */
export const MEMBER_HEADER = 'x-chagok-member';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

const bearerIn = (init: RequestInit | undefined) => {
  const m = /^Bearer (\S+)$/.exec(new Headers(init?.headers).get('authorization') ?? '');
  return m ? (m[1] as string) : null;
};

/** 다시 보내도 안전한 본문인가(없거나 문자열). */
const replayable = (init: RequestInit | undefined) => init?.body === undefined || init.body === null || typeof init.body === 'string';

/** 401 응답이 알려 준 이유(`reason`). 본문이 없거나 JSON이 아니면 null. */
const reasonOf = async (res: Response): Promise<string | null> => {
  try {
    const body = (await res.clone().json()) as { reason?: unknown };
    return typeof body.reason === 'string' ? body.reason : null;
  } catch {
    return null;
  }
};

/**
 * `/family/*`·`/requests`를 부르는 Hono RPC 클라이언트(서버 라우트 타입 공유). 요청마다
 * - 구성원 비밀값이 있으면 `X-Chagok-Member`로 보내고,
 * - 폰 토큰이 있으면 `Authorization: Bearer`도 함께 보낸다(비밀값과 폰 토큰이 같은 요청에 와야 서버가 자리를 구성원에게 묶는다. 연결 뒤 첫 가족 호출도 같다).
 * 기기 id(`X-Chagok-Device`)는 가족 신원이 아니라 보내지 않는다.
 *
 * 401은 이유로 가른다. `unknown-member`(나갔거나 오래 쓰지 않아 정리됨)면 저장한 비밀값을 지우고 응답을 그대로 돌려준다(폰 토큰은 건드리지 않는다).
 * 그 밖의 401은 폰 토큰이 죽은 것이라 토큰을 버리고 같은 요청을 토큰 없이(비밀값만으로) 한 번 다시 보낸다. 이 경우 `withSessionReset`을 그대로 쓰면 안 된다:
 * 비밀값이 죽어 받은 401에도 멀쩡한 폰 토큰을 버리게 되기 때문이다.
 */
export function createFamilyClient({
  url = baseUrl,
  member = memberSession,
  phone = phoneSession,
  fetch: baseFetch = (input, init) => fetch(input, init),
}: { url?: string; member?: MemberSession; phone?: Pick<Session, 'getToken' | 'clearIfCurrent'>; fetch?: FetchLike } = {}) {
  const headers = async (): Promise<Record<string, string>> => {
    const [secret, token] = await Promise.all([member.get(), phone.getToken()]);
    const out: Record<string, string> = {};
    if (secret) out[MEMBER_HEADER] = secret;
    if (token) out.authorization = `Bearer ${token}`;
    return out;
  };

  const settle = async (input: RequestInfo | URL, init: RequestInit | undefined, res: Response, canRetry: boolean): Promise<Response> => {
    if (res.status !== 401) return res;
    const reason = await reasonOf(res);
    if (reason === 'unknown-member') {
      const sentSecret = new Headers(init?.headers).get(MEMBER_HEADER);
      if (sentSecret) await member.clearIfCurrent(sentSecret, 'gone');
      return res;
    }
    const sentBearer = bearerIn(init);
    if (!canRetry || sentBearer === null) return res;
    await phone.clearIfCurrent(sentBearer);
    if (!replayable(init)) return res;
    const retryHeaders = new Headers(init?.headers);
    // 그 사이 새 토큰으로 바뀌었으면(오래된 요청의 401) 새 토큰으로, 아니면 토큰 없이 다시 보낸다.
    const current = await phone.getToken();
    if (current) retryHeaders.set('authorization', `Bearer ${current}`);
    else retryHeaders.delete('authorization');
    const retryInit = { ...init, headers: retryHeaders };
    // 다시 보낸 요청이 비밀값 때문에 401이면(폰 토큰이 먼저 걸러져 비밀값은 아직 확인되지 않았던 경우) 그 비밀값도 지운다.
    return settle(input, retryInit, await baseFetch(input, retryInit), false);
  };

  const familyFetch: FetchLike = async (input, init) => settle(input, init, await baseFetch(input, init), true);

  return hc<AppType>(url, { headers, fetch: familyFetch });
}

export type FamilyClient = ReturnType<typeof createFamilyClient>;

export const familyClient: FamilyClient = createFamilyClient();
