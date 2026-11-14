import { useSyncExternalStore } from 'react';

import type { NoTravelReason } from '@chagok/server/no-travel';

/**
 * 폰이 거른 이유. online·meetingRoom은 글자로 알아본 것(정책서 10.3 2·3번)이고, skipped는 같은 이름을 '이동 없음'으로 기억해서 거른 것(4번,
 * 서버 `/schedules/places`의 `noTravelReason`과 같은 이름)이다.
 */
export type FilteredReason = NoTravelReason | 'skipped';

/** 폰이 거른 일정. 서버로 보내지 않으므로 이 목록은 폰 안에만 있다(제목·시각·이유만, 장소·메모·참석자는 담지 않는다). */
export type FilteredEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  reason: FilteredReason;
};

export type FilteredEventsStore = {
  get(): readonly FilteredEvent[];
  set(events: readonly FilteredEvent[]): void;
  /** 같은 이름(정규화는 부르는 쪽이 한다)의 일정을 목록에서 뺀다. */
  removeWhere(predicate: (event: FilteredEvent) => boolean): void;
  subscribe(listener: () => void): () => void;
};

export function createFilteredEventsStore(): FilteredEventsStore {
  let events: readonly FilteredEvent[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => events,
    set(next) {
      events = next;
      emit();
    },
    removeWhere(predicate) {
      const kept = events.filter((e) => !predicate(e));
      if (kept.length === events.length) return;
      events = kept;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 앱 전체가 하나를 공유한다(3단계 화면과, 나중에 오늘 일정 화면이 같은 목록을 읽는다). */
export const appFilteredEvents = createFilteredEventsStore();

/** 폰이 거른 일정을 읽는다. 일정을 읽을 때마다 새로 채워진다. */
export function useFilteredEvents(store: FilteredEventsStore = appFilteredEvents): readonly FilteredEvent[] {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
