import { describe, expect, it, vi } from 'vitest';
import type { MockPlace } from '../src/fixture-types.js';
import { looksLikeAddress, parseCoordinateText } from '../src/placeSearch/address.js';
import {
  KAKAO_ADDRESS_URL,
  KAKAO_KEYWORD_URL,
  buildAddressRequest,
  buildKeywordRequest,
  createKakaoPlaceSearch,
  parseAddressResponse,
  parseKeywordResponse,
} from '../src/placeSearch/kakao.js';
import { createFailureLog, createPlaceSearch, createMockPlaceSearch, createRateLimiter, distanceMeters, withCache, type PlaceSearch } from '../src/placeSearch/index.js';
import { SEARCH_CACHE_TTL_MS } from '../src/placeSearch/limits.js';
import { catalog } from './helpers.js';

const KEY = 'test-kakao-rest-key-0123456789';

// 카카오 로컬 API 문서(http://developers.kakao.com/docs/ko/local/dev-guide)의 응답 예시. 키워드로 장소 검색 > 예제.
const KEYWORD_DOC_EXAMPLE = `{
  "meta": {
    "same_name": { "region": [], "keyword": "카카오프렌즈", "selected_region": "" },
    "pageable_count": 14,
    "total_count": 14,
    "is_end": true
  },
  "documents": [
    {
      "place_name": "카카오프렌즈 코엑스점",
      "distance": "418",
      "place_url": "http://place.map.kakao.com/26338954",
      "category_name": "가정,생활 > 문구,사무용품 > 디자인문구 > 카카오프렌즈",
      "address_name": "서울 강남구 삼성동 159",
      "road_address_name": "서울 강남구 영동대로 513",
      "id": "26338954",
      "phone": "02-6002-1880",
      "category_group_code": "",
      "category_group_name": "",
      "x": "127.05902969025047",
      "y": "37.51207412593136"
    }
  ]
}`;
// 주소로 좌표 변환 > 예제(문서의 "전북 삼성동 100" 응답, 4건 중 앞의 1건만 옮김: 건수 4는 meta로만 남긴다).
const ADDRESS_DOC_DOC = `{
  "address_name": "전북 익산시 부송동 100",
  "y": "35.97664845766847",
  "x": "126.99597295767953",
  "address_type": "REGION_ADDR",
  "address": { "address_name": "전북 익산시 부송동 100", "x": "126.99597295767953", "y": "35.97664845766847" },
  "road_address": {
    "address_name": "전북 익산시 망산길 11-17",
    "road_name": "망산길",
    "building_name": "",
    "zone_no": "54547",
    "y": "35.976749396987046",
    "x": "126.99599512792346"
  }
}`;
const ADDRESS_DOC_EXAMPLE_4 = `{ "meta": { "total_count": 4, "pageable_count": 4, "is_end": true }, "documents": [${ADDRESS_DOC_DOC}, ${ADDRESS_DOC_DOC}, ${ADDRESS_DOC_DOC}, ${ADDRESS_DOC_DOC}] }`;
const ADDRESS_ONE = `{ "meta": { "total_count": 1, "pageable_count": 1, "is_end": true }, "documents": [${ADDRESS_DOC_DOC}] }`;

const mp = (id: string, name: string, address: string, lat: number, lng: number): MockPlace => ({ id, name, address, lat, lng });
const STAR_NEAR = mp('s-near', '스타벅스 가까운점', '광주 서구 상무로 1', 35.15, 126.85);
const STAR_MID = mp('s-mid', '스타벅스 중간점', '광주 북구 서림로 2', 35.17, 126.89);
const STAR_FAR = mp('s-far', '스타벅스 먼점', '서울 강남구 테헤란로 3', 37.5, 127.03);
const HERE = { lat: 35.1505, lng: 126.8505 };

