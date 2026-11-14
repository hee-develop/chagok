import { RATE_LIMIT_MAX, RATE_LIMIT_MAX_ADDRESSES, RATE_LIMIT_WINDOW_MS } from './limits.js';

export type RateLimiter = {
  /** 이 키(요청 주소)의 호출을 하나 센다. 한도를 넘었으면 false(세지 않음). */
  take(key: string): boolean;
};

export type RateLimiterOptions = { max?: number; windowMs?: number; maxKeys?: number; now?: () => number };

/** 요청 주소별 고정 길이 창 속도 제한(메모리). 기록이 maxKeys개를 넘으면 가장 오래 쓰지 않은 주소의 기록부터 버린다. */
export function createRateLimiter({ max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS, maxKeys = RATE_LIMIT_MAX_ADDRESSES, now = Date.now }: RateLimiterOptions = {}): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take: (key) => {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((t) => t > at - windowMs);
      hits.delete(key); // 다시 넣어 '가장 최근에 쓴' 자리로 옮긴다
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      hits.set(key, [...recent, at]);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return true;
    },
  };
}
