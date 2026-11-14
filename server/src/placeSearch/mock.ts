import type { MockPlace } from '../fixture-types.js';
import { matchPlaces, normalizeQuery } from './match.js';
import { distanceMeters, type PlaceCandidate, type PlaceSearch } from './types.js';

const normalizeAddress = (text: string) => normalizeQuery(text).toLowerCase();

/**
 * 픽스처 목 검색(fixtures/places/mock-places.json). `KAKAO_REST_KEY`가 없을 때의 기본이고 테스트·데모·E2E가 쓴다.
 * 이름·주소 부분 일치(기존 `GET /places/search` 규칙)이고 기준 좌표가 있으면 가까운 순, 없으면 파일 순서다.
 * 주소 → 좌표는 목 장소의 주소와 **통째로** 같을 때(뒤에 공백으로 이어지는 동·호 같은 덧붙임은 허용)만 그 장소로 돌려준다.
 */
export function createMockPlaceSearch(places: MockPlace[]): PlaceSearch {
  return {
    searchKeyword: async ({ query, near, limit }) => {
      const matched = matchPlaces(places, query).map(
        (p): PlaceCandidate => ({
          id: p.id,
          name: p.name,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          distanceMeters: near ? distanceMeters(near, p) : null,
        }),
      );
      if (near) matched.sort((a, b) => (a.distanceMeters as number) - (b.distanceMeters as number));
      return { places: matched.slice(0, limit), total: matched.length, source: 'mock' };
    },
    geocodeAddress: async (address) => {
      const text = normalizeAddress(address);
      if (text === '') return { place: null, source: 'mock' };
      const found = places.filter((p) => {
        const full = normalizeAddress(p.address);
        return text === full || text.startsWith(`${full} `);
      });
      const only = found.length === 1 ? found[0] : undefined;
      return { place: only ? { name: only.name, address: only.address, lat: only.lat, lng: only.lng } : null, source: 'mock' };
    },
  };
}