describe('distanceMeters', () => {
  it('같은 점은 0이고 서울-광주는 대략 260km다', () => {
    expect(distanceMeters(HERE, HERE)).toBe(0);
    const d = distanceMeters({ lat: 37.5665, lng: 126.978 }, { lat: 35.1595, lng: 126.8526 });
    expect(d).toBeGreaterThan(255_000);
    expect(d).toBeLessThan(275_000);
  });
});

describe('목 검색', () => {
  const search = createMockPlaceSearch([STAR_FAR, STAR_MID, STAR_NEAR, mp('x', '다른 곳', '어딘가', 1, 1)]);
  it('기준 좌표가 있으면 가까운 순이고 total은 일치한 전체 수다', async () => {
    const r = await search.searchKeyword({ query: '스타벅스', near: HERE, limit: 2 });
    expect(r.source).toBe('mock');
    expect(r.total).toBe(3);
    expect(r.places.map((p) => p.id)).toEqual(['s-near', 's-mid']);
    expect(r.places[0]?.distanceMeters).toBeLessThan(r.places[1]?.distanceMeters as number);
  });
  it('기준 좌표가 없으면 파일 순서이고 거리는 null이다', async () => {
    const r = await search.searchKeyword({ query: '스타벅스', limit: 10 });
    expect(r.places.map((p) => p.id)).toEqual(['s-far', 's-mid', 's-near']);
    expect(r.places.every((p) => p.distanceMeters === null)).toBe(true);
  });
  it('일치가 없으면 0건이다', async () => {
    expect(await search.searchKeyword({ query: '없는곳', limit: 2 })).toEqual({ places: [], total: 0, source: 'mock' });
  });
  it('주소는 통째로 같을 때만(뒤에 동·호가 공백으로 이어지는 것은 허용) 좌표가 된다', async () => {
    expect((await search.geocodeAddress('광주 서구 상무로 1')).place).toMatchObject({ name: '스타벅스 가까운점', lat: 35.15 });
    expect((await search.geocodeAddress('  광주  서구 상무로 1 2층 ')).place?.name).toBe('스타벅스 가까운점');
    expect((await search.geocodeAddress('광주 서구 상무로 10')).place).toBeNull();
    expect((await search.geocodeAddress('')).place).toBeNull();
  });
  it('기본 픽스처 목에서 기존 목 장소를 찾는다', async () => {
    const real = createMockPlaceSearch(catalog.places);
    const r = await real.searchKeyword({ query: '육전', limit: 2 });
    expect(r.places.map((p) => p.name)).toEqual(['광주 육전집']);
  });
});

describe('주소·좌표 글자 판별', () => {
  it.each(['광주 서구 상무중앙로 1', '서울 강남구 테헤란로 100', '서울 마포구 샘플대로 56', '광주 광산구 예시길 34', '전북 익산시 부송동 100', '서울 강남구 영동대로 513 2층', '서울 중구 세종대로 110-2'])('주소: %s', (t) => {
    expect(looksLikeAddress(t)).toBe(true);
  });
  it.each(['광주 육전집', '예시 아파트 101동', '체육관', '스타벅스 강남역점', '치과', '5번 출구'])('주소 아님: %s', (t) => {
    expect(looksLikeAddress(t)).toBe(false);
  });
  it('좌표 글자는 위도, 경도 순이고 범위를 벗어나면 읽지 않는다', () => {
    expect(parseCoordinateText('35.1595, 126.8526')).toEqual({ lat: 35.1595, lng: 126.8526 });
    expect(parseCoordinateText('35.1595,126.8526')).toEqual({ lat: 35.1595, lng: 126.8526 });
    expect(parseCoordinateText('95, 126')).toBeNull();
    expect(parseCoordinateText('35 200')).toBeNull();
    expect(parseCoordinateText('광주 1, 2')).toBeNull();
    expect(parseCoordinateText('101동 5')).toBeNull();
  });
});

