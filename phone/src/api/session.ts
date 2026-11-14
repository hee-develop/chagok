import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'chagok.phoneToken';
const DEVICE_KEY = 'chagok.deviceId';
/** 서버가 기기 id를 받는 헤더(server/src/seatScope.ts의 DEVICE_HEADER와 같다). */
export const DEVICE_HEADER = 'x-chagok-device';

/** 폰 토큰을 오래 두는 곳. 기본은 expo-secure-store(Android Keystore)이고 테스트가 바꾼다. */
export type TokenStorage = {
  read: () => Promise<string | null>;
  write: (token: string) => Promise<void>;
  remove: () => Promise<void>;
};

/** 이 폰의 기기 id를 오래 두는 곳. 토큰처럼 expo-secure-store에 둔다(테스트가 바꾼다). */
export type DeviceStorage = {
  read: () => Promise<string | null>;
  write: (id: string) => Promise<void>;
};

const secureDeviceStorage: DeviceStorage = {
  read: () => SecureStore.getItemAsync(DEVICE_KEY),
  write: (id) => SecureStore.setItemAsync(DEVICE_KEY, id),
};

/** 충분히 긴 난수(암호학적 난수 16바이트 = 16진수 32자). 서버가 받는 모양(영문·숫자 22~64자)이다. */
export const newDeviceId = () => Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');

const secureStorage: TokenStorage = {
  read: () => SecureStore.getItemAsync(TOKEN_KEY),
  write: (token) => SecureStore.setItemAsync(TOKEN_KEY, token),
  remove: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};

/**
 * 차와 연결할 때 서버가 준 폰 토큰(운전자 자리). 처음 읽을 때 한 번만 저장소에서 불러와 메모리에 두고,
 * 저장소가 막혀도 이번 실행 동안은 메모리 값으로 동작한다. 토큰이 없으면 서버는 '기본 자리'(연결 전)로 다룬다.
 */
export type Session = {
  /**
   * 이 폰의 기기 id. 첫 실행 때 한 번 만들어 secure-store에 저장하고 모든 요청에 헤더로 붙인다. 서버는 토큰이 없을 때 이 id로
   * 이 폰만의 '연결 전 데이터'를 따로 두고, 연결할 때 그것만 새 자리로 옮긴다. 저장소가 막혀도 이번 실행 동안은 같은 id를 쓴다.
   * 로그에 남기지 않는다. `EXPO_PUBLIC_DEVICE_ID=none`(폰 E2E 전용)이면 보내지 않아 늘 '기본 자리'(null)로 돈다.
   */
  getDeviceId: () => Promise<string | null>;
  getToken: () => Promise<string | null>;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  /** 이 토큰이 아직 현재 토큰이면 지운다(오래된 요청의 401이 새 토큰을 지우지 않게). */
  clearIfCurrent: (token: string) => Promise<void>;
};

export function createSession(
  storage: TokenStorage = secureStorage,
  deviceStorage: DeviceStorage = secureDeviceStorage,
  makeDeviceId: () => string = newDeviceId,
): Session {
  let cache: string | null | undefined;
  let loading: Promise<string | null> | null = null;
  let deviceId: Promise<string> | null = null;

  const getDeviceId = (): Promise<string | null> => {
    // 폰 E2E(Maestro)는 서버를 기기 id 없이 직접 읽어 확인하므로 기기 id를 끄고 '기본 자리'에서 돈다(번들에 박히는 값).
    if (process.env.EXPO_PUBLIC_DEVICE_ID === 'none') return Promise.resolve(null);
    deviceId ??= (async () => {
      const saved = await deviceStorage.read().catch(() => null);
      if (saved && /^[A-Za-z0-9_-]{22,64}$/.test(saved)) return saved;
      const fresh = makeDeviceId();
      await deviceStorage.write(fresh).catch(() => undefined);
      return fresh;
    })();
    return deviceId;
  };

  const getToken = async () => {
    if (cache !== undefined) return cache;
    loading ??= storage.read().catch(() => null);
    const loaded = await loading;
    // 불러오는 동안 setToken·clearToken이 먼저 끝났으면 그 값을 쓴다.
    if (cache === undefined) cache = loaded;
    return cache;
  };
  const setToken = async (token: string) => {
    cache = token;
    await storage.write(token).catch(() => undefined);
  };
  const clearToken = async () => {
    cache = null;
    await storage.remove().catch(() => undefined);
  };
  return {
    getDeviceId,
    getToken,
    setToken,
    clearToken,
    clearIfCurrent: async (token) => {
      if ((await getToken()) === token) await clearToken();
    },
  };
}

export const session = createSession();

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const bearerIn = (init: RequestInit | undefined) => {
  const value = new Headers(init?.headers).get('authorization');
  const m = /^Bearer (\S+)$/.exec(value ?? '');
  return m ? (m[1] as string) : null;
};

/** 다시 보내도 안전한 본문인가(없거나 문자열). 스트림 본문은 한 번 읽으면 끝이라 다시 보내지 않는다. */
const replayable = (init: RequestInit | undefined) => init?.body === undefined || init.body === null || typeof init.body === 'string';

/**
 * 서버가 폰 토큰을 401로 거절하면(다른 폰으로 바뀌었거나 끊겼거나 차곡 초기화) 그 토큰을 버리고,
 * **같은 요청을 토큰 없이(기기 id만으로) 한 번 다시 보낸다**(그 사이 새 토큰이 생겼으면 그 토큰으로). 그러면 방금 요청이 연결 전 상태(그 기기의 연결 전 데이터)로 이어진다.
 * 다시 보낸 요청이 또 401이어도(토큰이 필요한 요청) 그 응답을 그대로 돌려주고 더 보내지 않는다.
 */
export function withSessionReset(target: Session, baseFetch: FetchLike = (input, init) => fetch(input, init)): FetchLike {
  return async (input, init) => {
    const res = await baseFetch(input, init);
    const sent = bearerIn(init);
    if (res.status !== 401 || sent === null) return res;
    await target.clearIfCurrent(sent);
    if (!replayable(init)) return res;
    const headers = new Headers(init?.headers);
    // 그 사이 새 토큰으로 바뀌었으면(오래된 요청의 401) 새 토큰으로, 아니면 토큰 없이 다시 보낸다.
    const current = await target.getToken();
    if (current) headers.set('authorization', `Bearer ${current}`);
    else headers.delete('authorization');
    return baseFetch(input, { ...init, headers });
  };
}

/** 요청마다 붙일 헤더. 기기 id는 늘, 토큰이 있으면 Authorization: Bearer도. */
export const authHeaders = (target: Session) => async (): Promise<Record<string, string>> => {
  const [token, deviceId] = await Promise.all([target.getToken(), target.getDeviceId()]);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceId !== null) headers[DEVICE_HEADER] = deviceId;
  return headers;
};
