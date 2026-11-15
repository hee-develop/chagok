import { HttpError } from '../../../api/request';
import { placesApi } from '../placesApi';

const mock = {
  favoritesGet: jest.fn(),
  homePut: jest.fn(),
  workPut: jest.fn(),
  othersPost: jest.fn(),
  othersDelete: jest.fn(),
  suggestionsGet: jest.fn(),
  searchGet: jest.fn(),
};
jest.mock('../../../api/client', () => ({
  api: {
    places: {
      favorites: {
        $get: (...a: unknown[]) => mock.favoritesGet(...a),
        home: { $put: (...a: unknown[]) => mock.homePut(...a) },
        work: { $put: (...a: unknown[]) => mock.workPut(...a) },
        others: { $post: (...a: unknown[]) => mock.othersPost(...a), ':id': { $delete: (...a: unknown[]) => mock.othersDelete(...a) } },
      },
      suggestions: { $get: (...a: unknown[]) => mock.suggestionsGet(...a) },
      search: { $get: (...a: unknown[]) => mock.searchGet(...a) },
    },
  },
}));

const { signal } = new AbortController();
const ok = (body: unknown) => ({ ok: true, json: async () => body });
const bad = (status: number) => ({ ok: false, status });

beforeEach(() => Object.values(mock).forEach((fn) => fn.mockReset()));

describe('placesApi', () => {
  it('fetchFavorites는 저장 상태를 돌려주고 signal을 넘긴다', async () => {
    const body = { home: null, work: null, others: [], revision: 0 };
    mock.favoritesGet.mockResolvedValue(ok(body));
    await expect(placesApi.fetchFavorites(signal)).resolves.toEqual(body);
    expect(mock.favoritesGet).toHaveBeenCalledWith({}, { init: { signal } });
  });

  it('fetchSuggestions는 추천 배열을 돌려준다', async () => {
    mock.suggestionsGet.mockResolvedValue(ok({ suggestions: [{ id: 'a' }] }));
    await expect(placesApi.fetchSuggestions(signal)).resolves.toEqual([{ id: 'a' }]);
    expect(mock.suggestionsGet).toHaveBeenCalledWith({}, { init: { signal } });
  });

  it.each([
    ['home', 'homePut'],
    ['work', 'workPut'],
    ['other', 'othersPost'],
  ] as const)('assignPlace(%s)는 그 자리의 엔드포인트에 placeId만 보내고 전체 상태를 돌려준다', async (target, key) => {
    const body = { home: null, work: null, others: [], revision: 9 };
    mock[key].mockResolvedValue(ok(body));
    await expect(placesApi.assignPlace(target, 'p1', signal)).resolves.toEqual(body);
    expect(mock[key]).toHaveBeenCalledWith({ json: { placeId: 'p1' } }, { init: { signal } });
    for (const other of ['homePut', 'workPut', 'othersPost'] as const) if (other !== key) expect(mock[other]).not.toHaveBeenCalled();
  });

  it('assignPlace는 외부 검색 결과의 스냅숏이면 placeId 대신 place를 보낸다', async () => {
    mock.homePut.mockResolvedValue(ok({ home: null, work: null, others: [], revision: 1 }));
    const place = { name: '약국', address: '주소', lat: 35.1, lng: 126.8, externalId: 'kakao:1' };
    await placesApi.assignPlace('home', place, signal);
    expect(mock.homePut).toHaveBeenCalledWith({ json: { place } }, { init: { signal } });
  });

  it('removeOther는 id를 경로 변수로 보내 DELETE하고 전체 상태를 돌려준다', async () => {
    const body = { home: null, work: null, others: [], revision: 4 };
    mock.othersDelete.mockResolvedValue(ok(body));
    await expect(placesApi.removeOther('ext:kakao:1', signal)).resolves.toEqual(body);
    expect(mock.othersDelete).toHaveBeenCalledWith({ param: { id: 'ext:kakao:1' } }, { init: { signal } });
  });

  it('removeOther는 이미 없으면(404) 상태 코드를 가진 HttpError를 던진다', async () => {
    mock.othersDelete.mockResolvedValue(bad(404));
    const error = await placesApi.removeOther('p', signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });

  it('searchPlaces는 q를 쿼리로 보내고 places와 출처를 돌려준다(목 출처 응답에는 source가 없다)', async () => {
    mock.searchGet.mockResolvedValue(ok({ places: [{ id: 'p' }] }));
    await expect(placesApi.searchPlaces('광주', signal)).resolves.toEqual({ places: [{ id: 'p' }], source: 'mock' });
    expect(mock.searchGet).toHaveBeenCalledWith({ query: { q: '광주' } }, { init: { signal } });
    mock.searchGet.mockResolvedValue(ok({ places: [{ id: 'kakao:1' }], source: 'kakao' }));
    await expect(placesApi.searchPlaces('광주', signal)).resolves.toEqual({ places: [{ id: 'kakao:1' }], source: 'kakao' });
    mock.searchGet.mockResolvedValue(ok({ places: [], source: 'unavailable' }));
    await expect(placesApi.searchPlaces('광주', signal)).resolves.toEqual({ places: [], source: 'unavailable' });
  });

  it.each([
    ['fetchFavorites', () => placesApi.fetchFavorites(signal), 'favoritesGet'],
    ['fetchSuggestions', () => placesApi.fetchSuggestions(signal), 'suggestionsGet'],
    ['assignPlace(home)', () => placesApi.assignPlace('home', 'p', signal), 'homePut'],
    ['assignPlace(work)', () => placesApi.assignPlace('work', 'p', signal), 'workPut'],
    ['assignPlace(other)', () => placesApi.assignPlace('other', 'p', signal), 'othersPost'],
    ['removeOther', () => placesApi.removeOther('p', signal), 'othersDelete'],
    ['searchPlaces', () => placesApi.searchPlaces('x', signal), 'searchGet'],
  ] as const)('%s는 응답이 ok가 아니면 던진다', async (_name, call, key) => {
    mock[key].mockResolvedValue(bad(500));
    await expect(call()).rejects.toThrow('500');
  });

  it('ok가 아닌 응답은 상태 코드를 가진 HttpError다', async () => {
    mock.homePut.mockResolvedValue(bad(400));
    const error = await placesApi.assignPlace('home', 'p', signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
  });
});