describe('카카오 어댑터: 요청 조립', () => {
  const parse = (url: string) => new URL(url);
  it('키워드 검색은 x=경도·y=위도, sort=distance, size를 싣고 키는 헤더에만 둔다', () => {
    const req = buildKeywordRequest({ query: '스타벅스 광주', near: { lat: 35.15, lng: 126.85 }, limit: 2 }, KEY);
    const url = parse(req.url);
    expect(`${url.origin}${url.pathname}`).toBe(KAKAO_KEYWORD_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: '스타벅스 광주', x: '126.85', y: '35.15', sort: 'distance', size: '2' });
    expect(req.headers).toEqual({ Authorization: `KakaoAK ${KEY}` });
    expect(req.url).not.toContain(KEY);
  });
  it('기준 좌표가 없으면 x·y·sort를 보내지 않고, size는 1~15로 자른다', () => {
    const none = parse(buildKeywordRequest({ query: '치과', limit: 99 }, KEY).url).searchParams;
    expect([...none.keys()].sort()).toEqual(['query', 'size']);
    expect(none.get('size')).toBe('15');
    expect(parse(buildKeywordRequest({ query: '치과', limit: 0 }, KEY).url).searchParams.get('size')).toBe('1');
  });
  it('반경 설정이 있으면 기준 좌표와 함께 radius를 보낸다', () => {
    const q = parse(buildKeywordRequest({ query: '치과', near: HERE, limit: 2 }, KEY, 20000).url).searchParams;
    expect(q.get('radius')).toBe('20000');
    expect(parse(buildKeywordRequest({ query: '치과', limit: 2 }, KEY, 20000).url).searchParams.has('radius')).toBe(false);
  });
  it('주소 검색 요청', () => {
    const req = buildAddressRequest('광주 서구 상무중앙로 1', KEY);
    const url = parse(req.url);
    expect(`${url.origin}${url.pathname}`).toBe(KAKAO_ADDRESS_URL);
    expect(url.searchParams.get('query')).toBe('광주 서구 상무중앙로 1');
    expect(req.headers.Authorization).toBe(`KakaoAK ${KEY}`);
  });
});

describe('카카오 어댑터: 응답 읽기', () => {
  it('문서 예시(키워드)를 장소로 바꾼다: 도로명 주소 우선, 좌표·거리를 숫자로', () => {
    const r = parseKeywordResponse(JSON.parse(KEYWORD_DOC_EXAMPLE), { lat: 37.514322572335935, lng: 127.06283102249932 });
    expect(r).toEqual({
      places: [{ id: 'kakao:26338954', name: '카카오프렌즈 코엑스점', address: '서울 강남구 영동대로 513', lat: 37.51207412593136, lng: 127.05902969025047, distanceMeters: 418 }],
      total: 14,
    });
  });
  it('도로명 주소가 비면 지번 주소를 쓰고, 거리가 없으면 기준 좌표로 계산하거나 null이다', () => {
    const body = { meta: { total_count: 1 }, documents: [{ id: '1', place_name: 'A', address_name: '지번', road_address_name: '', x: '126.85', y: '35.15' }] };
    expect(parseKeywordResponse(body, HERE)?.places[0]).toMatchObject({ address: '지번', distanceMeters: distanceMeters(HERE, { lat: 35.15, lng: 126.85 }) });
    expect(parseKeywordResponse(body)?.places[0]?.distanceMeters).toBeNull();
  });
  it('모양이 어긋난 문서는 건너뛰고, 본문 모양이 어긋나면 null이다', () => {
    const bad = { meta: { total_count: 3 }, documents: [{ id: '1', place_name: 'A', x: 'abc', y: '1' }, { id: '', place_name: 'B', x: '1', y: '1' }, 7, { id: '2', place_name: 'C', address_name: 'z', x: '126.8', y: '35.1' }] };
    expect(parseKeywordResponse(bad)?.places.map((p) => p.id)).toEqual(['kakao:2']);
    expect(parseKeywordResponse(null)).toBeNull();
    expect(parseKeywordResponse({ documents: [] })).toBeNull();
    expect(parseKeywordResponse({ meta: {}, documents: 'x' })).toBeNull();
  });
  it('total_count가 이상하면 문서 수로 대신한다', () => {
    const body = { meta: { total_count: 'many' }, documents: [{ id: '2', place_name: 'C', address_name: 'z', x: '126.8', y: '35.1' }] };
    expect(parseKeywordResponse(body)?.total).toBe(1);
  });
  it('문서 예시(주소): 4건이면 한 곳으로 정해지지 않아 null이다', () => {
    expect(parseAddressResponse(JSON.parse(ADDRESS_DOC_EXAMPLE_4))).toEqual({ place: null });
  });
  it('주소가 정확히 한 곳(지번 주소)이면 좌표로 바꾼다', () => {
    expect(parseAddressResponse(JSON.parse(ADDRESS_ONE))).toEqual({
      place: { name: '전북 익산시 부송동 100', address: '전북 익산시 부송동 100', lat: 35.97664845766847, lng: 126.99597295767953 },
    });
  });
  it('건물 이름이 있으면 그것이 이름이고, 지명·도로명만이면(REGION·ROAD) 정확한 주소가 아니라 null이다', () => {
    const road = { address_name: '서울 강남구 영동대로 513', x: '127.05', y: '37.51', address_type: 'ROAD_ADDR', road_address: { building_name: '코엑스' } };
    expect(parseAddressResponse({ documents: [road] })?.place?.name).toBe('코엑스');
    expect(parseAddressResponse({ documents: [{ ...road, address_type: 'REGION' }] })).toEqual({ place: null });
    expect(parseAddressResponse({ documents: [{ ...road, address_type: 'ROAD' }] })).toEqual({ place: null });
    expect(parseAddressResponse({ documents: [] })).toEqual({ place: null });
    expect(parseAddressResponse({})).toBeNull();
  });
});

