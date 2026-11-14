import { CLAIM_LOCK_MS, FAILURE_WINDOW_MS, MAX_FAILURES, MAX_GLOBAL_FAILURES, MAX_LOCK_MS, MAX_TRACKED_SOURCES } from '../seats.js';

/**
 * 초대 코드 시도 제한. 차–폰 연결 코드(`seats.ts`의 claim)와 같은 방식과 같은 기준값을 쓴다:
 * - 틀린 코드를 한 요청 주소가 60초 안에 5번 넣으면 그 주소를 60초 막는다(잠긴 동안은 맞는 코드도 막고 잠금을 늘리지 않는다).
 * - 실패 기록 표가 차면(주소 100개) 새 주소의 시도를 잠금으로 본다(fail-closed).
 * - 서버 전체에서 60초 안에 틀린 코드가 120번 쌓이면 모든 주소를 그 창이 지날 때까지 막는다.
 * - 어떤 잠금도 60초(`MAX_LOCK_MS`)를 넘지 않는다.
 */
export type AttemptGuard = {
  /** 막아야 하면 남은 시간(ms, 1초~MAX_LOCK_MS), 아니면 null. */
  blockedFor(source: string): number | null;
  /** 틀린 코드를 넣었다. */
  fail(source: string): void;
  /** 맞는 코드를 넣었다: 그 주소의 실패 횟수를 지운다. */
  succeed(source: string): void;
};

export function createAttemptGuard(now: () => Date): AttemptGuard {
  const failures = new Map<string, number[]>();
  const lockedUntil = new Map<string, number>();
  let globalFailures: number[] = [];
  const purge = (at: number) => {
    for (const [k, until] of lockedUntil) if (until <= at) lockedUntil.delete(k);
    for (const [k, list] of failures) {
      const recent = list.filter((f) => f > at - FAILURE_WINDOW_MS);
      if (recent.length === 0) failures.delete(k);
      else failures.set(k, recent);
    }
    globalFailures = globalFailures.filter((f) => f > at - FAILURE_WINDOW_MS);
  };
  const cap = (ms: number) => Math.min(MAX_LOCK_MS, Math.max(1000, ms));
  return {
    blockedFor: (source) => {
      const at = now().getTime();
      purge(at);
      const until = lockedUntil.get(source);
      if (until !== undefined && at < until) return cap(until - at);
      if (globalFailures.length >= MAX_GLOBAL_FAILURES) return cap((globalFailures[0] as number) + FAILURE_WINDOW_MS - at);
      if (!failures.has(source) && failures.size >= MAX_TRACKED_SOURCES) {
        const oldest = Math.min(...[...failures.values()].map((list) => list[0] as number));
        return cap(oldest + FAILURE_WINDOW_MS - at);
      }
      return null;
    },
    fail: (source) => {
      const at = now().getTime();
      globalFailures.push(at);
      const list = (failures.get(source) ?? []).filter((f) => f > at - FAILURE_WINDOW_MS);
      list.push(at);
      if (list.length >= MAX_FAILURES) {
        lockedUntil.set(source, at + CLAIM_LOCK_MS);
        failures.delete(source);
      } else {
        failures.set(source, list);
      }
    },
    succeed: (source) => {
      failures.delete(source);
    },
  };
}
