import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AppNotification, PushSender } from './types.js';

/**
 * 실제 푸시(FCM HTTP v1)를 보내는 두 번째 `PushSender`. **기본은 꺼짐**이다(환경 변수를 주지 않으면 만들지 않는다).
 * 요청 모양은 공식 문서(docs/notifications.md의 출처 목록)를 따랐고, 이 저장소에서는 실제 FCM 서버와 통신해 확인하지 않았다(미확인).
 * 폰 앱이 Expo Go인 동안은 기기 푸시 토큰을 얻을 수 없어 토큰 등록 경로가 없다(개발 빌드 전환 묶음에서 `PushTokenRegistry`를 채운다).
 */

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_SEND_URL = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
/** 폰 개발 빌드가 만들 알림 채널 id(Android는 앱이 이 채널을 먼저 만들어야 한다). */
export const FCM_ANDROID_CHANNEL_ID = 'chagok-default';
/** FCM이 기기가 꺼져 있을 때 메시지를 들고 있는 시간. 알림함 TTL(3일)보다 짧게, 하루. */
export const FCM_TTL = '86400s';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type FcmRequest = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } };

/**
 * FCM HTTP v1 `projects.messages.send` 요청 조립(네트워크 없음).
 * - 인증: `Authorization: Bearer <OAuth2 접근 토큰>`(서비스 계정 토큰, 범위 firebase.messaging).
 * - 본문: `{ message: { token, notification: { title, body }, data: { 문자열 → 문자열 }, android: { priority, ttl, notification: { channel_id } } } }`.
 *   `data`에 `id`·`kind`를 더해 폰이 알림 종류별로 이동한다. 값은 모두 문자열이어야 한다.
 */
export function buildFcmRequest({ projectId, accessToken, deviceToken, notification }: { projectId: string; accessToken: string; deviceToken: string; notification: AppNotification }): FcmRequest {
  const body = {
    message: {
      token: deviceToken,
      notification: { title: notification.title, body: notification.body },
      data: { ...notification.data, id: notification.id, kind: notification.kind },
      android: { priority: 'HIGH', ttl: FCM_TTL, notification: { channel_id: FCM_ANDROID_CHANNEL_ID } },
    },
  };
  return {
    url: FCM_SEND_URL(projectId),
    init: { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) },
  };
}

/** 자리 → 그 폰의 기기 푸시 토큰(FCM 등록 토큰). 자리가 지워지거나 폰이 바뀌면 버린다. 메모리에만 두고 로그에 남기지 않는다. */
export type PushTokenRegistry = {
  get(seatId: string): string | null;
  set(seatId: string, token: string): void;
  delete(seatId: string): void;
};

export function createPushTokenRegistry(): PushTokenRegistry {
  const tokens = new Map<string, string>();
  return { get: (seatId) => tokens.get(seatId) ?? null, set: (seatId, token) => void tokens.set(seatId, token), delete: (seatId) => void tokens.delete(seatId) };
}

export type FcmSenderOptions = {
  projectId: string;
  /** OAuth2 접근 토큰을 돌려준다(캐시는 구현이 한다). */
  getAccessToken: () => Promise<string>;
  tokens: PushTokenRegistry;
  fetch?: FetchLike;
  /** 실패를 알리는 곳. **상태 코드와 FCM 오류 이름만** 넘기고 토큰·키·알림 내용은 넘기지 않는다. */
  log?: (message: string) => void;
};

const safeLog = (log: (message: string) => void, message: string) => {
  try {
    log(message);
  } catch {
    // 로그가 던져도 보내기는 끝낸다.
  }
};

