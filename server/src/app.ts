import { Hono } from 'hono';
import type { DayFixture, MockCalendar, PlacesCatalog } from './fixture-types.js';
import { createCalendarsRoute, createSelectionStore, type SelectionStore } from './routes/calendars.js';
import { createSchedulesRoute } from './routes/schedules.js';
import { createFavoritesStore, createPlacesRoute, type FavoritesStore } from './routes/places.js';

// RPC 타입 추론을 위해 라우트는 반드시 체이닝으로 정의한다.
export type AppOptions = {
  fixture: DayFixture;
  calendars: MockCalendar[];
  places: PlacesCatalog;
  /** 캘린더 선택 저장소. 없으면 인스턴스마다 새로 만든다. */
  store?: SelectionStore;
  /** 자주 가는 곳 저장소. 없으면 인스턴스마다 새로 만든다. */
  favorites?: FavoritesStore;
};

export const createApp = ({
  fixture,
  calendars,
  places,
  store = createSelectionStore(),
  favorites = createFavoritesStore(),
}: AppOptions) =>
  new Hono()
    .get('/health', (c) => c.json({ ok: true as const }))
    .route('/calendars', createCalendarsRoute(calendars, store))
    .route('/places', createPlacesRoute(places, favorites))
    .route('/schedules', createSchedulesRoute(fixture, calendars, store, places));

export type AppType = ReturnType<typeof createApp>;
