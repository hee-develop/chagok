import { beforeEach, describe, expect, it } from 'vitest';
import { parsePlacesCatalog } from '../src/fixtures.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../src/limits.js';
import { MAX_OTHER_PLACES, MAX_QUERY_LENGTH, MAX_SEARCH_RESULTS, normalizeQuery } from '../src/routes/places.js';
import { catalog, newApp } from './helpers.js';

let app: ReturnType<typeof newApp>;

beforeEach(() => {
  app = newApp();
});

type Place = { id: string; name: string; address: string; lat: number; lng: number };
type Favorites = { home: Place | null; work: Place | null; others: Place[]; revision: number };

const json = (method: string, path: string, body: unknown, target = app) =>
  target.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const search = (q: string) => app.request(`/places/search?q=${encodeURIComponent(q)}`);
const get = async (target = app) => (await (await target.request('/places/favorites')).json()) as Favorites;
const putHome = (placeId: unknown, target = app) => json('PUT', '/places/favorites/home', { placeId }, target);
const putWork = (placeId: unknown, target = app) => json('PUT', '/places/favorites/work', { placeId }, target);
const addOther = (placeId: unknown, target = app) => json('POST', '/places/favorites/others', { placeId }, target);
const ids = (f: Favorites) => ({ home: f.home?.id ?? null, work: f.work?.id ?? null, others: f.others.map((p) => p.id) });

const place = (id: string) => ({ id, name: id.toUpperCase(), address: 'x', lat: 1, lng: 2 });
const appWith = (places: Place[]) => newApp({ places: parsePlacesCatalog({ places }, { suggestions: [] }) });

describe('픽스처', () => {
  it('목 장소가 10~20개이고 일정 픽스처의 장소를 포함한다', () => {
    expect(catalog.places.length).toBeGreaterThanOrEqual(10);
    expect(catalog.places.length).toBeLessThanOrEqual(20);
    const names = catalog.places.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['광주 육전집', '광주-기아 챔피언스필드', '단골 콩물집']));
  });

  it('추천은 시안의 두 곳이다', () => {
    expect(catalog.suggestions.map((s) => [s.name, s.hint])).toEqual([
      ['체육관', '화요일 저녁마다'],
      ['광주-기아 챔피언스필드', '직관 일정에 자주 나와요'],
    ]);
  });

  it('주소에 가상 표시를 넣지 않고 fictional 필드로 구분하며, 응답에는 내보내지 않는다', async () => {
    expect(catalog.places.some((p) => p.address.includes('가상'))).toBe(false);
    expect(catalog.places.some((p) => p.fictional === true)).toBe(true);
    const { places } = (await (await search('광주')).json()) as { places: Record<string, unknown>[] };
    for (const p of places) expect(Object.keys(p).sort()).toEqual(['address', 'id', 'lat', 'lng', 'name']);
    const { suggestions } = (await (await app.request('/places/suggestions')).json()) as { suggestions: Record<string, unknown>[] };
    for (const s of suggestions) expect(Object.keys(s).sort()).toEqual(['address', 'hint', 'id', 'lat', 'lng', 'name']);
  });

  it('같은 id가 다른 장소를 가리키면 시작할 때 오류다', () => {
    const p = place('a');
    expect(() => parsePlacesCatalog({ places: [p] }, { suggestions: [{ ...p, name: 'B', hint: 'h' }] })).toThrow('같은 id');
  });

  it('id 중복·형식 오류는 시작할 때 오류다', () => {
    const p = place('a');
    expect(() => parsePlacesCatalog({ places: [p, p] }, { suggestions: [] })).toThrow('중복');
    expect(() => parsePlacesCatalog({ places: [{ ...p, lat: '1' }] }, { suggestions: [] })).toThrow('형식');
    expect(() => parsePlacesCatalog({ places: [{ ...p, fictional: 'yes' }] }, { suggestions: [] })).toThrow('형식');
    expect(() => parsePlacesCatalog({ places: [p] }, { suggestions: [{ ...p, id: 'b' }] })).toThrow('형식');
  });
});

