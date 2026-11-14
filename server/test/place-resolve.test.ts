import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockPlace } from '../src/fixture-types.js';
import { parsePlacesCatalog } from '../src/fixtures.js';
import { createKakaoPlaceSearch, type PlaceSearch } from '../src/placeSearch/index.js';
import { catalog, newApp } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const KEY = 'resolve-test-kakao-key-9876543210';
const mp = (id: string, name: string, address: string, lat: number, lng: number): MockPlace => ({ id, name, address, lat, lng });
// 광주 상무지구(HERE) 기준으로 가까운 순: near < mid < far
const HERE = { lat: 35.1505, lng: 126.8505 };
const STARS = [
  mp('s-far', '스타벅스 먼점', '서울 강남구 테헤란로 3', 37.5, 127.03),
  mp('s-mid', '스타벅스 중간점', '광주 북구 서림로 2', 35.17, 126.89),
  mp('s-near', '스타벅스 가까운점', '광주 서구 상무로 1', 35.15, 126.85),
  mp('only', '유일한 약국', '광주 서구 약국로 9', 35.151, 126.851),
  mp('home-addr', '샘플 아파트', '광주 서구 상무중앙로 1', 35.1595, 126.8526),
];
const custom = (extra: Parameters<typeof newApp>[0] = {}) =>
  newApp({ places: parsePlacesCatalog({ places: STARS }, { suggestions: [] }), ...extra });

type App = ReturnType<typeof newApp>;
type Resolved = {
  memory: { place: { name: string; address: string | null; lat: number; lng: number }; ambiguous: boolean } | null;
  candidates: { id: string; name: string; address: string; lat: number; lng: number; distanceMeters: number | null }[];
  total: number;
  source: string;
  via: string;
};
const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const resolve = async (app: App, body: unknown) => {
  const res = await post(app, '/places/resolve', body);
  return { status: res.status, body: (await res.json()) as Resolved };
};
const remember = (app: App, name: string, place: { name: string; lat: number; lng: number; address?: string }, ambiguous: boolean) =>
  app.request('/places/memory', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, place, ambiguous }) });

describe('POST /places/resolve: 검색 결과 0개·1개·2개 이상', () => {
  it('0개: 후보 없음, total 0, source는 mock(검색은 했다)', async () => {
    const { status, body } = await resolve(custom(), { name: '없는가게', ...HERE });
    expect(status).toBe(200);
    expect(body).toEqual({ memory: null, candidates: [], total: 0, source: 'mock', via: 'search' });
  });

  it('1개: 후보 하나, total 1', async () => {
    const { body } = await resolve(custom(), { name: '약국', ...HERE });
    expect(body.total).toBe(1);
    expect(body.candidates.map((c) => c.id)).toEqual(['only']);
    expect(body.via).toBe('search');
  });

  it('2개 이상: 현재 위치에서 가까운 2개만 가까운 순으로, total은 전체 일치 수', async () => {
    const { body } = await resolve(custom(), { name: '스타벅스', ...HERE });
    expect(body.total).toBe(3);
    expect(body.candidates.map((c) => c.id)).toEqual(['s-near', 's-mid']);
    const [a, b] = body.candidates;
    expect(a?.distanceMeters).toBeGreaterThan(0);
    expect(a?.distanceMeters as number).toBeLessThan(b?.distanceMeters as number);
    expect(body.memory).toBeNull();
  });

  it('위치를 바꾸면 순서가 바뀐다(서울에서는 먼점이 먼저)', async () => {
    const { body } = await resolve(custom(), { name: '스타벅스', lat: 37.5, lng: 127.03 });
    expect(body.candidates[0]?.id).toBe('s-far');
  });

  it('위치 없이도 받는다(거리는 null)', async () => {
    const { status, body } = await resolve(custom(), { name: '스타벅스' });
    expect(status).toBe(200);
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates.every((c) => c.distanceMeters === null)).toBe(true);
  });

  it('후보에는 픽스처 전용 필드(fictional)를 내보내지 않는다', async () => {
    const { body } = await resolve(newApp(), { name: '육전' });
    expect(body.candidates).toHaveLength(1);
    expect(Object.keys(body.candidates[0] as object).sort()).toEqual(['address', 'distanceMeters', 'id', 'lat', 'lng', 'name']);
  });
});

