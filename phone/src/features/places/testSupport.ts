import { HttpError } from '../../api/request';
import type { Favorites, Place, PlacesApi, Suggestion } from './placesApi';

export const APT: Place = { id: 'mock-home-apt', name: '예시 아파트 101동', address: '광주 북구 샘플로 12', lat: 35.1743, lng: 126.9121 };
export const TOWER: Place = { id: 'mock-work-tower', name: '예시타워', address: '서울 강남구 테헤란로 100', lat: 37.5012, lng: 127.0396 };
export const GYM: Place = { id: 'mock-gym', name: '체육관', address: '광주 서구 운동로 7', lat: 35.1527, lng: 126.8483 };
export const FIELD: Place = { id: 'mock-champions-field', name: '광주-기아 챔피언스필드', address: '광주 북구 서림로 10', lat: 35.1681, lng: 126.8888 };

const KNOWN = [APT, TOWER, GYM, FIELD];

export const SUGGESTIONS: Suggestion[] = [
  { ...GYM, hint: '화요일 저녁마다' },
  { ...FIELD, hint: '직관 일정에 자주 나와요' },
];

export const EMPTY: Favorites = { home: null, work: null, others: [], revision: 0 };

export type FakeApi = { [K in keyof PlacesApi]: jest.Mock } & {
  /** 서버가 지금 들고 있는 자주 가는 곳. 화면이 모르는 사이에 바꿀 수 있다. */
  server: { get: () => Favorites; set: (next: Favorites) => void };
};

/**
 * 서버처럼 동작하는 PlacesApi. assignPlace는 서버와 같이 그 자리만 바꾸고(다른 자리에 있던 같은 장소는 옮기고),
 * 이미 추가한 장소를 other로 다시 넣으면 400을 던진다. overrides로 호출별 동작을 바꿀 수 있다.
 */
export function makeApi(overrides: Partial<PlacesApi> = {}, initial: Favorites = EMPTY): FakeApi {
  let state = initial;
  const assignPlace = async (target: 'home' | 'work' | 'other', placeId: string): Promise<Favorites> => {
    const place = KNOWN.find((p) => p.id === placeId) as Place;
    if (target === 'other' && state.others.some((p) => p.id === placeId)) throw new HttpError(400, 'POST /places/favorites/others 400');
    const rest = {
      home: state.home?.id === placeId ? null : state.home,
      work: state.work?.id === placeId ? null : state.work,
      others: state.others.filter((p) => p.id !== placeId),
    };
    const next = target === 'home' ? { ...rest, home: place } : target === 'work' ? { ...rest, work: place } : { ...rest, others: [...rest.others, place] };
    state = { ...next, revision: state.revision + 1 };
    return state;
  };
  return {
    fetchFavorites: jest.fn().mockImplementation(async () => state),
    fetchSuggestions: jest.fn().mockResolvedValue(SUGGESTIONS),
    searchPlaces: jest.fn().mockResolvedValue([]),
    assignPlace: jest.fn().mockImplementation(assignPlace),
    ...overrides,
    server: { get: () => state, set: (next) => (state = next) },
  } as FakeApi;
}
