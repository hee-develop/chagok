import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import type { PlaceTarget } from './favorites';

export type Favorites = InferResponseType<typeof api.places.favorites.$get, 200>;
export type Place = Favorites['others'][number];
export type Suggestion = InferResponseType<typeof api.places.suggestions.$get, 200>['suggestions'][number];

export type PlacesApi = {
  fetchFavorites: (signal: AbortSignal) => Promise<Favorites>;
  fetchSuggestions: (signal: AbortSignal) => Promise<Suggestion[]>;
  searchPlaces: (query: string, signal: AbortSignal) => Promise<Place[]>;
  /** 장소를 대상 자리에 넣는다. 서버가 그 자리만 바꾸고 전체 상태를 돌려준다. */
  assignPlace: (target: PlaceTarget, placeId: string, signal: AbortSignal) => Promise<Favorites>;
};

function fail(res: { status: number }, what: string): never {
  throw new HttpError(res.status, `${what} ${res.status}`);
}

export const placesApi: PlacesApi = {
  fetchFavorites: async (signal) => {
    const res = await api.places.favorites.$get({}, { init: { signal } });
    if (!res.ok) fail(res, 'GET /places/favorites');
    return res.json();
  },
  fetchSuggestions: async (signal) => {
    const res = await api.places.suggestions.$get({}, { init: { signal } });
    if (!res.ok) fail(res, 'GET /places/suggestions');
    return (await res.json()).suggestions;
  },
  searchPlaces: async (query, signal) => {
    const res = await api.places.search.$get({ query: { q: query } }, { init: { signal } });
    if (!res.ok) fail(res, 'GET /places/search');
    return (await res.json()).places;
  },
  assignPlace: async (target, placeId, signal) => {
    const init = { init: { signal } };
    if (target === 'home') {
      const res = await api.places.favorites.home.$put({ json: { placeId } }, init);
      if (!res.ok) fail(res, 'PUT /places/favorites/home');
      return res.json();
    }
    if (target === 'work') {
      const res = await api.places.favorites.work.$put({ json: { placeId } }, init);
      if (!res.ok) fail(res, 'PUT /places/favorites/work');
      return res.json();
    }
    const res = await api.places.favorites.others.$post({ json: { placeId } }, init);
    if (!res.ok) fail(res, 'POST /places/favorites/others');
    return res.json();
  },
};