describe('POST /places/resolve: 좌표·주소는 검색 없이', () => {
  const neverSearch: PlaceSearch = {
    searchKeyword: async () => {
      throw new Error('키워드 검색을 부르면 안 된다');
    },
    geocodeAddress: async () => ({ place: null, source: 'mock' }),
  };

  it('정확한 주소면 주소 → 좌표로 정하고 키워드 검색은 부르지 않는다', async () => {
    const calls: string[] = [];
    const app = custom({
      placeSearch: {
        searchKeyword: neverSearch.searchKeyword,
        geocodeAddress: async (a) => {
          calls.push(a);
          return { place: { name: '샘플 아파트', address: '광주 서구 상무중앙로 1', lat: 35.1595, lng: 126.8526 }, source: 'kakao' };
        },
      },
    });
    const { body } = await resolve(app, { name: '광주 서구 상무중앙로 1', ...HERE });
    expect(calls).toEqual(['광주 서구 상무중앙로 1']);
    expect(body).toMatchObject({ via: 'address', total: 1, source: 'kakao', memory: null });
    expect(body.candidates[0]).toMatchObject({ name: '샘플 아파트', lat: 35.1595, lng: 126.8526, distanceMeters: null });
  });

  it('목 검색: 목 장소의 주소와 통째로 같은 주소면 그 장소다', async () => {
    const { body } = await resolve(custom(), { name: '광주 서구 상무중앙로 1' });
    expect(body).toMatchObject({ via: 'address', total: 1, source: 'mock' });
    expect(body.candidates[0]?.name).toBe('샘플 아파트');
  });

  it('주소처럼 보여도 하나로 정해지지 않으면 키워드 검색으로 넘어간다', async () => {
    const { body } = await resolve(custom(), { name: '광주 서구 약국로 9' }); // 주소 → 목 장소 '유일한 약국'
    expect(body.via).toBe('address');
    const miss = await resolve(custom(), { name: '광주 서구 없는로 77' });
    expect(miss.body).toMatchObject({ via: 'search', total: 0, candidates: [] });
  });

  it('주소가 기억보다 먼저다(8장 1번이 2번보다 앞)', async () => {
    const app = custom();
    await remember(app, '광주 서구 상무중앙로 1', { name: '다른 곳', lat: 1, lng: 2 }, false);
    const { body } = await resolve(app, { name: '광주 서구 상무중앙로 1' });
    expect(body.via).toBe('address');
    expect(body.memory).toBeNull();
  });

  it('글자가 좌표(위도, 경도)면 그대로 쓰고 검색하지 않는다', async () => {
    const app = custom({ placeSearch: neverSearch });
    const { body } = await resolve(app, { name: '35.1595, 126.8526' });
    expect(body).toMatchObject({ via: 'coordinates', total: 1, source: 'none', memory: null });
    expect(body.candidates[0]).toMatchObject({ lat: 35.1595, lng: 126.8526 });
  });
});

describe('POST /places/resolve: 기억이 있으면 1순위', () => {
  it('기억이 있으면 memory로 내고 검색하지 않는다(source none, 후보 없음)', async () => {
    let searches = 0;
    const app = custom({
      placeSearch: {
        searchKeyword: async () => {
          searches += 1;
          return { places: [], total: 0, source: 'mock' };
        },
        geocodeAddress: async () => ({ place: null, source: 'mock' }),
      },
    });
    expect((await remember(app, '스타벅스', { name: '스타벅스 가까운점', address: '광주 서구 상무로 1', lat: 35.15, lng: 126.85 }, false)).status).toBe(200);
    const { body } = await resolve(app, { name: '스타벅스', ...HERE });
    expect(searches).toBe(0);
    expect(body).toEqual({
      memory: { place: { name: '스타벅스 가까운점', address: '광주 서구 상무로 1', lat: 35.15, lng: 126.85 }, ambiguous: false },
      candidates: [],
      total: 0,
      source: 'none',
      via: 'memory',
    });
  });

  it('애매하게 기억한 이름은 ambiguous: true로 와서 차가 매번 확인할 수 있다', async () => {
    const app = custom();
    await remember(app, '스타벅스', { name: '스타벅스 중간점', lat: 35.17, lng: 126.89 }, true);
    const { body } = await resolve(app, { name: '스타벅스' });
    expect(body.memory).toMatchObject({ ambiguous: true, place: { name: '스타벅스 중간점', address: null } });
  });

  it('이름은 공백·대소문자를 무시하고 같다고 본다(일정 장소 이름 정규화와 같은 규칙)', async () => {
    const app = custom();
    await remember(app, ' Gym   One ', { name: '체육관', lat: 35.15, lng: 126.84 }, false);
    expect((await resolve(app, { name: 'gym one' })).body.via).toBe('memory');
    expect((await resolve(app, { name: 'GYM  ONE' })).body.via).toBe('memory');
    expect((await resolve(app, { name: 'gym' })).body.via).toBe('search');
  });
});

