import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'chagok.phoneToken';

/** 폰 토큰을 오래 두는 곳. 기본은 expo-secure-store(Android Keystore)이고 테스트가 바꾼다. */
export type TokenStorage = {
  read: () => Promise<string | null>;
  write: (token: string) => Promise<void>;
  remove: () => Promise<void>;
};

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
  getToken: () => Promise<string | null>;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  /** 이 토큰이 아직 현재 토큰이면 지운다(오래된 요청의 401이 새 토큰을 지우지 않게). */
  clearIfCurrent: (token: string) => Promise<void>;
};

export function createSession(storage: TokenStorage = secureStorage): Session {
  let cache: string | null | undefined;
  let loading: Promise<string | null> | null = null;

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

/**
 * 서버가 폰 토큰을 401로 거절하면(다른 폰으로 바뀌었거나 끊겼거나 차곡 초기화) 그 토큰을 버린다.
 * 이후 요청은 토큰 없이 가서 연결 전 상태(기본 자리)로 돌아간다.
 */
export function withSessionReset(target: Session, baseFetch: FetchLike = (input, init) => fetch(input, init)): FetchLike {
  return async (input, init) => {
    const res = await baseFetch(input, init);
    const sent = bearerIn(init);
    if (res.status === 401 && sent !== null) await target.clearIfCurrent(sent);
    return res;
  };
}

/** 요청마다 붙일 헤더. 토큰이 있으면 Authorization: Bearer. */
export const authHeaders = (target: Session) => async (): Promise<Record<string, string>> => {
  const token = await target.getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};
