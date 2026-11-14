import { MAX_EXTERNAL_QUERY_LENGTH, SEARCH_CACHE_COORD_DECIMALS } from './limits.js';
import type { GeocodeResult, KeywordResult, LatLng, PlaceSearch } from './types.js';

/**
 * 자리의 종류에 맞춰 검색 포트의 결과를 거른다. **실제 자리(연결된 자리·연결 전 버킷)에서는 목 데이터를 쓰지 않는다**:
 * 포트가 목(`source: "mock"`)으로 답해도 목 장소를 실제 사용자에게 보이지 않도록 '검색 못 함'(`unavailable`)으로 바꾼다.
 * 목은 기본 자리(픽스처·데모·E2E)와 `FIXTURE_SEATS=1`에서만 쓴다(`usesMock`). 카카오 같은 실제 출처는 그대로 통과한다.
 */
export function scopedSearch(inner: PlaceSearch, usesMock: boolean): PlaceSearch {
  if (usesMock) return inner;
  return {
    searchKeyword: async (q): Promise<KeywordResult> => {
      const found = await inner.searchKeyword(q);
      return found.source === 'mock' ? { places: [], total: 0, source: 'unavailable' } : found;
    },
    geocodeAddress: async (address): Promise<GeocodeResult> => {
      const found = await inner.geocodeAddress(address);
      return found.source === 'mock' ? { place: null, source: 'unavailable' } : found;
    },
  };
}

/** 외부로 보내는 검색어: 앞뒤 공백을 지우고 MAX_EXTERNAL_QUERY_LENGTH글자(코드 포인트)로 자른다. 긴 일정 제목이 통째로 밖으로 나가지 않는다. */
export const externalQuery = (text: string): string => Array.from(text.trim()).slice(0, MAX_EXTERNAL_QUERY_LENGTH).join('').trim();

/** 외부로 보내는 현재 위치: 소수 SEARCH_CACHE_COORD_DECIMALS자리(약 110m)로 줄인다. 캐시 키가 뭉치는 자리와 같다. */
export const coarseLocation = (near: LatLng): LatLng => ({
  lat: Number(near.lat.toFixed(SEARCH_CACHE_COORD_DECIMALS)),
  lng: Number(near.lng.toFixed(SEARCH_CACHE_COORD_DECIMALS)),
});
