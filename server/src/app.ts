import { Hono, type Context } from 'hono';
import type { DayFixture, FamilyMember, MockCalendar, PlacesCatalog } from './fixture-types.js';
import { createCalendarsRoute, createSelectionStore, type SelectionStore } from './routes/calendars.js';
import { createEventsRoute, createEventsStore, type EventsStore } from './routes/events.js';
import { createFamilyRoute, createFamilyStore, type FamilyStore } from './routes/family.js';
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
  /** 폰이 보낸 일정 저장소. 없으면 인스턴스마다 새로 만든다. */
  events?: EventsStore;
  /** 현재 시각. 테스트에서 고정하려고 바꿀 수 있다. 저장소를 직접 넘길 때는 같은 시계로 만든다. */
  now?: () => Date;
  /** /events를 같은 기기(127.0.0.1)에서만 받는다. HOST=0.0.0.0으로 열 때 켠다(환경 변수 EVENTS_LOOPBACK_ONLY=1). */
  eventsLoopbackOnly?: boolean;
  /** 같은 기기 요청인지 판정하는 함수. 테스트에서만 바꾼다. */
  isLoopback?: (c: Context) => boolean;
  /** 미리 묶어 둔 가족(fixtures/family/members.json). 다른 목 데이터처럼 서버 시작 코드가 읽어 넘긴다. */
  familyMembers: FamilyMember[];
  /** 가족에게 보낸 요청 저장소. 없으면 인스턴스마다 새로 만든다. */
  familyStore?: FamilyStore;
};

export const createApp = ({
  fixture,
  calendars,
  places,
  store = createSelectionStore(),
  favorites = createFavoritesStore(),
  now = () => new Date(),
  events = createEventsStore(now),
  eventsLoopbackOnly = false,
  isLoopback,
  familyMembers,
  familyStore = createFamilyStore(now),
}: AppOptions) =>
  new Hono()
    .get('/health', (c) => c.json({ ok: true as const }))
    .route('/calendars', createCalendarsRoute(calendars, store))
    .route('/places', createPlacesRoute(places, favorites))
    .route('/events', createEventsRoute(events, { now, isLoopback, loopbackOnly: eventsLoopbackOnly }))
    .route('/family', createFamilyRoute(familyMembers, familyStore))
    .route('/schedules', createSchedulesRoute(fixture, calendars, store, places, events, favorites, { members: familyMembers, store: familyStore }, now));

export type AppType = ReturnType<typeof createApp>;
