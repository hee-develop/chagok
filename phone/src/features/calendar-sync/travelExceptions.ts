import { deviceStore } from '../../storage/keyValueStore';

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
  /**
   * 저장소에서 목록을 읽어 이름 집합을 돌려준다. 읽기는 `LOAD_TIMEOUT_MS` 안에 끝나지 않으면 실패로 본다.
   * 읽는 데 성공하면 이후 다시 읽지 않는다. 실패하면 이 세션에서 더한 이름만 담은 집합을 돌려주고(거부하지 않는다: 동기화가 멈추면 안 된다)
   * 다음 호출에서 다시 읽는다. 실패하는 동안에는 저장소의 기존 목록을 덮어쓰지 않는다.
   */
  load(): Promise<ReadonlySet<string>>;
  /** 이 일정 제목이 예외인가. load()를 기다린 뒤에만 정확하다. */
  has(title: string): boolean;
  /** 이 이름의 일정을 앞으로 거르지 않는다. */
  add(title: string): Promise<void>;
  /** 예외를 지운다(다시 거르게 됨). */
  remove(title: string): Promise<void>;
  /**
   * 방금 `add`한 것을 취소한다(저장에 실패해 되돌릴 때). `remove`와 달리 저장소를 아직 읽지 못한 동안에는 이 세션의 메모리 목록에서만 빼고
   * 저장소의 기존 이름을 지우지 않는다(읽은 뒤에 되살아난다). 읽지 못해 `has`가 틀렸을 수 있으므로, 원래 예외였는지는 부르는 쪽이 `add` 전에 `has`로 본 값을 넘긴다.
   * `wasException`이 true면 아무것도 하지 않는다. 읽지 못한 동안의 취소는 바뀐 것을 알릴 수 없어 `subscribe` 알림도 하지 않는다.
   */
  rollbackAdd(title: string, wasException: boolean): Promise<void>;
  /** 저장소를 아직 읽지 못한 상태인가(true인 동안 `has`는 저장된 이름을 모른다). */
  readFailed(): boolean;
  /** 바뀔 때마다 부른다. 해제 함수를 돌려준다(J2b가 서버 목록에 올리는 자리). */
  subscribe(listener: (change: TravelExceptionChange) => void): () => void;
};

export const STORAGE_KEY = 'chagok.travelExceptions.v1';
/** 오래된 이름부터 밀려난다. */
export const MAX_EXCEPTIONS = 500;
/** 저장소 읽기가 이 시간 안에 끝나지 않으면 읽기 실패로 본다(동기화가 영영 멈추지 않게). */
export const LOAD_TIMEOUT_MS = 5_000;

/** 앞뒤 공백 제거·연속 공백 하나·대소문자 무시. 서버의 장소 이름 정규화와 같은 규칙이다. */
export const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

// AsyncStorage는 `storage/keyValueStore.ts` 한 곳에서만 불러온다.
const defaultStorage: KeyValueStorage = {
  getItem: (key) => deviceStore.get(key),
  setItem: (key, value) => deviceStore.set(key, value),
};

export function createTravelExceptions(
  storage: KeyValueStorage = defaultStorage,
  { loadTimeoutMs = LOAD_TIMEOUT_MS }: { loadTimeoutMs?: number } = {},
): TravelExceptions {
  /** 메모리 목록. 저장소를 읽기 전에 더한 이름도 여기에 있다. */
  let names: string[] = [];
  /** 저장소를 한 번 읽는 데 성공했는가. 성공해야 쓴다. */
  let loaded = false;
  let failed = false;
  /** 읽기 전에 지운 이름: 읽은 뒤 저장소에 남아 있어도 되살리지 않는다. */
  const removedBeforeLoad = new Set<string>();
  /** 읽기 전에 바꾼 것이 있어 읽은 뒤 한 번 써야 하는가. */
  let dirty = false;
  let loading: Promise<ReadonlySet<string>> | null = null;
  const listeners = new Set<(change: TravelExceptionChange) => void>();

  const persist = async () => {
    // 읽지 못한 동안 쓰면 저장소의 기존 목록을 이 세션의 일부 목록으로 덮어쓴다.
    if (!loaded) return;
    try {
      await storage.setItem(STORAGE_KEY, JSON.stringify(names));
    } catch {
      // 저장하지 못해도 앱이 떠 있는 동안은 메모리 목록이 맞는다.
    }
  };

  /** 저장된 이름. 저장소를 읽지 못하거나 시간이 넘으면 null(읽기 실패). 내용이 망가졌으면 빈 목록(다음 저장 때 덮어쓴다). */
  const readStored = async (): Promise<string[] | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: string | null;
    try {
      raw = await Promise.race([
        storage.getItem(STORAGE_KEY),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), loadTimeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    try {
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
    } catch {
      return [];
    }
  };

  const load = (): Promise<ReadonlySet<string>> => {
    if (loaded) return Promise.resolve(new Set(names));
    loading ??= (async () => {
      const stored = await readStored();
      loading = null; // 실패해도 다음 load()가 다시 읽는다
      if (stored === null) {
        failed = true;
        return new Set(names);
      }
      failed = false;
      // 읽는 동안·읽기 전에 더한 이름은 잃지 않고, 지운 이름은 되살리지 않는다.
      names = [...stored.filter((n) => !removedBeforeLoad.has(n)), ...names.filter((n) => !stored.includes(n))].slice(-MAX_EXCEPTIONS);
      removedBeforeLoad.clear();
      loaded = true;
      if (dirty) {
        dirty = false;
        await persist();
      }
      return new Set(names);
    })();
    return loading;
  };

  const notify = (change: TravelExceptionChange) => listeners.forEach((l) => l(change));

  const store: TravelExceptions = {
    load,
    has: (title) => names.includes(normalizeTitle(title)),
    readFailed: () => failed,
    async add(title) {
      const name = normalizeTitle(title);
      if (name === '') return;
      await load();
      removedBeforeLoad.delete(name);
      if (!names.includes(name)) names = [...names, name].slice(-MAX_EXCEPTIONS);
      if (loaded) await persist();
      else dirty = true;
      notify({ name, travel: true });
    },
    async remove(title) {
      const name = normalizeTitle(title);
      await load();
      if (loaded && !names.includes(name)) return;
      names = names.filter((n) => n !== name);
      if (loaded) await persist();
      else {
        // 저장소에 남아 있을 수 있으니 읽은 뒤에도 빼도록 기억한다.
        removedBeforeLoad.add(name);
        dirty = true;
      }
      notify({ name, travel: false });
    },
    async rollbackAdd(title, wasException) {
      if (wasException) return;
      const name = normalizeTitle(title);
      if (loaded) {
        await store.remove(title);
        return;
      }
      // 저장소를 읽지 못했다: 이 세션이 더한 이름만 메모리에서 빼고, 저장소에 원래 있던 이름은 건드리지 않는다.
      names = names.filter((n) => n !== name);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

/** 앱 전체가 하나를 공유한다. */
export const appTravelExceptions = createTravelExceptions();
