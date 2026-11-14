import type { MockPlace } from '../fixture-types.js';
import { MAX_SEARCH_RESULTS } from './limits.js';

/** 앞뒤 공백을 지우고 안쪽 연속 공백을 하나로 줄인다. */
export const normalizeQuery = (raw: string) => raw.trim().replace(/\s+/g, ' ');

/** 공백으로 나눈 검색어가 모두 이름 또는 주소에 들어 있는 장소(개수 제한 없음). 대소문자는 구분하지 않는다. */
export function matchPlaces<T extends Pick<MockPlace, 'name' | 'address'>>(places: T[], query: string): T[] {
  const tokens = normalizeQuery(query).toLowerCase().split(' ');
  return places.filter((p) => {
    const haystack = `${p.name} ${p.address}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

/** 기존 계약: 목 장소를 부분 일치로 찾고 앞에서 MAX_SEARCH_RESULTS개만 남긴다. */
export const searchPlaces = <T extends Pick<MockPlace, 'name' | 'address'>>(places: T[], query: string): T[] =>
  matchPlaces(places, query).slice(0, MAX_SEARCH_RESULTS);