describe('POST /places/resolve: 검색을 못 했을 때·카카오·키', () => {
  const kakaoApp = (fetchImpl: typeof fetch, extra: Parameters<typeof newApp>[0] = {}) =>
    newApp({ placeSearch: createKakaoPlaceSearch({ apiKey: KEY, fetch: fetchImpl }), ...extra });
  const doc = (id: string, name: string, x: string, y: string, distance: string) => ({
    id, place_name: name, address_name: '지번', road_address_name: `도로 ${id}`, x, y, distance,
  });

  it('카카오 결과를 가까운 순 2개 + total로 내고 source는 kakao다', async () => {
    const docs = [doc('1', 'A점', '126.85', '35.15', '120'), doc('2', 'B점', '126.9', '35.2', '3000'), doc('3', 'C점', '127.0', '35.3', '20000')];
    const seen: string[] = [];
    const app = kakaoApp((async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ meta: { total_count: 3 }, documents: docs }));
    }) as unknown as typeof fetch);
    const { body } = await resolve(app, { name: 'ABC', ...HERE });
    expect(body).toMatchObject({ source: 'kakao', total: 3, via: 'search' });
    expect(body.candidates.map((c) => [c.id, c.distanceMeters])).toEqual([['kakao:1', 120], ['kakao:2', 3000]]);
    const url = new URL(seen[0] as string);
    expect(url.searchParams.get('x')).toBe('126.8505'); // x = 경도
    expect(url.searchParams.get('y')).toBe('35.1505'); // y = 위도
    expect(url.searchParams.get('sort')).toBe('distance');
  });

  it('시간 초과·오류면 후보 없음 + source unavailable(0개와 구분), 응답·로그에 키가 없다', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const app = kakaoApp((async () => new Response(JSON.stringify({ message: KEY }), { status: 401 })) as unknown as typeof fetch);
    const res = await post(app, '/places/resolve', { name: '약국', ...HERE });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ memory: null, candidates: [], total: 0, source: 'unavailable', via: 'search' });
    expect(text).not.toContain(KEY);
    expect(JSON.stringify([...res.headers])).not.toContain(KEY);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
    const search = await app.request('/places/search?q=%EC%95%BD%EA%B5%AD');
    expect(await search.json()).toEqual({ places: [], source: 'unavailable' });
  });

  it('기억이 있으면 카카오를 부르지 않는다', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    const app = kakaoApp(fetchMock as unknown as typeof fetch);
    await remember(app, '약국', { name: '내 약국', lat: 35, lng: 126 }, false);
    expect((await resolve(app, { name: '약국' })).body.via).toBe('memory');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /places/resolve: 입력 검증·속도 제한', () => {
  it.each([
    ['본문이 배열', []],
    ['name 없음', {}],
    ['name이 공백뿐', { name: '   ' }],
    ['name이 숫자', { name: 3 }],
    ['name이 너무 길다', { name: '가'.repeat(301) }],
    ['lat만', { name: 'x', lat: 35 }],
    ['lng만', { name: 'x', lng: 126 }],
    ['lat 범위 밖', { name: 'x', lat: 91, lng: 126 }],
    ['lng 범위 밖', { name: 'x', lat: 35, lng: 181 }],
    ['lat이 문자열', { name: 'x', lat: '35', lng: 126 }],
    ['모르는 필드', { name: 'x', extra: 1 }],
  ])('400: %s', async (_n, body) => {
    const res = await post(custom(), '/places/resolve', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('깨진 JSON도 400이고, 본문이 너무 크면 413이다', async () => {
    expect((await post(custom(), '/places/resolve', '{')).status).toBe(400);
    expect((await post(custom(), '/places/resolve', JSON.stringify({ name: 'x'.repeat(70_000) }))).status).toBe(413);
  });

  it('요청 주소별로 검색 횟수를 제한한다: 넘으면 429 rate-limited, 다른 주소는 영향 없음, 창이 지나면 풀림', async () => {
    let clock = Date.parse('2026-11-15T09:00:00+09:00');
    const app = custom({
      now: () => new Date(clock),
      clientAddress: (c) => c.req.header('x-test-ip') ?? 'a',
      placeSearchRateLimit: { max: 2, windowMs: 60_000 },
    });
    const call = (ip: string, path = '/places/resolve') => post(app, path, { name: '약국' }, { 'x-test-ip': ip });
    expect([(await call('a')).status, (await call('a')).status]).toEqual([200, 200]);
    const limited = await call('a');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ reason: 'rate-limited' });
    expect((await app.request('/places/search?q=a', { headers: { 'x-test-ip': 'a' } })).status).toBe(429); // 같은 한도를 나눠 쓴다
    expect((await call('b')).status).toBe(200);
    clock += 60_001;
    expect((await call('a')).status).toBe(200);
  });

  it('기억·좌표로 답하는 요청은 외부 검색을 부르지 않으므로 한도를 쓰지 않는다', async () => {
    const app = custom({ clientAddress: () => 'a', placeSearchRateLimit: { max: 1, windowMs: 60_000 } });
    await remember(app, '약국', { name: '내 약국', lat: 35, lng: 126 }, false);
    for (let i = 0; i < 5; i++) expect((await resolve(app, { name: '약국' })).body.via).toBe('memory');
    for (let i = 0; i < 5; i++) expect((await resolve(app, { name: '35.1, 126.8' })).body.via).toBe('coordinates');
  });
});

