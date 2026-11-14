import { FAILURE_LOG_INTERVAL_MS } from './limits.js';
import type { KakaoFailure } from './kakao.js';

/**
 * 검색 실패 로그를 같은 이유(종류·HTTP 상태)는 intervalMs에 한 번만 남긴다. 키가 거절되거나 쿼터가 넘친 서버가 요청마다 같은 줄을 쌓지 않게 한다.
 * 건너뛴 횟수는 다음에 남기는 줄에 `(그 사이 N번 더)`로 붙인다. 키·URL·응답 본문은 받지도 남기지도 않는다.
 */
export function createFailureLog(
  write: (line: string) => void,
  { intervalMs = FAILURE_LOG_INTERVAL_MS, now = Date.now }: { intervalMs?: number; now?: () => number } = {},
): (reason: KakaoFailure, status?: number) => void {
  const last = new Map<string, { at: number; skipped: number }>();
  return (reason, status) => {
    const key = `${reason}:${status ?? ''}`;
    const at = now();
    const seen = last.get(key);
    if (seen && at - seen.at < intervalMs) {
      seen.skipped += 1;
      return;
    }
    const extra = seen && seen.skipped > 0 ? ` (그 사이 ${seen.skipped}번 더)` : '';
    last.set(key, { at, skipped: 0 });
    write(`장소 검색 실패(카카오): ${reason}${status === undefined ? '' : ` ${status}`}${extra}`);
  };
}
