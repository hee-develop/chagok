import { useEffect, useSyncExternalStore } from 'react';

import { deviceStore, type KeyValueStore } from '../../storage/keyValueStore';
import type { InboxItem, ServerNotification } from './types';

export const INBOX_KEY = 'chagok.notifications.inbox';
/** 폰 알림함에 두는 알림 수. 넘으면 가장 오래된 것부터 버린다. */
export const MAX_INBOX_ITEMS = 50;
/** 알림을 폰에 두는 기간(7일). 서버 알림함 TTL(3일)보다 길게 둬 홈에서 한동안 볼 수 있다. */
export const INBOX_TTL_MS = 7 * 24 * 60 * 60_000;

export type InboxState = {
  /** 저장소에서 불러오는 것이 끝났는가(그 전에는 목록이 비어 있을 수 있다). */
  loaded: boolean;
  /** 새것이 위(받은 순서의 반대). */
  items: InboxItem[];
  /** 지금까지 받은 가장 큰 알림 id. 다음 `GET /notifications?since=`에 쓰고, 지운 알림이 다시 나타나지 않게 한다. */
  lastId: string | null;
};

export type Inbox = {
  getState(): InboxState;
  subscribe(listener: () => void): () => void;
  /** 저장소에서 불러온다(한 번만 하고 같은 약속을 돌려준다). */
  load(): Promise<void>;
  /**
   * 새 알림만 담고(이미 받았거나 `lastId` 이하인 것은 건너뜀) 담은 것을 돌려준다.
   * `skip`에 든 id는 담지 않고 보여 주지도 않지만 받은 것으로 쳐서 `lastId`는 넘어간다(이미 해결된 알림을 숨기고 다시 받지 않을 때).
   */
  add(list: ServerNotification[], options?: { skip?: ReadonlySet<string> }): Promise<InboxItem[]>;
  markRead(id: string): void;
  markAllRead(): void;
  dismiss(id: string): void;
  /** 이 종류의 알림을 모두 지운다(그 알림이 가리키던 일이 해결됐을 때). `lastId`는 그대로라 지운 알림이 다시 나타나지 않는다. */
  dismissKind(kind: string): void;
  /**
   * `lastId`만 잊는다(담아 둔 알림은 그대로). 서버가 바뀌었거나 서버 시계가 뒤로 가서 `lastId`가 서버가 아는 id보다 커졌을 때 처음부터 다시 받는다.
   * 이미 가진 알림은 `add`가 id로 걸러 다시 담지 않는다.
   */
  resetLastId(): void;
  /** 모두 비우고 `lastId`도 잊는다(차와 연결이 끊기거나 폰을 바꿔 다른 자리가 될 때). */
  clear(): void;
};

/** id는 앞자리 0이 없는 십진수 문자열이라 길이 → 사전순으로 견준다. */
export const compareIds = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

const isString = (v: unknown): v is string => typeof v === 'string';

/** 저장된 JSON에서 알맞은 모양만 살린다(앱 버전이 바뀌거나 값이 깨져도 던지지 않는다). */
function parseStored(raw: string | null): { items: InboxItem[]; lastId: string | null } {
  if (raw === null) return { items: [], lastId: null };
  try {
    const parsed = JSON.parse(raw) as { items?: unknown; lastId?: unknown };
    const items = (Array.isArray(parsed.items) ? parsed.items : []).filter((x): x is InboxItem => {
      const i = x as Partial<InboxItem> | null;
      return (
        typeof i === 'object' && i !== null && isString(i.id) && isString(i.kind) && isString(i.title) && isString(i.body) &&
        isString(i.createdAt) && isString(i.receivedAt) && typeof i.read === 'boolean' && typeof i.data === 'object' && i.data !== null
      );
    });
    return { items, lastId: isString(parsed.lastId) && /^\d+$/.test(parsed.lastId) ? parsed.lastId : null };
  } catch {
    return { items: [], lastId: null };
  }
}

