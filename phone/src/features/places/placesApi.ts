import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import type { PlaceTarget } from './favorites';

export type Favorites = InferResponseType<typeof api.places.favorites.$get, 200>;
export type Place = Favorites['others'][number];
export type Suggestion = InferResponseType<typeof api.places.suggestions.$get, 200>['suggestions'][number];

/** 검색 결과의 출처. mock은 목 장소(저장은 목 id), kakao는 외부 결과(저장은 장소 스냅숏), unavailable은 지금 검색할 수 없음(키 없음·시간 초과·오류). */
export type PlaceSearchSource = 'mock' | 'kakao' | 'unavailable';
export type PlaceSearchResult = { places: Place[]; source: PlaceSearchSource };

/** 외부 검색 결과를 자주 가는 곳·일정 보정에 저장할 때 싣는 장소 스냅숏(서버가 값으로 저장한다). externalId는 검색 결과의 id다. */
export type PlaceSnapshot = { name: string; address?: string; lat: number; lng: number; externalId?: string };

export const snapshotOf = (place: Place): PlaceSnapshot => ({ name: place.name, address: place.address, lat: place.lat, lng: place.lng, externalId: place.id });

export type PlacesApi = {
  fetchFavorites: (signal: AbortSignal) => Promise<Favorites>;
  fetchSuggestions: (signal: AbortSignal) => Promise<Suggestion[]>;
  searchPlaces: (query: string, signal: AbortSignal) => Promise<PlaceSearchResult>;
  /** 장소를 대상 자리에 넣는다(목 장소 id 또는 외부 결과의 스냅숏). 서버가 그 자리만 바꾸고 전체 상태를 돌려준다. */
  assignPlace: (target: PlaceTarget, pick: string | PlaceSnapshot, signal: AbortSignal) => Promise<Favorites>;
  /** 단골(others) 하나를 지운다(정책서 10.8 '자주 가는 곳: 추가·삭제'). 서버가 그 자리만 바꾸고 전체 상태를 돌려준다. 이미 없으면(404) HttpError 404를 던진다. */
  removeOther: (id: string, signal: AbortSignal) => Promise<Favorites>;
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
    const body = await res.json();
    // 목 출처의 응답에는 source 필드가 없다(기존 응답 그대로).
    return { places: body.places, source: 'source' in body ? (body.source as PlaceSearchSource) : 'mock' };
  },
  assignPlace: async (target, pick, signal) => {
    const init = { init: { signal } };
    const json = typeof pick === 'string' ? { placeId: pick } : { place: pick };
    if (target === 'home') {
      const res = await api.places.favorites.home.$put({ json }, init);
      if (!res.ok) fail(res, 'PUT /places/favorites/home');
      return res.json();
    }
    if (target === 'work') {
      const res = await api.places.favorites.work.$put({ json }, init);
      if (!res.ok) fail(res, 'PUT /places/favorites/work');
      return res.json();
    }
    const res = await api.places.favorites.others.$post({ json }, init);
    if (!res.ok) fail(res, 'POST /places/favorites/others');
    return res.json();
  },
  removeOther: async (id, signal) => {
    const res = await api.places.favorites.others[':id'].$delete({ param: { id } }, { init: { signal } });
    if (!res.ok) fail(res, 'DELETE /places/favorites/others/:id');
    return res.json();
  },
};
