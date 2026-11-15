import * as SecureStore from 'expo-secure-store';

const MEMBER_KEY = 'chagok.familyMemberToken';

/** 서버가 받는 구성원 비밀값 모양(server/src/family/groups.ts의 `MEMBER_TOKEN_PATTERN`과 같다: 32~128자의 영문·숫자·`-`·`_`). */
const MEMBER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** 구성원 비밀값을 오래 두는 곳. 기본은 expo-secure-store(Android Keystore)이고 테스트가 바꾼다. */
export type MemberStorage = {
  read: () => Promise<string | null>;
  write: (token: string) => Promise<void>;
  remove: () => Promise<void>;
};

const secureStorage: MemberStorage = {
  read: () => SecureStore.getItemAsync(MEMBER_KEY),
  write: (token) => SecureStore.setItemAsync(MEMBER_KEY, token),
  remove: () => SecureStore.deleteItemAsync(MEMBER_KEY),
};

/**
 * 비밀값이 지워진 이유. `left`는 내가 가족에서 나갔을 때, `gone`은 서버가 모르는 구성원이라 401 `unknown-member`로 알려 줬을 때
 * (다른 곳에서 나갔거나 오래 쓰지 않아 정리됨, 서버를 다시 켬)다.
 */
export type MemberClearReason = 'left' | 'gone';
/** `persisted`가 거짓이면 이번 실행의 메모리에만 있고 저장소에는 쓰지 못한 것이다(앱을 닫으면 잃는다). */
export type MemberEvent = { type: 'set'; persisted: boolean } | { type: 'cleared'; reason: MemberClearReason };

/**
 * 가족 구성원 비밀값(서버가 가족을 만들거나 참여할 때 응답에 한 번만 준 난수). 폰 토큰(`api/session.ts`)과 따로 둔다: **가족은 차와 따로 묶이므로**
 * 차 연결을 끊어도 이 값은 지우지 않는다. 처음 읽을 때 한 번만 저장소에서 불러와 메모리에 두고, 저장소가 막혀도 이번 실행 동안은 메모리 값으로 동작한다.
 * 로그에 남기지 않는다.
 */
export type MemberSession = {
  get: () => Promise<string | null>;
  set: (token: string) => Promise<void>;
  clear: (reason: MemberClearReason) => Promise<void>;
  /** 이 값이 아직 현재 값이면 지운다(오래된 요청의 401이 새로 받은 값을 지우지 않게). */
  clearIfCurrent: (token: string, reason: MemberClearReason) => Promise<void>;
  /** 값이 생기거나 지워질 때마다 부른다(가족 화면이 '가족에서 나왔어요'로 돌아가는 자리). 해제 함수를 돌려준다. 리스너가 던져도 저장은 끝난다. */
  subscribe: (listener: (event: MemberEvent) => void) => () => void;
};

export function createMemberSession(storage: MemberStorage = secureStorage): MemberSession {
  let cache: string | null | undefined;
  let loading: Promise<string | null> | null = null;
  const listeners = new Set<(event: MemberEvent) => void>();
  const emit = (event: MemberEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // 리스너 오류가 저장·지우기를 막지 않는다.
      }
    }
  };

  const get = async () => {
    if (cache !== undefined) return cache;
    // 저장소가 동기로 던지거나 값을 돌려주지 않아도(막힌 환경) 없는 것으로 본다.
    loading ??= Promise.resolve().then(() => storage.read()).catch(() => null);
    const loaded = await loading;
    // 불러오는 동안 set·clear가 먼저 끝났으면 그 값을 쓴다. 모양이 이상한 값은 서버가 400으로 거절하므로 없는 것으로 본다.
    if (cache === undefined) cache = loaded !== null && MEMBER_TOKEN_PATTERN.test(loaded) ? loaded : null;
    return cache;
  };
  const set = async (token: string) => {
    cache = token;
    let persisted = true;
    await Promise.resolve().then(() => storage.write(token)).catch(() => { persisted = false; });
    emit({ type: 'set', persisted });
  };
  const clear = async (reason: MemberClearReason) => {
    const had = (await get()) !== null;
    cache = null;
    if (had) emit({ type: 'cleared', reason });
    await Promise.resolve().then(() => storage.remove()).catch(() => undefined);
  };
  return {
    get,
    set,
    clear,
    clearIfCurrent: async (token, reason) => {
      if ((await get()) === token) await clear(reason);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const memberSession = createMemberSession();