/** FCM 오류 본문에서 `error.status`(예: UNREGISTERED)만 꺼낸다. 다른 내용은 읽지도 남기지도 않는다. */
const fcmErrorName = async (res: { text(): Promise<string> }) => {
  try {
    const parsed = JSON.parse(await res.text()) as { error?: { status?: unknown } };
    const status = parsed.error?.status;
    return typeof status === 'string' && /^[A-Z_]{1,40}$/.test(status) ? status : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
};

export function createFcmSender({ projectId, getAccessToken, tokens, fetch: doFetch = globalThis.fetch as unknown as FetchLike, log = (m) => console.warn(m) }: FcmSenderOptions): PushSender {
  return {
    send: async (seatId, notification) => {
      const deviceToken = tokens.get(seatId);
      if (deviceToken === null) return; // 이 폰은 푸시 토큰이 없다(Expo Go 등): 알림함 폴링으로만 받는다.
      try {
        const request = buildFcmRequest({ projectId, accessToken: await getAccessToken(), deviceToken, notification });
        const res = await doFetch(request.url, request.init);
        if (res.ok) return;
        const name = await fcmErrorName(res);
        // 기기가 FCM에서 등록 해제됐으면 토큰을 버린다(UNREGISTERED, 404).
        if (res.status === 404 && name === 'UNREGISTERED') tokens.delete(seatId);
        safeLog(log, `FCM 전송 실패: HTTP ${res.status} ${name}`);
      } catch (e) {
        safeLog(log, `FCM 전송 실패: ${e instanceof Error ? e.name : 'error'}`);
      }
    },
    forget: (seatId) => tokens.delete(seatId),
  };
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

export type ServiceAccount = { clientEmail: string; privateKey: string };

/**
 * 서비스 계정 키로 OAuth2 접근 토큰을 받는 함수(JWT bearer, RS256). 토큰은 만료 1분 전까지 다시 쓴다.
 * JWT: header `{ alg: RS256, typ: JWT }`, claim `{ iss, scope, aud: token 주소, iat, exp(iat+1시간) }`, 서명은 SHA256withRSA.
 * 요청: `POST https://oauth2.googleapis.com/token`, `application/x-www-form-urlencoded`, `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<JWT>`.
 */
/** 접근 토큰 요청이 실패한 뒤 다시 시도하기까지 기다리는 시간: 30초에서 시작해 실패할 때마다 두 배, 최대 10분. 성공하면 처음으로 돌아간다. */
export const TOKEN_RETRY_INITIAL_MS = 30_000;
export const TOKEN_RETRY_MAX_MS = 10 * 60_000;

export function createServiceAccountTokenProvider({
  account,
  fetch: doFetch = globalThis.fetch as unknown as FetchLike,
  now = () => new Date(),
  retryInitialMs = TOKEN_RETRY_INITIAL_MS,
  retryMaxMs = TOKEN_RETRY_MAX_MS,
}: {
  account: ServiceAccount;
  fetch?: FetchLike;
  now?: () => Date;
  retryInitialMs?: number;
  retryMaxMs?: number;
}): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;
  let loading: Promise<string> | null = null;
  // 요청이 실패하면 retryAt까지는 새 요청을 보내지 않고 그 오류를 그대로 던진다(알림마다 인증 서버를 두드리지 않게).
  let failure: { retryAt: number; error: Error; delayMs: number } | null = null;
  const fetchToken = async () => {
    const iat = Math.floor(now().getTime() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: account.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }));
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.privateKey);
    const assertion = `${header}.${claims}.${b64url(signature)}`;
    const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    const res = await doFetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (!res.ok) throw new Error(`FCM 인증 토큰 요청 실패: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string' || json.access_token === '') throw new Error('FCM 인증 토큰 응답에 access_token이 없습니다');
    const expiresIn = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
    cached = { token: json.access_token, expiresAt: now().getTime() + expiresIn * 1000 };
    failure = null;
    return json.access_token;
  };
  const fetchWithBackoff = async () => {
    try {
      return await fetchToken();
    } catch (e) {
      // 던진 오류에는 서명·키 내용이 없다(상태 코드나 짧은 문구만). 이름과 메시지만 다음 호출에 다시 던진다.
      const delayMs = failure === null ? retryInitialMs : Math.min(failure.delayMs * 2, retryMaxMs);
      const error = e instanceof Error ? e : new Error('FCM 인증 토큰 요청 실패');
      failure = { retryAt: now().getTime() + delayMs, error, delayMs };
      throw error;
    }
  };
  return async () => {
    if (cached && cached.expiresAt - 60_000 > now().getTime()) return cached.token;
    if (failure !== null && now().getTime() < failure.retryAt) throw failure.error;
    loading ??= fetchWithBackoff().finally(() => {
      loading = null;
    });
    return loading;
  };
}

export type FcmConfig = { projectId: string; account: ServiceAccount };

/**
 * 환경 변수로 FCM을 켠다. 기본은 꺼짐(null).
 * - `FCM_SERVICE_ACCOUNT_FILE`: 서비스 계정 JSON 키 파일 경로(`client_email`, `private_key`, `project_id`). 이 변수가 있어야 켜진다.
 * - `FCM_PROJECT_ID`: 파일의 `project_id`를 덮어쓴다(선택).
 * 키 내용은 읽어서 서명에만 쓰고 로그·오류 메시지에 싣지 않는다. 파일이 없거나 모양이 틀리면 던진다(키 내용 없이, 경로만).
 */
export function loadFcmConfigFromEnv(env: Record<string, string | undefined>, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): FcmConfig | null {
  const path = env.FCM_SERVICE_ACCOUNT_FILE;
  if (path === undefined || path === '') return null;
  let parsed: { client_email?: unknown; private_key?: unknown; project_id?: unknown };
  try {
    parsed = JSON.parse(readFile(path));
  } catch {
    throw new Error(`FCM_SERVICE_ACCOUNT_FILE(${path})을 읽을 수 없거나 JSON이 아닙니다`);
  }
  const projectId = env.FCM_PROJECT_ID || (typeof parsed.project_id === 'string' ? parsed.project_id : '');
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string' || projectId === '') {
    throw new Error(`FCM_SERVICE_ACCOUNT_FILE(${path})에 client_email·private_key·project_id가 필요합니다`);
  }
  return { projectId, account: { clientEmail: parsed.client_email, privateKey: parsed.private_key } };
}
