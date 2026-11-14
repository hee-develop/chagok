import { Hono, type Context } from 'hono';
import type { DayFixture, FamilyMember, MockCalendar, PlacesCatalog } from './fixture-types.js';
import { createCalendarsRoute, type SelectionStore } from './routes/calendars.js';
import { createEventsRoute, type EventsStore } from './routes/events.js';
import { createFamilyRoute, type FamilyStore } from './routes/family.js';
import { createCarRoute, createDriversRoute, createPairRoute, createPresenceRoute } from './routes/pair.js';
import { createPairingRoute } from './routes/pairing.js';
import { createSchedulesRoute } from './routes/schedules.js';
import { createPlacesRoute, type FavoritesStore } from './routes/places.js';
import { createSeatDataRegistry } from './seatData.js';
import { connectionAddress, createSeatGuard } from './seatScope.js';
import { createSeatStore, type SeatStore } from './seats.js';

// RPC 타입 추론을 위해 라우트는 반드시 체이닝으로 정의한다.
export type AppOptions = {
  fixture: DayFixture;
  calendars: MockCalendar[];
  places: PlacesCatalog;
  /** 기본 자리의 캘린더 선택 저장소. 없으면 인스턴스마다 새로 만든다. (다른 자리는 자리마다 새로 만든다.) */
  store?: SelectionStore;
  /** 기본 자리의 자주 가는 곳 저장소. 없으면 인스턴스마다 새로 만든다. */
  favorites?: FavoritesStore;
  /** 기본 자리의 폰 일정 저장소. 없으면 인스턴스마다 새로 만든다. */
  events?: EventsStore;
  /** 현재 시각. 테스트에서 고정하려고 바꿀 수 있다. 저장소를 직접 넘길 때는 같은 시계로 만든다. */
  now?: () => Date;
  /** /events를 같은 기기(127.0.0.1)에서만 받는다. HOST=0.0.0.0으로 열 때 켠다(환경 변수 EVENTS_LOOPBACK_ONLY=1). */
  eventsLoopbackOnly?: boolean;
  /** 같은 기기 요청인지 판정하는 함수. 테스트에서만 바꾼다. */
  isLoopback?: (c: Context) => boolean;
  /** 미리 묶어 둔 가족(fixtures/family/members.json). 다른 목 데이터처럼 서버 시작 코드가 읽어 넘긴다. */
  familyMembers: FamilyMember[];
  /** 기본 자리의 가족 요청 저장소. 없으면 인스턴스마다 새로 만든다. */
  familyStore?: FamilyStore;
  /** 차·운전자 자리·연결 코드 저장소. 없으면 인스턴스마다 새로 만든다. */
  seats?: SeatStore;
  /** 코드 시도 횟수를 세는 요청 주소. 기본은 연결 주소이고, 프록시 뒤에서는 바꿔야 한다. 테스트에서도 바꾼다. */
  clientAddress?: (c: Context) => string;
  /**
   * 자리 지정(폰 토큰·driver) 없이 읽는 요청(자리를 모르는 옛 차 앱)이 가장 최근에 연결한 자리를 본다. 연결된 자리가 없으면 기본 자리다.
   * 기본값은 켬이고, 차 앱이 driver를 보내게 되면 끈다.
   */
  legacyDriverFallback?: boolean;
};

export const createApp = ({
  fixture,
  calendars,
  places,
  store,
  favorites,
  now = () => new Date(),
  events,
  eventsLoopbackOnly = false,
  isLoopback,
  familyMembers,
  familyStore,
  seats = createSeatStore(now),
  clientAddress = connectionAddress,
  legacyDriverFallback = true,
}: AppOptions) => {
  // 일정·선택·자주 가는 곳·가족 요청·보정·채비는 운전자 자리마다 따로 쌓인다. 토큰 없는 요청은 기본 자리를 쓴다(픽스처·데모 경로).
  const registry = createSeatDataRegistry({
    now,
    fixtureIds: new Set(fixture.schedules.map((s) => s.id)),
    defaults: { events, selection: store, favorites, family: familyStore },
  });
  seats.subscribe((event) => registry.apply(event));
  const guard = createSeatGuard(seats, registry, { legacyDriverFallback });
  return new Hono()
    .get('/health', (c) => c.json({ ok: true as const }))
    .route('/calendars', createCalendarsRoute(calendars, guard))
    .route('/places', createPlacesRoute(places, guard))
    .route('/events', createEventsRoute(guard, { now, isLoopback, loopbackOnly: eventsLoopbackOnly, onReceived: (seatId) => seats.markEvents(seatId) }))
    .route('/family', createFamilyRoute(familyMembers, guard))
    .route('/pairing', createPairingRoute(seats, { clientAddress }))
    .route('/pair', createPairRoute(seats, { now, clientAddress }))
    .route('/drivers', createDriversRoute(seats))
    .route('/presence', createPresenceRoute(seats))
    .route('/car', createCarRoute(seats))
    .route('/schedules', createSchedulesRoute(fixture, calendars, places, guard, { members: familyMembers }, now));
};

export type AppType = ReturnType<typeof createApp>;
