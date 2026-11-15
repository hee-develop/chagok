import { displayEventName, normalizeEventName } from '@chagok/server/event-name';

import { HttpError, requestWithTimeout, REQUEST_TIMEOUT_MS } from '../../api/request';
import { deviceStore } from '../../storage/keyValueStore';
import {
  appTravelExceptions,
  LOAD_TIMEOUT_MS,
  type KeyValueStorage,
  type TravelExceptions,
} from '../calendar-sync/travelExceptions';
import { skipsApi, type SkipChange, type SkipEntry, type SkipsApi } from './skipsApi';

/** 화면에 보이는 '이동 없음' 이름. 서버에 아직 올리지 못한 이름은 `addedAt`이 null이다. */
export type SkipItem = { name: string; addedAt: string | null };

export type SkipSyncResult = {
  /** 서버의 목록을 새로 받았는가(보낸 변경의 응답이거나 `GET /skips`). false면 캐시를 그대로 쓴다. */
  refreshed: boolean;
  /**
   * 서버에 올리지 못한 변경이 남았는가(네트워크·5xx·시간 초과·401·429, 또는 맞추는 동안 사용자가 바꾼 변경이 아직 남음). 남은 변경은 다음 동기화에서 다시 올린다.
   * 일정을 보내는 쪽은 이것이 true면 보낸 일정을 서버에 반영된 것으로 기록하지 않는다.
   */
  pendingFailed: boolean;
  /** 서버가 기억 개수 상한이라며(409 `full`) 이름 더하기를 거절했는가. 거절된 이름은 기억하지 못한 것이다(`SkipMemory.full()`). */
  full: boolean;
};

export type SkipMemory = {
  /** 저장소(폰)에서 캐시와 아직 올리지 못한 변경을 읽는다. 시간 제한이 있고 읽지 못해도 던지지 않는다(다음 호출에서 다시 읽는다). */
  load(): Promise<void>;
  /** 이 일정 제목이 '이동 없음'으로 기억한 이름인가(서버 목록 + 올리지 못한 변경). `load()`·`sync()` 뒤에 정확하다. */
  has(title: string): boolean;
  /** 기억한 이름, 최근에 더한 것부터. 바뀔 때만 새 배열이다(`useSyncExternalStore`용). */
  list(): readonly SkipItem[];
  /**
   * 서버가 상한 때문에 이름 더하기를 거절했고 아직 사용자에게 알리지 못했는가(`useSyncExternalStore`용: 바뀌면 `subscribe`로 알린다).
   * 다음에 올리기가 거절 없이 끝나거나 `dismissFull()`을 부르면 false가 된다.
   */
  full(): boolean;
  dismissFull(): void;
  /**
   * 이 이름을 '이동 없음'으로 기억한다. 같은 이름의 '이동 일정이에요' 예외는 지운다(가장 최근 선택이 이긴다).
   * 상태는 바로 바뀌고 서버에는 다음 `sync()`에서 올린다(오프라인이어도 잃지 않는다).
   */
  add(name: string): Promise<void>;
  /** 이 이름의 기억을 지운다. 서버에는 다음 `sync()`에서 올린다. */
  remove(name: string): Promise<void>;
  /** 이 이름의 기억이 지금 있어서 지웠을 때만 지우고(`remove`) true를 돌려준다. 없던 이름은 아무것도 쌓지 않는다(서버에 이름을 올리지 않는다). */
  removeIfPresent(name: string): Promise<boolean>;
  /** 서버에 아직 올리지 못한 변경이 있는가. */
  hasPending(): boolean;
  /**
   * 서버와 맞춘다: 올리지 못한 변경을 먼저 올리고(응답이 새 목록), 없으면 `GET /skips`로 받아 캐시를 바꾼다. 서버 목록에 있는 이름의 예외는 지운다(서버의
   * 기억이 나중이다: 폰이 예외를 더하면 그 이름의 기억을 먼저 지우고 올리므로, 올린 뒤에도 남은 기억은 그 뒤에 차가 더한 것이다). 동시에 하나만 돈다.
   * 이미 도는 동기화에 합류했는데 그 뒤에 사용자가 바꾼 변경이 있으면 끝난 뒤 한 번 더 맞춘다(몇 번까지만). 그래도 남으면 `pendingFailed`다.
   * 실패해도 던지지 않는다(일정 동기화가 멈추면 안 된다).
   */
  sync(): Promise<SkipSyncResult>;
  /** 캐시와 올리지 못한 변경을 모두 버린다(차 연결을 끊었을 때: 서버도 그 자리의 기억을 지운다). 도는 중이던 동기화의 응답은 반영하지 않고 버린다. */
  reset(): Promise<void>;
  subscribe(listener: () => void): () => void;
};