const jsonResponse = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

describe('카카오 어댑터: 호출·실패 처리', () => {
  it('키워드 검색 성공: 요청 URL·헤더가 조립한 대로 나가고 출처는 kakao다', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse(KEYWORD_DOC_EXAMPLE));
    const search = createKakaoPlaceSearch({ apiKey: KEY, fetch: fetchMock as typeof fetch });
    const r = await search.searchKeyword({ query: '카카오프렌즈', near: { lat: 37.5143, lng: 127.0628 }, limit: 2 });
    expect(r.source).toBe('kakao');
    expect(r.total).toBe(14);
    expect(r.places[0]).toMatchObject({ id: 'kakao:26338954', distanceMeters: 418 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(`${KAKAO_KEYWORD_URL}?`)).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe(`KakaoAK ${KEY}`);
    expect(init.method).toBe('GET');
  });
  it('주소 검색 성공', async () => {
    const search = createKakaoPlaceSearch({ apiKey: KEY, fetch: (async () => jsonResponse(ADDRESS_ONE)) as typeof fetch });
    expect(await search.geocodeAddress('전북 익산시 부송동 100')).toMatchObject({ source: 'kakao', place: { lat: 35.97664845766847 } });
  });
  it.each([401, 429, 500])('HTTP %i는 빈 후보 + unavailable이고 키·URL은 어디에도 남지 않는다', async (status) => {
    const seen: unknown[][] = [];
    const search = createKakaoPlaceSearch({
      apiKey: KEY,
      fetch: (async () => jsonResponse(`{"errorType":"x","message":"${KEY}"}`, status)) as typeof fetch,
      onFailure: (...args) => seen.push(args),
    });
    const r = await search.searchKeyword({ query: '치과', limit: 2 });
    expect(r).toEqual({ places: [], total: 0, source: 'unavailable' });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(seen).toEqual([['http', status]]);
    expect(JSON.stringify(seen)).not.toContain(KEY);
    expect((await search.geocodeAddress('서울 강남구 테헤란로 100')).source).toBe('unavailable');
  });
  it('시간 초과는 요청을 끊고 timeout으로 알린다', async () => {
    const seen: unknown[][] = [];
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const search = createKakaoPlaceSearch({ apiKey: KEY, fetch: hang, timeoutMs: 20, onFailure: (...a) => seen.push(a) });
    expect(await search.searchKeyword({ query: '치과', limit: 2 })).toEqual({ places: [], total: 0, source: 'unavailable' });
    expect(seen).toEqual([['timeout']]);
  });
  it('헤더는 왔는데 본문을 받다가 멈추면 timeout이다(format이 아니다). 제한 시간은 본문까지 걸린다', async () => {
    const seen: unknown[][] = [];
    // 본문 스트림이 abort에 반응해 실패하는 실제 fetch처럼 흉내 낸다.
    const stall = ((_url: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;
    const search = createKakaoPlaceSearch({ apiKey: KEY, fetch: stall, timeoutMs: 30, onFailure: (...a) => seen.push(a) });
    expect(await search.searchKeyword({ query: '치과', limit: 2 })).toEqual({ places: [], total: 0, source: 'unavailable' });
    expect(seen).toEqual([['timeout']]);
  });
  it('signal을 무시하는 fetch(응답이 영영 안 옴·본문이 안 닫힘)여도 제한 시간에 끊고 timeout을 한 번만 알린다', async () => {
    const seen: unknown[][] = [];
    const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const endless = (async () => new Response(new ReadableStream({ start() {} }), { status: 200 })) as unknown as typeof fetch;
    for (const f of [never, endless]) {
      const search = createKakaoPlaceSearch({ apiKey: KEY, fetch: f, timeoutMs: 30, onFailure: (...a) => seen.push(a) });
      const started = Date.now();
      expect(await search.searchKeyword({ query: '치과', limit: 2 })).toEqual({ places: [], total: 0, source: 'unavailable' });
      expect(Date.now() - started).toBeLessThan(1000);
    }
    expect(seen).toEqual([['timeout'], ['timeout']]);
  });
  it('네트워크 오류·JSON이 아닌 본문·모양이 어긋난 본문도 던지지 않고 unavailable이다', async () => {
    const seen: unknown[][] = [];
    const make = (f: () => Promise<Response>) => createKakaoPlaceSearch({ apiKey: KEY, fetch: f as typeof fetch, onFailure: (...a) => seen.push(a) });
    const q = { query: '치과', limit: 2 };
    expect((await make(async () => Promise.reject(new TypeError('fetch failed'))).searchKeyword(q)).source).toBe('unavailable');
    expect((await make(async () => jsonResponse('<html>')).searchKeyword(q)).source).toBe('unavailable');
    expect((await make(async () => jsonResponse('{"documents":1}')).searchKeyword(q)).source).toBe('unavailable');
    expect((await make(async () => jsonResponse('{"documents":1}')).geocodeAddress('x')).source).toBe('unavailable');
    expect(seen).toEqual([['network'], ['format'], ['format'], ['format']]);
  });
});

describe('실패 로그: 같은 이유는 일정 시간에 한 번(키 거절·쿼터 초과가 요청마다 쌓이지 않는다)', () => {
  it('같은 이유(종류·상태 코드)는 간격 안에 한 줄만 남기고 건너뛴 횟수를 다음 줄에 붙인다. 이유가 다르면 따로 남긴다', () => {
    let clock = 0;
    const lines: string[] = [];
    const log = createFailureLog((l) => lines.push(l), { intervalMs: 1000, now: () => clock });
    for (let i = 0; i < 50; i++) log('http', 401);
    log('http', 429);
    log('timeout');
    expect(lines).toEqual(['장소 검색 실패(카카오): http 401', '장소 검색 실패(카카오): http 429', '장소 검색 실패(카카오): timeout']);
    clock = 1000;
    log('http', 401);
    expect(lines[3]).toBe('장소 검색 실패(카카오): http 401 (그 사이 49번 더)');
    expect(lines).toHaveLength(4);
    clock = 2000;
    log('http', 401);
    expect(lines[4]).toBe('장소 검색 실패(카카오): http 401');
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });
});

describe('짧은 캐시', () => {
  const counting = () => {
    let calls = 0;
    const inner: PlaceSearch = {
      searchKeyword: async () => {
        calls += 1;
        return { places: [], total: 0, source: 'kakao' };
      },
      geocodeAddress: async () => {
        calls += 1;
        return { place: null, source: 'kakao' };
      },
    };
    return { inner, calls: () => calls };
  };
  it('같은 검색어·가까운 위치(약 110m 안)는 TTL 동안 다시 부르지 않고 지나면 다시 부른다', async () => {
    let t = 1_000_000;
    const { inner, calls } = counting();
    const cached = withCache(inner, () => t);
    await cached.searchKeyword({ query: '치과', near: { lat: 35.15001, lng: 126.85001 }, limit: 2 });
    await cached.searchKeyword({ query: '치과', near: { lat: 35.15004, lng: 126.85004 }, limit: 2 });
    expect(calls()).toBe(1);
    await cached.searchKeyword({ query: '치과', near: { lat: 35.2, lng: 126.85 }, limit: 2 });
    await cached.searchKeyword({ query: '치과', near: HERE, limit: 3 });
    expect(calls()).toBe(3);
    t += SEARCH_CACHE_TTL_MS;
    await cached.searchKeyword({ query: '치과', near: { lat: 35.15001, lng: 126.85001 }, limit: 2 });
    expect(calls()).toBe(4);
    await cached.geocodeAddress('광주 서구 상무중앙로 1');
    await cached.geocodeAddress('광주 서구 상무중앙로 1');
    expect(calls()).toBe(5);
  });
  it('실패(unavailable)는 캐시하지 않는다', async () => {
    let calls = 0;
    const inner: PlaceSearch = {
      searchKeyword: async () => {
        calls += 1;
        return { places: [], total: 0, source: 'unavailable' };
      },
      geocodeAddress: async () => ({ place: null, source: 'unavailable' }),
    };
    const cached = withCache(inner);
    await cached.searchKeyword({ query: 'a', limit: 2 });
    await cached.searchKeyword({ query: 'a', limit: 2 });
    expect(calls).toBe(2);
  });
});

describe('요청 주소별 속도 제한', () => {
  it('창 안에서 max번까지 허용하고 넘으면 거절하며, 창이 지나면 다시 허용한다. 주소끼리는 따로 센다', () => {
    let t = 0;
    const limiter = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect([1, 2, 3, 4].map(() => limiter.take('a'))).toEqual([true, true, true, false]);
    expect(limiter.take('b')).toBe(true);
    t = 999;
    expect(limiter.take('a')).toBe(false);
    t = 1000;
    expect(limiter.take('a')).toBe(true);
  });
  it('기록하는 주소 수가 차면 가장 오래 쓰지 않은 주소의 기록을 버린다', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, maxKeys: 2, now: () => 0 });
    limiter.take('a');
    limiter.take('b');
    limiter.take('c'); // a의 기록이 버려진다
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('c')).toBe(false);
  });
});

describe('createPlaceSearch(환경 변수로 구현 고르기)', () => {
  it('KAKAO_REST_KEY가 없거나 비면 목, 있으면 카카오다', async () => {
    expect((await createPlaceSearch(catalog.places, {}).searchKeyword({ query: '육전', limit: 2 })).source).toBe('mock');
    expect((await createPlaceSearch(catalog.places, { KAKAO_REST_KEY: '  ' }).searchKeyword({ query: '육전', limit: 2 })).source).toBe('mock');
    const fetchMock = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => jsonResponse(KEYWORD_DOC_EXAMPLE));
    const kakao = createPlaceSearch(catalog.places, { KAKAO_REST_KEY: KEY }, { fetch: fetchMock as typeof fetch });
    expect((await kakao.searchKeyword({ query: '카카오프렌즈', limit: 2 })).source).toBe('kakao');
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe(`KakaoAK ${KEY}`);
    await kakao.searchKeyword({ query: '카카오프렌즈', limit: 2 }); // 캐시
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
