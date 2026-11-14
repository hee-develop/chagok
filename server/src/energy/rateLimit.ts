/**
 * 요청 주소별 고정 창 속도 제한. 시계는 주입한다(테스트에서 고정).
 * 기억하는 주소 수에 상한이 있고, 가득 차면 만료된 항목을 지운 뒤에도 자리가 없을 때 새 주소를 거절한다.
 */
export type RateLimiter = { check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } };

export function createRateLimiter({ limit, windowMs, maxKeys, now }: { limit: number; windowMs: number; maxKeys: number; now: () => number }): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(key) {
      const t = now();
      let w = windows.get(key);
      if (w && t - w.start >= windowMs) {
        windows.delete(key);
        w = undefined;
      }
      if (!w) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
          if (windows.size >= maxKeys) return { ok: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        }
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
      w.count += 1;
      return { ok: true };
    },
  };
}