export const SKIPS_STORAGE_KEY = 'chagok.skips.v1';
/** 한 요청에 올리는 이름 수(서버 `MAX_SKIP_CHANGES`). */
const CHANGES_PER_REQUEST = 50;
const MAX_NAME_LENGTH = 200;
/** 맞추는 동안 쌓인 변경 때문에 더 도는 횟수 상한(사용자가 계속 바꿔도 끝나도록). */
const EXTRA_ROUNDS = 2;
/** 같은 요청을 다시 보내면 결과가 달라질 수 있는 4xx: 로그인 풀림(401: 세션 초기화 뒤 다음에 기기 id로)·시간 초과(408)·속도 제한(429). 버리지 않고 다시 올린다. */
const RETRYABLE_CLIENT_ERRORS: ReadonlySet<number> = new Set([401, 408, 429]);

export type SkipMemoryDeps = {
  api?: SkipsApi;
  storage?: KeyValueStorage;
  /** '이동 일정이에요' 예외 목록. 예외를 더하면 같은 이름의 기억을 지우고, 기억을 더하면 같은 이름의 예외를 지운다. */
  exceptions?: Pick<TravelExceptions, 'remove' | 'has' | 'load' | 'readFailed' | 'subscribe'>;
  timeoutMs?: number;
  loadTimeoutMs?: number;
  log?: (message: string) => void;
};

type Stored = { names: SkipEntry[]; pendingAdd: string[]; pendingRemove: string[] };

const devLog = (message: string) => {
  if (__DEV__) console.warn(message);
};

/**
 * 폰의 '이동 없음' 기억 캐시(정책서 10.3 4번). 진짜 목록은 서버(`GET·PUT /skips`, 자리별)이고, 폰은 일정을 거를 때 쓰려고 받아 두고(오프라인이면 캐시를 쓴다)
 * 사용자가 바꾼 것은 '올리지 못한 변경'으로 먼저 기억했다가 서버에 올린다. 서버 목록 + 올리지 못한 더하기 − 올리지 못한 빼기가 지금 목록이다.
 * 사용자의 선택은 서버가 확인할 때까지 이 변경에 남으므로, 서버에서 새로 받은 목록이 방금 한 선택을 되돌리지 않는다(가장 최근 선택이 이긴다).
 */
