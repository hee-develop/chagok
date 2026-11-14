import { SEARCH_TIMEOUT_MS } from './limits.js';
import { distanceMeters, isLat, isLng, type GeocodedPlace, type GeocodeResult, type KeywordQuery, type KeywordResult, type LatLng, type PlaceCandidate, type PlaceSearch } from './types.js';

/**
 * 카카오 로컬 API 어댑터. 서버만 부른다(REST API 키는 서버의 환경 변수 `KAKAO_REST_KEY`에만 있다).
 *
 * 맞춘 문서(2026-11-15에 읽음. 페이지는 http://developers.kakao.com/docs/ko/local/dev-guide 로 넘어간다):
 * - 키워드로 장소 검색: GET https://dapi.kakao.com/v2/local/search/keyword.json
 *   헤더 `Authorization: KakaoAK ${REST_API_KEY}`. 파라미터 query(필수)·x(경도)·y(위도)·radius(0~20000 m)·sort(distance|accuracy, 기본 accuracy,
 *   distance는 x·y와 함께)·page(1~45)·size(1~15, 기본 15). 응답 meta.total_count·pageable_count·is_end, documents[]의
 *   id·place_name·address_name·road_address_name·x(경도)·y(위도)·distance(미터, x·y를 보냈을 때만). x·y·distance는 모두 문자열이다.
 * - 주소 검색: GET https://dapi.kakao.com/v2/local/search/address.json
 *   파라미터 query(필수)·analyze_type(similar 기본|exact)·page·size(1~30, 기본 10). 응답 documents[]의 address_name·address_type
 *   (REGION|ROAD|REGION_ADDR|ROAD_ADDR)·x(경도)·y(위도)·address·road_address(building_name 포함).
 * 문서에 없어 **미확인**인 것: 오류 응답 본문 형식, 쿼터 수치, sort=distance를 radius 없이 쓸 때의 동작(문서는 x·y와 함께라고만 함),
 *   `distance`가 없는 문서가 섞일 때의 순서. 그래서 응답은 방어적으로 읽고(필드가 어긋난 문서는 건너뜀, 본문 형식이 어긋나면 실패) 순서는 카카오가 준 대로 믿는다.
 */
export const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
export const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
/** 키워드 검색 size의 문서상 상한. */
export const KAKAO_MAX_SIZE = 15;

export type KakaoFailure = 'timeout' | 'network' | 'http' | 'format';

export type KakaoOptions = {
  /** REST API 키. 로그·응답·오류에 남기지 않는다. */
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 키워드 검색 반경(미터, 0~20000). 없으면 반경 없이 가까운 순으로 받는다. */
  radiusMeters?: number;
  /** 실패 이유 알림(로그용). 키·URL·응답 본문은 넘기지 않는다. */
  onFailure?: (reason: KakaoFailure, status?: number) => void;
};

/** 요청을 조립한다(네트워크 없음). 키는 헤더에만 넣는다. */
export function buildKeywordRequest(q: KeywordQuery, apiKey: string, radiusMeters?: number): { url: string; headers: Record<string, string> } {
  const params = new URLSearchParams({ query: q.query });
  if (q.near) {
    params.set('x', String(q.near.lng)); // x = 경도, y = 위도
    params.set('y', String(q.near.lat));
    params.set('sort', 'distance');
    if (radiusMeters !== undefined) params.set('radius', String(radiusMeters));
  }
  params.set('size', String(Math.min(Math.max(1, Math.floor(q.limit)), KAKAO_MAX_SIZE)));
  return { url: `${KAKAO_KEYWORD_URL}?${params}`, headers: { Authorization: `KakaoAK ${apiKey}` } };
}

export function buildAddressRequest(address: string, apiKey: string): { url: string; headers: Record<string, string> } {
  const params = new URLSearchParams({ query: address, size: '5' });
  return { url: `${KAKAO_ADDRESS_URL}?${params}`, headers: { Authorization: `KakaoAK ${apiKey}` } };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN);

