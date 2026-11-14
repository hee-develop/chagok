/**
 * "이동 일정이에요"로 바꾼 일정 이름 목록(정책서 10.3: 바꾸면 같은 이름 일정은 다음부터 거르지 않는다).
 * 폰 저장소(AsyncStorage)에 둔다. 이름만 담고 일정 내용은 담지 않는다.
 * 서버 `/skips`(이동 없음 기억 서버 목록)와 잇는 일은 다음 묶음(J2b)이다: `subscribe`로 바뀔 때마다 받아 서버에 올리면 된다.
 */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type TravelExceptionChange = { name: string; travel: boolean };

export type TravelExceptions = {
  /** 저장소에서 목록을 읽어 이름 집합을 돌려준다(처음 한 번만 읽고 기억한다). 저장소 오류는 빈 목록으로 본다. */
  load(): Promise<ReadonlySet<string>>;
  /** 이 일정 제목이 예외인가. load()를 기다린 뒤에만 정확하다. */
  has(title: string): boolean;
  /** 이 이름의 일정을 앞으로 거르지 않는다. */
  add(title: string): Promise<void>;
  /** 예외를 지운다(다시 거르게 됨). */
  remove(title: string): Promise<void>;
  /** 바뀔 때마다 부른다. 해제 함수를 돌려준다(J2b가 서버 목록에 올리는 자리). */
  subscribe(listener: (change: TravelExceptionChange) => void): () => void;
};

export const STORAGE_KEY = 'chagok.travelExceptions.v1';
/** 오래된 이름부터 밀려난다. */
export const MAX_EXCEPTIONS = 500;

/** 앞뒤 공백 제거·연속 공백 하나·대소문자 무시. 서버의 장소 이름 정규화와 같은 규칙이다. */
export const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

// 네이티브 모듈이라 처음 쓸 때 불러온다(테스트·저장소가 없는 환경에서 앱이 죽지 않게).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadAsyncStorage = () => (require('@react-native-async-storage/async-storage') as { default: KeyValueStorage }).default;
const defaultStorage: KeyValueStorage = {
  getItem: async (key) => loadAsyncStorage().getItem(key),
  setItem: async (key, value) => loadAsyncStorage().setItem(key, value),
};

export function createTravelExceptions(storage: KeyValueStorage = defaultStorage): TravelExceptions {
  let names: string[] | null = null;
  let loading: Promise<ReadonlySet<string>> | null = null;
  const listeners = new Set<(change: TravelExceptionChange) => void>();

  const persist = async () => {
    try {
      await storage.setItem(STORAGE_KEY, JSON.stringify(names ?? []));
    } catch {
      // 저장하지 못해도 앱이 떠 있는 동안은 메모리 목록이 맞는다.
    }
  };

  const load = (): Promise<ReadonlySet<string>> => {
    if (names !== null) return Promise.resolve(new Set(names));
    loading ??= (async () => {
      let stored: string[] = [];
      try {
        const raw = await storage.getItem(STORAGE_KEY);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        if (Array.isArray(parsed)) stored = parsed.filter((n): n is string => typeof n === 'string');
      } catch {
        // 읽지 못하면 빈 목록
      }
      // 읽는 동안 add가 먼저 들어왔다면 그 이름을 잃지 않는다.
      names = [...stored, ...(names ?? []).filter((n) => !stored.includes(n))];
      return new Set(names);
    })();
    return loading;
  };

  const notify = (change: TravelExceptionChange) => listeners.forEach((l) => l(change));

  return {
    load,
    has: (title) => (names ?? []).includes(normalizeTitle(title)),
    async add(title) {
      const name = normalizeTitle(title);
      if (name === '') return;
      await load();
      if (!names!.includes(name)) names = [...names!, name].slice(-MAX_EXCEPTIONS);
      await persist();
      notify({ name, travel: true });
    },
    async remove(title) {
      const name = normalizeTitle(title);
      await load();
      if (!names!.includes(name)) return;
      names = names!.filter((n) => n !== name);
      await persist();
      notify({ name, travel: false });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 앱 전체가 하나를 공유한다. */
export const appTravelExceptions = createTravelExceptions();