describe('GET /places/search', () => {
  it('이름 부분 일치로 찾는다', async () => {
    const res = await search('육전');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { places: Place[] }).places.map((p) => p.name)).toEqual(['광주 육전집']);
  });

  it('주소 부분 일치로도 찾는다', async () => {
    const { places } = (await (await search('테헤란로')).json()) as { places: Place[] };
    expect(places.map((p) => p.name)).toEqual(['예시타워']);
  });

  it('장소 id·이름·주소·좌표를 돌려준다', async () => {
    const { places } = (await (await search('콩물')).json()) as { places: Place[] };
    expect(places).toEqual([{ id: 'mock-kongmul', name: '단골 콩물집', address: '광주 동구 예시로 5', lat: 35.146, lng: 126.922 }]);
  });

  it('앞뒤·중간 공백을 정리하고, 공백으로 나뉜 검색어는 모두 들어 있어야 한다', async () => {
    const { places } = (await (await search('  광주   챔피언스  ')).json()) as { places: Place[] };
    expect(places.map((p) => p.name)).toEqual(['광주-기아 챔피언스필드']);
    expect(normalizeQuery('  a \t b\n c ')).toBe('a b c');
  });

  it('영문 대소문자를 구분하지 않는다', async () => {
    const custom = newApp({ places: parsePlacesCatalog({ places: [{ id: 'k', name: 'Gym One', address: 'x', lat: 1, lng: 2 }] }, { suggestions: [] }) });
    const res = await custom.request('/places/search?q=gym%20ONE');
    expect(((await res.json()) as { places: Place[] }).places).toHaveLength(1);
  });

  it('일치하는 장소가 없으면 빈 배열이다', async () => {
    const res = await search('없는장소zzz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ places: [] });
  });

  it(`최대 ${MAX_SEARCH_RESULTS}개만 돌려준다`, async () => {
    const matching = catalog.places.filter((p) => `${p.name} ${p.address}`.includes('광주')).length;
    expect(matching).toBeGreaterThan(MAX_SEARCH_RESULTS);
    const { places } = (await (await search('광주')).json()) as { places: Place[] };
    expect(places).toHaveLength(MAX_SEARCH_RESULTS);
  });

  it.each([
    ['q 없음', '/places/search'],
    ['빈 q', '/places/search?q='],
    ['공백뿐인 q', '/places/search?q=%20%20'],
    ['q가 둘', '/places/search?q=a&q=b'],
    ['q가 상한 초과', `/places/search?q=${'가'.repeat(MAX_QUERY_LENGTH + 1)}`],
  ])('400: %s', async (_name, url) => {
    const res = await app.request(url);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('q가 상한 길이면 받는다', async () => {
    expect((await search('가'.repeat(MAX_QUERY_LENGTH))).status).toBe(200);
  });
});

describe('기억한 장소 픽스처', () => {
  const p = { id: 'a', name: 'A', address: 'x', lat: 1, lng: 2 };
  it('기본 픽스처는 치과를 목 장소에 잇는다', () => {
    expect(catalog.remembered).toEqual([{ title: '치과', placeId: 'mock-dentist' }]);
    expect(catalog.places.find((x) => x.id === 'mock-dentist')?.name).toBe('예시치과의원');
  });

  it('형식이 틀리거나 제목이 겹치거나 모르는 장소를 가리키면 거절한다', () => {
    const parse = (remembered: unknown) => parsePlacesCatalog({ places: [p] }, { suggestions: [] }, remembered);
    expect(parse({ remembered: [{ title: 'T', placeId: 'a' }] }).remembered).toHaveLength(1);
    expect(() => parse({})).toThrow('형식');
    expect(() => parse({ remembered: [{ title: '', placeId: 'a' }] })).toThrow('형식');
    expect(() => parse({ remembered: [{ title: 'T', placeId: 1 }] })).toThrow('형식');
    expect(() => parse({ remembered: [{ title: 'T', placeId: 'a' }, { title: 'T', placeId: 'a' }] })).toThrow('중복');
    expect(() => parse({ remembered: [{ title: 'T', placeId: 'zzz' }] })).toThrow('목 장소에 없습니다');
  });
});

describe('GET /places/suggestions', () => {
  it('추천 두 곳을 보조 문구·좌표와 함께 돌려준다', async () => {
    const res = await app.request('/places/suggestions');
    expect(res.status).toBe(200);
    const { suggestions } = (await res.json()) as { suggestions: (Place & { hint: string })[] };
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({ name: '체육관', hint: '화요일 저녁마다', lat: expect.any(Number), lng: expect.any(Number) });
    expect(suggestions[1]).toMatchObject({ name: '광주-기아 챔피언스필드', hint: '직관 일정에 자주 나와요' });
  });
});

describe('GET /places/favorites', () => {
  it('저장 전에는 비어 있고 revision은 0이다', async () => {
    const res = await app.request('/places/favorites');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ home: null, work: null, others: [], revision: 0 });
  });

  it('전체 교체 PUT은 없다', async () => {
    const res = await json('PUT', '/places/favorites', { home: 'mock-home-apt', others: [], revision: 1 });
    expect(res.status).toBe(404);
  });
});

