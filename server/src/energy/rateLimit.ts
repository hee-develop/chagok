/**
 * 요청 주소별 고정 창 속도 제한. 시계는 주입한다(테스트에서 고정).
 * 기억하는 주소 수에 상한이 있고, 가득 차면 만료된 항목을 지운 뒤에도 자리가 없을 때 가장 오래된(창을 가장 먼저 시작한) 항목을 밀어내고 새 주소를 받는다.
 * 새 주소를 막으면 주소를 바꿔 가며 표를 채우는 쪽이 정상 사용자를 전부 막게 되기 때문이다. 대신 표가 가득 차 있는 동안 오래된 주소는 횟수를 잃어
 * 다시 한도만큼 부를 수 있다(속도 제한은 폭주를 줄일 뿐이다, docs/energy.md).
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
          // Map은 넣은 순서(= 창이 시작한 순서)라 앞에서부터 만료된 것을 지우고, 그래도 가득 차면 맨 앞(가장 오래된) 하나를 민다.
          for (const [k, v] of windows) {
            if (t - v.start < windowMs) break;
            windows.delete(k);
          }
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
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
