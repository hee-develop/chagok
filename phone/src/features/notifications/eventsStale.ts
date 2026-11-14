import type { EventSync, SyncResult } from '../calendar-sync/eventSync';

/** 서버 알림 종류 '차곡이 일정을 못 받고 있어요'(서버 `server/src/notify/types.ts`의 `events-stale`). */
export const EVENTS_STALE_KIND = 'events-stale';

/**
 * 일정 동기화 결과가 '못 받고 있어요' 알림에 대해 뜻하는 것.
 * - `resolved`: 서버로 보냈거나(`sent`) 보낼 필요가 없었다(`unchanged`): 문제가 풀렸으니 알림을 보이지 않는다.
 * - `blocked`: 이 폰은 일정을 보낼 수 없다(캘린더 권한 꺼짐·고른 캘린더 없음·목 출처). 시스템 알림도 알림함도 쓰지 않고 홈의 안내가 대신한다
 *   (`useEventSendBlock`, 정책서 10.4 '캘린더 거부 → 일정을 쓰지 않는다'는 알림이 아니라 홈 안내로 알린다).
 * - `unknown`: 실패·취소·결과 없음: 알림을 그대로 보인다(정말 못 보내고 있을 수 있다).
 */
export type StaleOutcome = 'resolved' | 'blocked' | 'unknown';

export function staleOutcomeOf(result: SyncResult | null): StaleOutcome {
  switch (result) {
    case 'sent':
    case 'unchanged':
      return 'resolved';
    case 'permission-denied':
    case 'no-selection':
    case 'mock':
      return 'blocked';
    default:
      return 'unknown';
  }
}

/** 일정 동기화 결과를 기다리는 최대 시간(밀리초). 동기화는 요청마다 10초 제한이라 길어질 수 있어, 이만큼만 기다리고 알림을 그대로 보인다. */
export const SYNC_WAIT_MS = 15_000;

/**
 * 폴링이 `events-stale`을 받았을 때 이 폰의 일정 동기화 결과를 얻는다: 도는 중이면 그 실행이 끝나기를 기다리고, 안 돌고 있으면 한 번 돌려 본다
 * (이 알림은 어차피 '일정을 새로 보내라'는 뜻이다). `waitMs` 안에 끝나지 않거나 던지면 `unknown`.
 */
export async function settleEventsStale(sync: Pick<EventSync, 'inFlight' | 'run'>, waitMs: number = SYNC_WAIT_MS): Promise<StaleOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(sync.inFlight() ?? sync.run()),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), waitMs);
      }),
    ]);
    return staleOutcomeOf(result);
  } catch {
    return 'unknown';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
