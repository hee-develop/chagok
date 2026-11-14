import { useMemo, useSyncExternalStore } from 'react';

import { appEventSync, type EventSync, type SyncResult } from './eventSync';

/**
 * 이 폰이 일정을 서버로 보낼 수 없는 이유(홈이 안내할 값).
 * - `permission-denied`: 캘린더 권한이 꺼져 있다 → 권한을 켜 달라고 안내.
 * - `no-selection`: 고른 캘린더가 없다 → 캘린더를 고르라고 안내.
 * 목 출처(`mock`)는 테스트용이라 안내하지 않는다(null).
 */
export type SendBlockReason = 'permission-denied' | 'no-selection';

/**
 * 가장 최근 동기화 결과로 바뀐 이유. 보냈거나 보낼 것이 없거나 목이면 풀린 것(null), 권한·선택 문제면 그 이유,
 * 실패·취소는 아무것도 알려 주지 않으므로 이전 값을 그대로 둔다(잠깐의 네트워크 실패가 안내를 지우거나 만들지 않게).
 */
export function nextSendBlock(previous: SendBlockReason | null, result: SyncResult | null): SendBlockReason | null {
  switch (result) {
    case 'permission-denied':
    case 'no-selection':
      return result;
    case 'sent':
    case 'unchanged':
    case 'mock':
      return null;
    default:
      return previous;
  }
}

type SendBlockStore = { subscribe(listener: () => void): () => void; getSnapshot(): SendBlockReason | null };

/** 동기화 결과를 따라가며 '이전 값 유지' 규칙을 지키는 작은 저장소(구독자가 있는 동안만 동기화를 듣는다). */
function createSendBlockStore(sync: Pick<EventSync, 'subscribe' | 'lastResult'>): SendBlockStore {
  let reason = nextSendBlock(null, sync.lastResult());
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  const update = (result: SyncResult | null) => {
    const next = nextSendBlock(reason, result);
    if (next === reason) return;
    reason = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => reason,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribe = sync.subscribe(update);
        update(sync.lastResult()); // 구독하기 전에 바뀐 결과를 따라잡는다
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribe?.();
          unsubscribe = null;
        }
      };
    },
  };
}

/**
 * 홈이 쓰는 '일정을 보낼 수 없는 이유'. 알림함(`useInbox`)과 별개다: 정책서 10.4('캘린더 거부 → 일정을 쓰지 않는다')에 따라
 * 일정을 보낼 수 없는 폰에는 '일정을 못 받고 있어요' 알림을 띄우거나 쌓지 않고, 이 값으로 홈이 "캘린더 권한을 켜 주세요"·"캘린더를 골라 주세요"를 안내한다.
 * 알림 누름도 이 경우 캘린더 권한·선택 화면으로 보낸다(`taps.ts`). 동기화가 아직 한 번도 끝나지 않았으면 null이다.
 */
export function useEventSendBlock(sync: Pick<EventSync, 'subscribe' | 'lastResult'> = appEventSync): SendBlockReason | null {
  const store = useMemo(() => createSendBlockStore(sync), [sync]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