describe('PUT /places/favorites/home·work', () => {
  it('placeId로 저장하고 전체 상태를 장소 정보로 풀어 돌려준다', async () => {
    const res = await putHome('mock-home-apt');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Favorites;
    expect(body.home).toEqual({ id: 'mock-home-apt', name: '예시 아파트 101동', address: '광주 북구 샘플로 12', lat: 35.1743, lng: 126.9121 });
    expect(body).toMatchObject({ work: null, others: [] });
    expect(await get()).toEqual(body);
    const work = (await (await putWork('mock-work-tower')).json()) as Favorites;
    expect(work.work?.id).toBe('mock-work-tower');
    expect(work.home?.id).toBe('mock-home-apt');
  });

  it('revision은 저장이 바뀔 때마다 서버가 1씩 올린다', async () => {
    const a = (await (await putHome('mock-home-apt')).json()) as Favorites;
    const b = (await (await putWork('mock-work-tower')).json()) as Favorites;
    const c = (await (await addOther('mock-gym')).json()) as Favorites;
    expect([a.revision, b.revision, c.revision]).toEqual([1, 2, 3]);
  });

  it('null이면 그 자리만 비우고 나머지는 그대로다', async () => {
    await putHome('mock-home-apt');
    await putWork('mock-work-tower');
    await addOther('mock-gym');
    expect(ids((await (await putHome(null)).json()) as Favorites)).toEqual({ home: null, work: 'mock-work-tower', others: ['mock-gym'] });
    expect(ids((await (await putWork(null)).json()) as Favorites)).toEqual({ home: null, work: null, others: ['mock-gym'] });
  });

  it('기존 집을 대체한다', async () => {
    await putHome('mock-home-apt');
    expect(ids((await (await putHome('mock-home-villa')).json()) as Favorites).home).toBe('mock-home-villa');
  });

  it('같은 장소가 다른 자리에 있으면 그 자리에서 빼고 옮긴다', async () => {
    await putHome('mock-home-apt');
    await putWork('mock-work-tower');
    await addOther('mock-gym');
    expect(ids((await (await putWork('mock-home-apt')).json()) as Favorites)).toEqual({ home: null, work: 'mock-home-apt', others: ['mock-gym'] });
    expect(ids((await (await putHome('mock-gym')).json()) as Favorites)).toEqual({ home: 'mock-gym', work: 'mock-home-apt', others: [] });
  });

  it('같은 장소를 같은 자리에 다시 넣어도 그대로다', async () => {
    await putHome('mock-home-apt');
    expect(ids((await (await putHome('mock-home-apt')).json()) as Favorites).home).toBe('mock-home-apt');
  });

  it.each([
    ['본문이 배열', []],
    ['placeId 없음', {}],
    ['placeId가 문자열이 아님', { placeId: 1 }],
    ['빈 문자열', { placeId: '' }],
    ['공백 문자열', { placeId: '  ' }],
    ['목 장소에 없는 id', { placeId: 'zzz' }],
    ['id가 상한 초과', { placeId: 'a'.repeat(MAX_ID_LENGTH + 1) }],
  ])('400: %s', async (_name, body) => {
    for (const path of ['/places/favorites/home', '/places/favorites/work']) {
      const res = await json('PUT', path, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
    }
    expect(await get()).toEqual({ home: null, work: null, others: [], revision: 0 });
  });

  it('JSON이 아니면 400이고 기존 저장값은 그대로다', async () => {
    await putHome('mock-home-apt');
    const res = await json('PUT', '/places/favorites/home', 'not json');
    expect(res.status).toBe(400);
    expect((await get()).home?.id).toBe('mock-home-apt');
  });

  it('본문이 64KB를 넘으면 413이고 저장하지 않는다', async () => {
    const res = await json('PUT', '/places/favorites/home', { placeId: 'mock-home-apt', pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect(res.status).toBe(413);
    expect(await res.json()).toHaveProperty('error');
    expect(await get()).toEqual({ home: null, work: null, others: [], revision: 0 });
  });

  it('추천에만 있는 id도 받는다', async () => {
    const custom = newApp({
      places: parsePlacesCatalog({ places: [place('a')] }, { suggestions: [{ ...place('s'), hint: 'h' }] }),
    });
    const res = await addOther('s', custom);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Favorites).others[0]).toEqual(place('s'));
  });
});

describe('POST /places/favorites/others', () => {
  it('끝에 붙이고 집·회사는 그대로 둔다', async () => {
    await putHome('mock-home-apt');
    await putWork('mock-work-tower');
    await addOther('mock-gym');
    const res = await addOther('mock-champions-field');
    expect(res.status).toBe(200);
    expect(ids((await res.json()) as Favorites)).toEqual({ home: 'mock-home-apt', work: 'mock-work-tower', others: ['mock-gym', 'mock-champions-field'] });
  });

  it('집·회사에 있던 장소를 추가하면 그 자리에서 빼고 옮긴다', async () => {
    await putHome('mock-gym');
    await putWork('mock-work-tower');
    expect(ids((await (await addOther('mock-gym')).json()) as Favorites)).toEqual({ home: null, work: 'mock-work-tower', others: ['mock-gym'] });
  });

  it('이미 추가한 장소는 400이고 저장은 그대로다', async () => {
    await addOther('mock-gym');
    const before = await get();
    const res = await addOther('mock-gym');
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
    expect(await get()).toEqual(before);
  });

  it.each([
    ['placeId 없음', {}],
    ['placeId가 null', { placeId: null }],
    ['목 장소에 없는 id', { placeId: 'zzz' }],
    ['문자열이 아님', { placeId: 1 }],
  ])('400: %s', async (_name, body) => {
    expect((await json('POST', '/places/favorites/others', body)).status).toBe(400);
    expect(await get()).toEqual({ home: null, work: null, others: [], revision: 0 });
  });

  it(`${MAX_OTHER_PLACES}개까지 받고 넘으면 400이다`, async () => {
    const places = Array.from({ length: MAX_OTHER_PLACES + 1 }, (_, i) => place(`p${i}`));
    const big = appWith(places);
    for (const p of places.slice(0, MAX_OTHER_PLACES)) expect((await addOther(p.id, big)).status).toBe(200);
    const res = await addOther(places[MAX_OTHER_PLACES].id, big);
    expect(res.status).toBe(400);
    expect((await get(big)).others).toHaveLength(MAX_OTHER_PLACES);
  });

  it('본문이 64KB를 넘으면 413이다', async () => {
    const res = await json('POST', '/places/favorites/others', { placeId: 'mock-gym', pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect(res.status).toBe(413);
  });
});

describe('저장 순서가 엇갈려도 다른 자리를 지우지 않는다', () => {
  it('집 저장 직후 장소를 추가해도 집이 남는다', async () => {
    await putHome('mock-home-apt');
    await addOther('mock-gym');
    expect(ids(await get())).toEqual({ home: 'mock-home-apt', work: null, others: ['mock-gym'] });
  });

  it('집·회사 저장과 추가 요청이 동시에 도착해도 모두 반영된다', async () => {
    const results = await Promise.all([putHome('mock-home-apt'), addOther('mock-gym'), putWork('mock-work-tower'), addOther('mock-champions-field')]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const saved = ids(await get());
    expect(saved.home).toBe('mock-home-apt');
    expect(saved.work).toBe('mock-work-tower');
    expect([...saved.others].sort()).toEqual(['mock-champions-field', 'mock-gym']);
  });

  it('응답이 늦게 도착해도 서버 상태는 연산을 누적한 값이다', async () => {
    const first = (await (await putHome('mock-home-apt')).json()) as Favorites;
    const second = (await (await addOther('mock-gym')).json()) as Favorites;
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(ids(second).home).toBe('mock-home-apt');
  });

  it('인스턴스마다 저장소가 따로다', async () => {
    await putHome('mock-home-apt');
    expect(await get(newApp())).toEqual({ home: null, work: null, others: [], revision: 0 });
  });
});
