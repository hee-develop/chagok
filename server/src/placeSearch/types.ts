/** 장소 검색 포트. 서버만 외부 검색 API를 부른다(차·폰은 서버를 거친다). */

export type LatLng = { lat: number; lng: number };

/** 검색 후보 하나. id는 같은 출처 안에서만 유일하다(목: 목 장소 id, 카카오: `kakao:<장소 id>`). */
export type PlaceCandidate = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** 기준 좌표에서의 직선거리(미터). 기준 좌표가 없으면 null. */
  distanceMeters: number | null;
};

/** 결과의 출처. unavailable은 시간 초과·오류·키 거절 등으로 검색하지 못했다는 뜻이다(0건과 다르다). */
export type SearchSource = 'mock' | 'kakao' | 'unavailable';

export type KeywordQuery = {
  query: string;
  /** 있으면 이 좌표에서 가까운 순으로 돌려준다. */
  near?: LatLng;
  /** 돌려줄 최대 개수. */
  limit: number;
};
export type KeywordResult = {
  places: PlaceCandidate[];
  /** 일치한 장소 수(0·1·2 이상을 가르는 값). 외부 API가 준 전체 개수이고 places보다 클 수 있다. */
  total: number;
  source: SearchSource;
};

/** 주소 한 줄이 좌표로 바뀐 결과. 정확히 한 곳으로 정해진 주소만 돌려준다. */
export type GeocodedPlace = { name: string; address: string; lat: number; lng: number };
export type GeocodeResult = { place: GeocodedPlace | null; source: SearchSource };

export interface PlaceSearch {
  /** 키워드(장소 이름)로 찾는다. 기준 좌표가 있으면 가까운 순. 실패는 던지지 않고 빈 후보 + source "unavailable". */
  searchKeyword(q: KeywordQuery): Promise<KeywordResult>;
  /** 주소를 좌표로 바꾼다. 하나로 정해지지 않으면(없음·여러 곳·행정구역만) place는 null. 실패는 던지지 않고 source "unavailable". */
  geocodeAddress(address: string): Promise<GeocodeResult>;
}

const EARTH_RADIUS_METERS = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** 두 좌표 사이의 직선거리(미터, 하버사인). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h))));
}

export const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
export const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
