import { HttpError } from '../../../api/request';
import { placesApi } from '../placesApi';

const mock = {
  favoritesGet: jest.fn(),
  homePut: jest.fn(),
  workPut: jest.fn(),
  othersPost: jest.fn(),
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
        others: { $post: (...a: unknown[]) => mock.othersPost(...a) },
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

  it('searchPlaces는 q를 쿼리로 보내고 places 배열을 돌려준다', async () => {
    mock.searchGet.mockResolvedValue(ok({ places: [{ id: 'p' }] }));
    await expect(placesApi.searchPlaces('광주', signal)).resolves.toEqual([{ id: 'p' }]);
    expect(mock.searchGet).toHaveBeenCalledWith({ query: { q: '광주' } }, { init: { signal } });
  });

  it.each([
    ['fetchFavorites', () => placesApi.fetchFavorites(signal), 'favoritesGet'],
    ['fetchSuggestions', () => placesApi.fetchSuggestions(signal), 'suggestionsGet'],
    ['assignPlace(home)', () => placesApi.assignPlace('home', 'p', signal), 'homePut'],
    ['assignPlace(work)', () => placesApi.assignPlace('work', 'p', signal), 'workPut'],
    ['assignPlace(other)', () => placesApi.assignPlace('other', 'p', signal), 'othersPost'],
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
