import { SEARCH_CACHE_COORD_DECIMALS, SEARCH_CACHE_MAX_ENTRIES, SEARCH_CACHE_TTL_MS } from './limits.js';
import type { GeocodeResult, KeywordQuery, KeywordResult, PlaceSearch } from './types.js';

type Entry<T> = { value: T; expiresAt: number };

/**
 * 짧은 캐시. 같은 검색어·비슷한 위치(좌표를 소수 3자리로 뭉침)·같은 개수 요청을 TTL 동안 다시 쓴다. 정상 응답(출처가 unavailable이 아닌 것)만 담고,
 * 가득 차면 가장 먼저 넣은 것부터 버린다. 거리 값은 캐시를 만든 요청의 기준 좌표 기준이라 뭉친 범위(약 110m) 안에서는 같은 값을 쓴다.
 */
export function withCache(inner: PlaceSearch, now: () => number = Date.now): PlaceSearch {
  const keyword = new Map<string, Entry<KeywordResult>>();
  const address = new Map<string, Entry<GeocodeResult>>();
  const round = (v: number) => v.toFixed(SEARCH_CACHE_COORD_DECIMALS);
  const read = <T>(map: Map<string, Entry<T>>, key: string): T | null => {
    const hit = map.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now()) {
      map.delete(key);
      return null;
    }
    return hit.value;
  };
  const write = <T>(map: Map<string, Entry<T>>, key: string, value: T) => {
    map.delete(key);
    map.set(key, { value, expiresAt: now() + SEARCH_CACHE_TTL_MS });
    while (map.size > SEARCH_CACHE_MAX_ENTRIES) map.delete(map.keys().next().value as string);
  };
  return {
    searchKeyword: async (q: KeywordQuery) => {
      const key = JSON.stringify([q.query.toLowerCase(), q.near ? [round(q.near.lat), round(q.near.lng)] : null, q.limit]);
      const hit = read(keyword, key);
      if (hit) return hit;
      const result = await inner.searchKeyword(q);
      if (result.source !== 'unavailable') write(keyword, key, result);
      return result;
    },
    geocodeAddress: async (a: string) => {
      const key = a.toLowerCase();
      const hit = read(address, key);
      if (hit) return hit;
      const result = await inner.geocodeAddress(a);
      if (result.source !== 'unavailable') write(address, key, result);
      return result;
    },
  };
}
