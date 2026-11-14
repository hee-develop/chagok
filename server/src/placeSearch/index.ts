import type { MockPlace } from '../fixture-types.js';
import { withCache } from './cache.js';
import { createKakaoPlaceSearch, type KakaoFailure } from './kakao.js';
import { createMockPlaceSearch } from './mock.js';
import type { PlaceSearch } from './types.js';

export * from './types.js';
export { createMockPlaceSearch } from './mock.js';
export { createKakaoPlaceSearch } from './kakao.js';
export { withCache } from './cache.js';
export { createRateLimiter, type RateLimiter, type RateLimiterOptions } from './rateLimit.js';
export { matchPlaces, normalizeQuery, searchPlaces } from './match.js';

export type PlaceSearchEnv = { KAKAO_REST_KEY?: string };

/**
 * 환경 변수로 포트 구현을 고른다: `KAKAO_REST_KEY`가 있으면 카카오 로컬 API(짧은 캐시 포함), 없으면 픽스처 목.
 * `env`는 서버 시작 코드가 넘긴다(createApp은 환경 변수를 읽지 않아 테스트가 환경에 흔들리지 않는다).
 */
export function createPlaceSearch(
  places: MockPlace[],
  env: PlaceSearchEnv = {},
  options: { fetch?: typeof fetch; onFailure?: (reason: KakaoFailure, status?: number) => void; now?: () => number } = {},
): PlaceSearch {
  const key = env.KAKAO_REST_KEY?.trim();
  if (!key) return createMockPlaceSearch(places);
  return withCache(createKakaoPlaceSearch({ apiKey: key, fetch: options.fetch, onFailure: options.onFailure }), options.now);
}