export function createSkipMemory({
  api = skipsApi,
  storage = deviceStore,
  exceptions = appTravelExceptions,
  timeoutMs = REQUEST_TIMEOUT_MS,
  loadTimeoutMs = LOAD_TIMEOUT_MS,
  log = devLog,
}: SkipMemoryDeps = {}): SkipMemory {
  /** 서버에서 마지막으로 받은 목록. 받은 적 없으면 null. */
  let server: SkipEntry[] | null = null;
  /** 올리지 못한 변경. 키는 정규화한 이름(`normalizeEventName`), 더하기는 보이는 이름을 값으로 둔다. */
  const pendingAdd = new Map<string, string>();
  const pendingRemove = new Set<string>();
  let loaded = false;
  let loading: Promise<void> | null = null;
  let syncing: Promise<SkipSyncResult> | null = null;
  /** `reset()`마다 올린다: 그 전에 시작한 동기화의 응답은 버린다. */
  let generation = 0;
  let fullNotice = false;
  const listeners = new Set<() => void>();
  let snapshot: readonly SkipItem[] = [];
  let keys = new Set<string>();

  const compute = () => {
    const serverKeys = new Set((server ?? []).map((e) => normalizeEventName(e.name)));
    const items: SkipItem[] = [...pendingAdd.entries()]
      .filter(([key]) => !serverKeys.has(key))
      .reverse()
      .map(([, name]) => ({ name, addedAt: null }));
    for (const entry of server ?? []) if (!pendingRemove.has(normalizeEventName(entry.name))) items.push({ name: entry.name, addedAt: entry.addedAt });
    const next = new Set(items.map((i) => normalizeEventName(i.name)));
    const same = items.length === snapshot.length && items.every((i, n) => i.name === snapshot[n]?.name && i.addedAt === snapshot[n]?.addedAt);
    if (!same) snapshot = items;
    keys = next;
    if (!same) listeners.forEach((l) => l());
  };

  const persist = async () => {
    // 저장소를 읽지 못한 동안 쓰면 저장된 캐시·올리지 못한 변경을 덮어쓴다.
    if (!loaded) return;
    const stored: Stored = { names: server ?? [], pendingAdd: [...pendingAdd.values()], pendingRemove: [...pendingRemove] };
    try {
      await storage.setItem(SKIPS_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // 저장하지 못해도 앱이 떠 있는 동안은 메모리 상태가 맞는다.
    }
  };

  const readStored = async (): Promise<Stored | null | 'failed'> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: string | null;
    try {
      raw = await Promise.race([
        storage.getItem(SKIPS_STORAGE_KEY),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), loadTimeoutMs);
        }),
      ]);
    } catch {
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Partial<Record<keyof Stored, unknown>>;
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : []);
      const names = Array.isArray(value.names)
        ? value.names.filter((e): e is SkipEntry => typeof e === 'object' && e !== null && typeof (e as SkipEntry).name === 'string' && typeof (e as SkipEntry).addedAt === 'string')
        : [];
      return { names, pendingAdd: strings(value.pendingAdd), pendingRemove: strings(value.pendingRemove) };
    } catch {
      return null; // 망가진 저장값은 빈 캐시로 보고 다음 저장 때 덮어쓴다
    }
  };

  const load = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    loading ??= (async () => {
      const stored = await readStored();
      loading = null; // 실패해도 다음 load()가 다시 읽는다
      if (stored === 'failed') return;
      if (stored !== null) {
        // 읽기 전에 사용자가 바꾼 것(메모리)이 저장된 변경보다 나중이므로 이긴다.
        server ??= stored.names;
        for (const name of stored.pendingAdd) {
          const key = normalizeEventName(name);
          if (!pendingRemove.has(key) && !pendingAdd.has(key)) pendingAdd.set(key, name);
        }
        for (const name of stored.pendingRemove) {
          const key = normalizeEventName(name);
          if (!pendingAdd.has(key)) pendingRemove.add(key);
        }
      }
      loaded = true;
      compute();
      await persist();
    })();
    return loading;
  };

  /** 저장이 끝나면 부른 쪽이 이어서 일을 하도록 먼저 상태를 바꾼 뒤 읽기·저장을 기다린다. */
  const settle = async () => {
    await load();
    await persist();
  };

  const valid = (name: string) => {
    const display = displayEventName(name);
    // 서버와 같게 글자 수로 센다(이모지는 한 글자).
    return display !== '' && [...display].length <= MAX_NAME_LENGTH ? display : null;
  };

  const setFull = (next: boolean) => {
    if (fullNotice === next) return;
    fullNotice = next;
    listeners.forEach((l) => l());
  };

  type Flushed = { failed: boolean; list: SkipEntry[] | null; full: boolean; stale: boolean };

  /** 한 요청을 보낸다. 서버가 돌려준 목록, 또는 다시 올릴 실패(`failed`)·상한 거절(`full`)·그 밖의 4xx 버림(`dropped`). */
  const send = async (change: SkipChange): Promise<{ list: SkipEntry[] } | { failed: true } | { full: true } | { dropped: true }> => {
    try {
      return { list: await requestWithTimeout((signal) => api.change(change, signal), timeoutMs) };
    } catch (e) {
      if (!(e instanceof HttpError)) {
        log('[skips] 이동 없음 변경 올리기 실패: 다음 동기화에서 다시 올립니다');
        return { failed: true };
      }
      if (e.status >= 500 || RETRYABLE_CLIENT_ERRORS.has(e.status)) {
        log(`[skips] 이동 없음 변경 올리기 실패(HTTP ${e.status}): 다음 동기화에서 다시 올립니다`);
        return { failed: true };
      }
      if (e.status === 409) return { full: true };
      // 그 밖의 4xx는 다시 보내도 같은 결과다(잘못된 이름·옛 서버 등). 이 묶음은 버리고 이어 간다.
      log(`[skips] 이동 없음 변경이 거절돼 버립니다(HTTP ${e.status})`);
      return { dropped: true };
    }
  };

  const flush = async (gen: number): Promise<Flushed> => {
    // 시작할 때의 변경을 올리고, 올리는 동안 사용자가 바꾼 것은 다음 동기화로 남긴다.
    const sentAdd = [...pendingAdd.entries()];
    const sentRemove = [...pendingRemove];
    const ops = [...sentRemove.map((name) => ({ remove: name })), ...sentAdd.map(([, name]) => ({ add: name }))];
    let list: SkipEntry[] | null = null;
    let full = false;
    for (let i = 0; i < ops.length; i += CHANGES_PER_REQUEST) {
      const chunk = ops.slice(i, i + CHANGES_PER_REQUEST);
      const add = chunk.flatMap((o) => ('add' in o ? [o.add] : []));
      const remove = chunk.flatMap((o) => ('remove' in o ? [o.remove] : []));
      let result = await send({ ...(add.length > 0 ? { add } : {}), ...(remove.length > 0 ? { remove } : {}) });
      if (gen !== generation) return { failed: false, list: null, full: false, stale: true }; // reset() 뒤에 온 응답은 버린다
      if ('full' in result) {
        // 상한이라 이 묶음은 모두 거절됐다. 지우기는 상한과 상관없으니 따로 다시 올리고, 더하기는 버린다(기억하지 못한 것이라 사용자에게 알린다).
        full = true;
        if (remove.length > 0) {
          result = await send({ remove });
          if (gen !== generation) return { failed: false, list: null, full: false, stale: true };
        } else {
          result = { dropped: true };
        }
        if ('full' in result) result = { dropped: true };
      }
      if ('failed' in result) return { failed: true, list, full, stale: false };
      // 올린(또는 버린) 변경을 지운다. 그 사이 사용자가 같은 이름을 다시 바꿨으면 그 변경은 남긴다.
      for (const [key, name] of sentAdd) if (add.includes(name) && pendingAdd.get(key) === name) pendingAdd.delete(key);
      for (const name of sentRemove) if (remove.includes(name) && pendingRemove.has(name)) pendingRemove.delete(name);
      if ('list' in result) {
        list = result.list;
        server = list;
      }
      compute();
    }
    return { failed: false, list, full, stale: false };
  };

  const dropOverriddenExceptions = async () => {
    // 서버에 아직 올리지 못한 '지우기'가 있는 이름은 사용자가 방금 이동 일정으로 바꾼 것이라 예외를 둔다.
    if (server === null) return;
    try {
      await exceptions.load();
      if (exceptions.readFailed()) return;
      for (const entry of server) {
        const key = normalizeEventName(entry.name);
        if (!pendingRemove.has(key) && exceptions.has(key)) await exceptions.remove(key);
      }
    } catch {
      // 예외 목록을 정리하지 못해도 다음 동기화에서 다시 본다.
    }
  };

  const emptyResult: SkipSyncResult = { refreshed: false, pendingFailed: false, full: false };

  /** 서버와 한 번 맞춘다. 중간에 `reset()`이 있었으면(`stale`) 응답을 반영하지 않는다. */
  const syncOnce = async (gen: number): Promise<SkipSyncResult & { stale: boolean; uploaded: boolean }> => {
    await load();
    if (gen !== generation) return { ...emptyResult, stale: true, uploaded: false };
    let refreshed = false;
    let pendingFailed = false;
    let full = false;
    let uploaded = false;
    if (pendingAdd.size + pendingRemove.size > 0) {
      const flushed = await flush(gen);
      if (flushed.stale) return { ...emptyResult, stale: true, uploaded: false };
      pendingFailed = flushed.failed;
      refreshed = flushed.list !== null;
      full = flushed.full;
      uploaded = !flushed.failed && !flushed.full;
    }
    if (!refreshed && !pendingFailed) {
      try {
        const fetched = await requestWithTimeout((signal) => api.fetch(signal), timeoutMs);
        if (gen !== generation) return { ...emptyResult, stale: true, uploaded: false };
        server = fetched;
        refreshed = true;
        compute();
      } catch {
        if (gen !== generation) return { ...emptyResult, stale: true, uploaded: false };
        log('[skips] 이동 없음 목록 받기 실패: 저장해 둔 목록으로 이어 갑니다');
      }
    }
    if (refreshed) await dropOverriddenExceptions();
    if (gen !== generation) return { ...emptyResult, stale: true, uploaded: false };
    await persist();
    return { refreshed, pendingFailed, full, stale: false, uploaded };
  };

  const doSync = async (): Promise<SkipSyncResult> => {
    const gen = generation;
    const first = await syncOnce(gen);
    let result: SkipSyncResult = { refreshed: first.refreshed, pendingFailed: first.pendingFailed, full: first.full };
    let uploaded = first.uploaded;
    // 이 동기화에 합류한 호출은 시작 뒤에 사용자가 바꾼 변경을 모른 채 결과를 받는다. 남았으면 한 번 더 올린다.
    for (let round = 0; round < EXTRA_ROUNDS && gen === generation && !result.pendingFailed && pendingAdd.size + pendingRemove.size > 0; round += 1) {
      const next = await syncOnce(gen);
      result = { refreshed: result.refreshed || next.refreshed, pendingFailed: next.pendingFailed, full: result.full || next.full };
      uploaded = uploaded || next.uploaded;
    }
    // 그래도 남았으면(계속 바뀌는 중) 서버에 반영된 것으로 알리지 않는다.
    if (gen === generation && !result.pendingFailed && pendingAdd.size + pendingRemove.size > 0) result = { ...result, pendingFailed: true };
    // 상한 안내는 거절이 있으면 켜고, 거절 없이 올린 뒤나 사용자가 확인하면 끈다(목록만 새로 받는 것으로는 끄지 않는다).
    if (gen === generation) setFull(result.full ? true : uploaded ? false : fullNotice);
    return result;
  };

  const store: SkipMemory = {
    load,
    has: (title) => keys.has(normalizeEventName(title)),
    list: () => snapshot,
    full: () => fullNotice,
    dismissFull: () => setFull(false),
    async add(name) {
      const display = valid(name);
      if (display === null) return;
      const key = normalizeEventName(display);
      pendingRemove.delete(key);
      pendingAdd.delete(key);
      pendingAdd.set(key, display);
      compute();
      // 같은 이름의 예외는 지운다. 예외를 지우는 알림은 이 기억을 건드리지 않는다.
      await exceptions.remove(display).catch(() => undefined);
      await settle();
    },
    async remove(name) {
      const display = valid(name);
      if (display === null) return;
      const key = normalizeEventName(display);
      pendingAdd.delete(key);
      pendingRemove.add(key);
      compute();
      await settle();
    },
    async removeIfPresent(name) {
      const display = valid(name);
      if (display === null || !keys.has(normalizeEventName(display))) return false;
      await store.remove(display);
      return true;
    },
    hasPending: () => pendingAdd.size + pendingRemove.size > 0,
    sync() {
      syncing ??= doSync().finally(() => {
        syncing = null;
      });
      return syncing;
    },
    async reset() {
      generation += 1; // 도는 중인 동기화의 응답은 버린다
      await load(); // 먼저 읽어 둬야 저장된 값이 지운 뒤에 되살아나지 않는다
      generation += 1;
      server = null;
      pendingAdd.clear();
      pendingRemove.clear();
      fullNotice = false;
      compute();
      listeners.forEach((l) => l());
      await persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  // 예외를 더하면(이동 일정이에요) 같은 이름의 기억을 지운다. 지우는 쪽은 서버에 올리는 일을 `sync()`가 한다.
  // 기억에 있는 이름일 때만 지운다: 기억하지 않은 이름의 '지우기'를 쌓으면 폰이 거른 온라인·건물 안 일정의 제목이 `PUT /skips`로 나간다.
  exceptions.subscribe((change) => {
    if (change.travel) void store.removeIfPresent(change.name);
  });
  return store;
}

/** 앱 전체가 하나를 공유한다(일정 동기화·3단계·'이동 없음' 목록이 같은 인스턴스를 쓴다). */
export const appSkipMemory = createSkipMemory();