/** 키워드 검색 응답 읽기. 본문 모양이 어긋나면 null(실패), 문서 하나가 어긋나면 그 문서만 건너뛴다. */
export function parseKeywordResponse(body: unknown, near?: LatLng): { places: PlaceCandidate[]; total: number } | null {
  if (!isRecord(body) || !Array.isArray(body.documents) || !isRecord(body.meta)) return null;
  const places: PlaceCandidate[] = [];
  for (const doc of body.documents) {
    if (!isRecord(doc)) continue;
    const id = text(doc.id);
    const name = text(doc.place_name);
    const lat = num(doc.y);
    const lng = num(doc.x);
    if (id === '' || name === '' || !isLat(lat) || !isLng(lng)) continue;
    const given = num(doc.distance);
    places.push({
      id: `kakao:${id}`,
      name,
      address: text(doc.road_address_name) || text(doc.address_name),
      lat,
      lng,
      distanceMeters: Number.isFinite(given) && given >= 0 ? Math.round(given) : near ? distanceMeters(near, { lat, lng }) : null,
    });
  }
  const total = body.meta.total_count;
  return { places, total: typeof total === 'number' && Number.isInteger(total) && total >= places.length ? total : places.length };
}

/**
 * 주소 검색 응답 읽기. **정확히 한 곳**이고 번지·건물까지 있는 주소(ROAD_ADDR·REGION_ADDR)일 때만 장소로 돌려준다.
 * 지명·도로명만(REGION·ROAD)이거나 여러 곳이면 정확한 주소가 아니라서 null이다(키워드 검색으로 넘어간다).
 */
export function parseAddressResponse(body: unknown): { place: GeocodedPlace | null } | null {
  if (!isRecord(body) || !Array.isArray(body.documents)) return null;
  if (body.documents.length !== 1) return { place: null };
  const doc = body.documents[0];
  if (!isRecord(doc)) return { place: null };
  const type = doc.address_type;
  const lat = num(doc.y);
  const lng = num(doc.x);
  if ((type !== 'ROAD_ADDR' && type !== 'REGION_ADDR') || !isLat(lat) || !isLng(lng)) return { place: null };
  const road = isRecord(doc.road_address) ? doc.road_address : null;
  const address = text(doc.address_name);
  if (address === '') return { place: null };
  return { place: { name: (road && text(road.building_name)) || address, address, lat, lng } };
}

export function createKakaoPlaceSearch({ apiKey, fetch: doFetch = fetch, timeoutMs = SEARCH_TIMEOUT_MS, radiusMeters, onFailure }: KakaoOptions): PlaceSearch {
  const unavailable = { places: [], total: 0, source: 'unavailable' as const };
  /**
   * 요청 하나. 어떤 실패든 던지지 않고 null(이유는 onFailure로만 알림). 제한 시간(timeoutMs)은 **헤더를 받는 데서 본문을 다 읽을 때까지** 전체에 걸린다:
   * 본문을 받다가 멈춰도 `timeout`이고, signal을 무시하는 fetch여도 시간이 지나면 끊는다.
   */
  const call = async (req: { url: string; headers: Record<string, string> }): Promise<unknown | null> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 실패는 한 번만 알린다(시간이 지나 끊은 뒤 늦게 도착하는 fetch의 실패는 알리지 않는다).
    let reported = false;
    const fail = (reason: KakaoFailure, status?: number) => {
      if (reported) return;
      reported = true;
      if (status === undefined) onFailure?.(reason);
      else onFailure?.(reason, status);
    };
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('deadline');
      }, timeoutMs);
    });
    const work = (async (): Promise<{ body: unknown } | null> => {
      try {
        const res = await doFetch(req.url, { method: 'GET', headers: req.headers, signal: controller.signal });
        if (!res.ok) {
          fail('http', res.status);
          return null;
        }
        try {
          return { body: await res.json() };
        } catch {
          fail(controller.signal.aborted ? 'timeout' : 'format');
          return null;
        }
      } catch (e) {
        fail(controller.signal.aborted || (e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network');
        return null;
      }
    })();
    try {
      const winner = await Promise.race([work, deadline]);
      if (winner === 'deadline') {
        fail('timeout');
        return null;
      }
      return winner === null ? null : winner.body;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    searchKeyword: async (q): Promise<KeywordResult> => {
      const body = await call(buildKeywordRequest(q, apiKey, radiusMeters));
      if (body === null) return unavailable;
      const parsed = parseKeywordResponse(body, q.near);
      if (parsed === null) {
        onFailure?.('format');
        return unavailable;
      }
      return { ...parsed, source: 'kakao' };
    },
    geocodeAddress: async (address): Promise<GeocodeResult> => {
      const body = await call(buildAddressRequest(address, apiKey));
      if (body === null) return { place: null, source: 'unavailable' };
      const parsed = parseAddressResponse(body);
      if (parsed === null) {
        onFailure?.('format');
        return { place: null, source: 'unavailable' };
      }
      return { place: parsed.place, source: 'kakao' };
    },
  };
}