export function createInbox({
  storage = deviceStore,
  now = () => new Date(),
  maxItems = MAX_INBOX_ITEMS,
  ttlMs = INBOX_TTL_MS,
}: { storage?: KeyValueStore; now?: () => Date; maxItems?: number; ttlMs?: number } = {}): Inbox {
  let state: InboxState = { loaded: false, items: [], lastId: null };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;
  let writing: Promise<unknown> = Promise.resolve();
  /** 저장소를 지우는 중이거나 지운 뒤에 늦게 끝난 읽기가 옛 값을 되살리지 않게 하는 세대 번호. */
  let epoch = 0;

  const fresh = (items: InboxItem[]) => {
    const at = now().getTime();
    return items.filter((i) => Date.parse(i.receivedAt) + ttlMs > at);
  };
  const set = (next: Omit<InboxState, 'loaded'>) => {
    state = { loaded: true, ...next };
    for (const listener of [...listeners]) listener();
    const snapshot = JSON.stringify({ v: 1, items: state.items, lastId: state.lastId });
    // 저장은 순서대로 한 번에 하나씩 한다(앞선 저장이 늦게 끝나 뒤의 저장을 덮지 않게). 실패해도 이번 실행은 메모리로 동작한다.
    writing = writing.then(() => storage.setItem(INBOX_KEY, snapshot)).catch(() => undefined);
  };

  const load = () => {
    loading ??= (async () => {
      const startedAt = epoch;
      let raw: string | null = null;
      try {
        raw = await storage.getItem(INBOX_KEY);
      } catch {
        raw = null;
      }
      if (epoch !== startedAt) return; // 읽는 동안 clear()가 불렸다
      const stored = parseStored(raw);
      // 불러오는 동안 이미 add된 것이 있으면 저장된 것과 합친다.
      const byId = new Map<string, InboxItem>();
      for (const item of [...stored.items, ...state.items]) byId.set(item.id, item);
      const items = fresh([...byId.values()]).sort((a, b) => compareIds(b.id, a.id)).slice(0, maxItems);
      const lastId = [stored.lastId, state.lastId].filter((x): x is string => x !== null).sort(compareIds).at(-1) ?? null;
      state = { loaded: true, items, lastId };
      for (const listener of [...listeners]) listener();
    })();
    return loading;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    add: async (list, { skip } = {}) => {
      await load();
      const known = new Set(state.items.map((i) => i.id));
      const lastId = state.lastId;
      const fresher = list
        .filter((n) => !skip?.has(n.id) && !known.has(n.id) && (lastId === null || compareIds(n.id, lastId) > 0))
        .sort((a, b) => compareIds(a.id, b.id));
      let newest = lastId;
      for (const n of list) if (newest === null || compareIds(n.id, newest) > 0) newest = n.id;
      if (fresher.length === 0 && newest === lastId) return [];
      const receivedAt = now().toISOString();
      const added: InboxItem[] = fresher.map((n) => ({ ...n, receivedAt, read: false }));
      const items = fresh([...added, ...state.items])
        .sort((a, b) => compareIds(b.id, a.id))
        .slice(0, maxItems);
      set({ items, lastId: newest });
      return added;
    },
    markRead: (id) => {
      if (!state.items.some((i) => i.id === id && !i.read)) return;
      set({ items: state.items.map((i) => (i.id === id ? { ...i, read: true } : i)), lastId: state.lastId });
    },
    markAllRead: () => {
      if (state.items.every((i) => i.read)) return;
      set({ items: state.items.map((i) => (i.read ? i : { ...i, read: true })), lastId: state.lastId });
    },
    dismiss: (id) => {
      if (!state.items.some((i) => i.id === id)) return;
      set({ items: state.items.filter((i) => i.id !== id), lastId: state.lastId });
    },
    dismissKind: (kind) => {
      if (!state.items.some((i) => i.kind === kind)) return;
      set({ items: state.items.filter((i) => i.kind !== kind), lastId: state.lastId });
    },
    resetLastId: () => {
      if (state.lastId === null) return;
      set({ items: state.items, lastId: null });
    },
    clear: () => {
      epoch += 1;
      loading = Promise.resolve();
      set({ items: [], lastId: null });
    },
  };
}

/** 앱 전체가 하나를 공유한다. */
export const appInbox = createInbox();

export type UseInbox = {
  loaded: boolean;
  /** 새것이 위. 알림 권한을 거부했어도 여기에는 늘 쌓인다(홈에만 보이는 알림). */
  items: InboxItem[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
};

/**
 * 받은 알림을 화면이 구독하는 훅. 알림 권한을 거부해도(또는 Expo Go에서 시스템 알림이 안 떠도) 받은 알림은 여기에 쌓이므로
 * 홈 화면이 맨 위에 보여 주면 정책서 10.4의 "알림 없이 홈에만 보인다"가 된다. 홈 화면 UI는 이 훅 위에 다른 묶음이 붙인다.
 */
export function useInbox(inbox: Inbox = appInbox): UseInbox {
  const state = useSyncExternalStore(inbox.subscribe, inbox.getState, inbox.getState);
  useEffect(() => {
    void inbox.load();
  }, [inbox]);
  return {
    loaded: state.loaded,
    items: state.items,
    unreadCount: state.items.filter((i) => !i.read).length,
    markRead: inbox.markRead,
    markAllRead: inbox.markAllRead,
    dismiss: inbox.dismiss,
  };
}