describe('GET /places/search: 기존 계약 호환', () => {
  it('목 출처의 응답은 { places }뿐이고 항목은 id·이름·주소·좌표다(source 필드 없음)', async () => {
    const res = await newApp().request('/places/search?q=%EC%BD%A9%EB%AC%BC');
    expect(await res.json()).toEqual({ places: [{ id: 'mock-kongmul', name: '단골 콩물집', address: '광주 동구 예시로 5', lat: 35.146, lng: 126.922 }] });
  });

  it('lat·lng를 함께 주면 가까운 순으로 정렬한다', async () => {
    const app = custom();
    const names = async (qs: string) => ((await (await app.request(`/places/search?q=${encodeURIComponent('스타벅스')}${qs}`)).json()) as { places: { id: string }[] }).places.map((p) => p.id);
    expect(await names('')).toEqual(['s-far', 's-mid', 's-near']);
    expect(await names('&lat=35.1505&lng=126.8505')).toEqual(['s-near', 's-mid', 's-far']);
  });

  it.each(['&lat=35', '&lng=126', '&lat=abc&lng=126', '&lat=91&lng=126', '&lat=35&lng=181', '&lat=35&lat=36&lng=126'])('잘못된 기준 좌표 %s는 400', async (qs) => {
    expect((await newApp().request(`/places/search?q=a${qs}`)).status).toBe(400);
  });

  it('카카오 출처면 source: "kakao"를 덧붙이고 id는 kakao:로 시작한다', async () => {
    const body = { meta: { total_count: 1 }, documents: [{ id: '7', place_name: '약국', address_name: '지번', road_address_name: '', x: '126.85', y: '35.15' }] };
    const app = newApp({ placeSearch: createKakaoPlaceSearch({ apiKey: KEY, fetch: (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch }) });
    const res = await app.request('/places/search?q=%EC%95%BD%EA%B5%AD');
    expect(await res.json()).toEqual({ places: [{ id: 'kakao:7', name: '약국', address: '지번', lat: 35.15, lng: 126.85 }], source: 'kakao' });
  });

  it('기본 픽스처 목은 기존대로 최대 10개다', async () => {
    const { places } = (await (await newApp().request('/places/search?q=%EA%B4%91%EC%A3%BC')).json()) as { places: unknown[] };
    expect(places).toHaveLength(10);
    expect(catalog.places.length).toBeGreaterThan(10);
  });
});
