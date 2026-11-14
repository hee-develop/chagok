import { Hono, type Context } from 'hono';
import type { DayFixture, FamilyMember, MockCalendar, PlacesCatalog } from './fixture-types.js';
import { createCalendarsRoute, type SelectionStore } from './routes/calendars.js';
import { createEmptyEnergySources } from './energy/fixtureSources.js';
import type { EnergySources } from './energy/types.js';
import { createEnergyRoute } from './routes/energy.js';
import { createEventsRoute, isLoopbackRequest, type EventsStore } from './routes/events.js';
import { createFamilyRoute, type FamilyStore } from './routes/family.js';
import { createFamilyGuard } from './family/guard.js';
import { createFamilyRequests, type FamilyRequests } from './family/service.js';
import { createFamilyGroupRoute } from './routes/familyGroup.js';
import { createDriveStateRoute, createRequestsRoute } from './routes/requests.js';
import { createCarRoute, createDriversRoute, createPairRoute, createPresenceRoute } from './routes/pair.js';
import { createNotificationsRoute } from './routes/notifications.js';
import { createPairingRoute } from './routes/pairing.js';
import { createSchedulesRoute } from './routes/schedules.js';
import { createPlaceResolveRoute } from './routes/placeResolve.js';
import { createPlacesRoute, type FavoritesStore } from './routes/places.js';
import { createNotifications, type Notifications } from './notify/notifier.js';
import { MEMORY_WRITE_MAX, MEMORY_WRITE_WINDOW_MS } from './placeSearch/limits.js';
import { createMockPlaceSearch, createRateLimiter, type PlaceSearch, type RateLimiterOptions } from './placeSearch/index.js';
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
  /**
   * 같은 기기 요청인지 판정하는 함수(기본은 node 서버의 연결 주소가 루프백인지). `/events`의 개발용 초기화와 옛 `/pairing/*`의
   * 코드 발급·초기화(자리가 있는 차)가 쓴다. 프록시 뒤에서는 모든 요청이 루프백으로 보이니 배포할 때 바꿔야 한다. 테스트에서도 바꾼다.
   */
  isLoopback?: (c: Context) => boolean;
  /** 미리 묶어 둔 가족(fixtures/family/members.json). 다른 목 데이터처럼 서버 시작 코드가 읽어 넘긴다. */
  familyMembers: FamilyMember[];
  /** 기본 자리의 가족 요청 저장소. 없으면 인스턴스마다 새로 만든다. */
  familyStore?: FamilyStore;
  /** 차·운전자 자리·연결 코드 저장소. 없으면 인스턴스마다 새로 만든다. */
  seats?: SeatStore;
  /**
   * 폰 알림(알림함과 `notify`). 없으면 인스턴스마다 새로 만든다. 서버 시작 코드(`index.ts`)는 정기 작업이 같은 `notifier`로 알림을 넣도록
   * 직접 만들어 넘긴다(FCM 같은 추가 `PushSender`를 붙일 때도 여기서). 자리가 지워지거나 폰이 바뀌면 그 자리의 알림을 버린다.
   */
  notifications?: Notifications;
  /**
   * 가족 묶기·가족 요청(`POST /family/invite` 등, `/requests`, `/drive-state`)의 저장소와 알림 연결. 없으면 인스턴스마다 만든다. 서버 시작 코드(`index.ts`)는
   * 날짜가 지난 요청을 지우는 정기 작업이 같은 저장소를 보도록 직접 만들어 넘긴다. 자리가 지워지거나 폰이 바뀌면 이 저장소가 따라간다.
   */
  familyRequests?: FamilyRequests;
  /** 코드 시도 횟수를 세는 요청 주소. 기본은 연결 주소이고, 프록시 뒤에서는 바꿔야 한다. 테스트에서도 바꾼다. */
  clientAddress?: (c: Context) => string;
  /**
   * 자리를 모르는 옛 차 앱 호환 읽기: 식별(토큰·기기 id·driver)이 없는 읽기는 서버에 자리 있는 차가 하나도 없으면 기본 자리(픽스처), **자리가 있는 차가
   * 정확히 하나일 때만** 그 차의 '지난번 고른 자리(없으면 가장 최근에 연결한 자리)', 그 밖에는 저장하지 않는 빈 범위(0건)다.
   * 차 토큰만 있고 driver가 없는 읽기는 그 차 안에서만 같은 규칙(자리 없는 차는 빈 범위). 기본값은 켬이고, 차 앱이 driver·차 토큰을 보내게 되면 끈다.
   */
  legacyDriverFallback?: boolean;
  /**
   * 일정을 받은 적 없는 실제 자리(연결된 자리·연결 전 버킷·빈 범위)도 픽스처(목 일정)로 떨어뜨린다. 기본은 꺼짐(실제 자리는 0건).
   * **실제 사용자에게 목 일정이 보이는 데모 전용 옵션**이다. 차량 Maestro(`e2e-car.sh`)·PT 시연(`pt-demo.sh`) 서버(`FIXTURE_SEATS=1`)에서만 켠다.
   */
  fixtureSeats?: boolean;
  /** 장소 검색 포트(키워드·주소). 없으면 `places`의 목 장소로 검색한다. 서버 시작 코드가 `KAKAO_REST_KEY`가 있을 때 카카오 구현을 넘긴다. */
  placeSearch?: PlaceSearch;
  /** 장소 검색(`GET /places/search`·`POST /places/resolve`)의 요청 주소별 속도 제한. 기본값은 placeSearch/limits.ts. 테스트에서 바꾼다. */
  placeSearchRateLimit?: Omit<RateLimiterOptions, 'now'>;
  /** `PUT /places/memory`의 요청 주소별 속도 제한. 기본값은 placeSearch/limits.ts(분당 30회). 테스트에서 바꾼다. */
  placeMemoryRateLimit?: Omit<RateLimiterOptions, 'now'>;
  /** 연결 전 버킷 수·TTL·생성 속도 제한과 일정 저장 용량 예산(연결된 자리/버킷 따로, 버킷 하나의 상한). 기본값은 seatData.ts. 테스트에서 바꾼다. */
  capacity?: Omit<NonNullable<Parameters<typeof createSeatDataRegistry>[0]>, 'now' | 'fixtureIds' | 'defaults'>;
  /**
   * 에너지 후보 어댑터(충전소·주유소·휴게소). 없으면 후보가 늘 없는 목이다(`source: "fixture"`, `stage: "none"`). 파일을 읽지 않아야 이 파일이
   * node 타입 없이 타입체크되므로, `fixtures/energy/` 목과 환경 변수로 고르는 실제 API는 서버 시작 코드(`index.ts`)와 테스트가 넘긴다.
   */
  energy?: EnergySources;
  /** 에너지 후보 외부 조회 실패를 알린다. 없으면 한 줄 경고. 테스트에서 바꾼다. */
  onEnergyError?: (error: unknown) => void;
  /** 에너지 후보 전체 제한 시간(ms). 테스트에서만 바꾼다. */
  energyTimeoutMs?: number;
  /** `POST /energy/options`의 요청 주소별 속도 제한. 기본 분당 20회. 요청 주소는 `clientAddress`(코드 시도 제한과 같은 판정)다. 테스트에서 바꾼다. */
  energyRateLimit?: { limit?: number; windowMs?: number };
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
  isLoopback = isLoopbackRequest,
  familyMembers,
  familyStore,
  seats = createSeatStore(now),
  notifications = createNotifications({ now }),
  familyRequests = createFamilyRequests({ now, seats, notifier: notifications.notifier }),
  clientAddress = connectionAddress,
  legacyDriverFallback = true,
  fixtureSeats = false,
  capacity,
  energy = createEmptyEnergySources(),
  onEnergyError,
  energyTimeoutMs,
  energyRateLimit,
  placeSearch = createMockPlaceSearch(places.places),
  placeSearchRateLimit,
  placeMemoryRateLimit,
}: AppOptions) => {
  // 일정·선택·자주 가는 곳·가족 요청·보정·채비는 운전자 자리마다 따로 쌓인다. 토큰 없이 기기 id만 있는 폰은 그 기기의 연결 전 버킷을,
  // 식별이 전혀 없는 요청은 기본 자리를 쓴다(픽스처·데모·차량 E2E 경로).
  const registry = createSeatDataRegistry({
    now,
    fixtureIds: new Set(fixture.schedules.map((s) => s.id)),
    defaults: { events, selection: store, favorites, family: familyStore },
    ...capacity,
  });
  seats.subscribe((event) => registry.apply(event));
  // 자리가 지워지거나(끊기·차 초기화·정리) 폰이 바뀌면 옛 폰이 읽지 않은 알림은 새 폰에 넘기지 않고 버린다.
  seats.subscribe((event) => {
    if (event.type !== 'created') notifications.notifier.forget(event.seatId);
  });
  // 자리가 일정을 받으면 마지막 수신 시각을 갱신하고 '일정을 못 받고 있어요'는 해결됐으니 아직 안 읽어 간 그 알림을 지운다
  // (나중에 낡은 경고로 전해지지 않게. 그날의 중복 억제 키는 남아 같은 날 다시 만들지 않는다).
  const onEventsReceived = (seatId: string) => {
    seats.markEvents(seatId);
    notifications.outbox.dropKind(seatId, 'events-stale');
  };
  const guard = createSeatGuard(seats, registry, { legacyDriverFallback, fixtureSeats, clientAddress });
  const searchLimiter = createRateLimiter({ ...placeSearchRateLimit, now: () => now().getTime() });
  const memoryLimiter = createRateLimiter({ max: MEMORY_WRITE_MAX, windowMs: MEMORY_WRITE_WINDOW_MS, ...placeMemoryRateLimit, now: () => now().getTime() });
  const searchDeps = {
    search: placeSearch,
    allow: (c: Context) => searchLimiter.take(clientAddress(c)),
    allowMemoryWrite: (c: Context) => memoryLimiter.take(clientAddress(c)),
  };
  // 가족 묶기·요청 API의 자리 정하기는 옛 차 앱 호환 읽기·기본 자리를 쓰지 않는 따로 둔 엄격한 가드다.
  const familyGuard = createFamilyGuard(seats);
  return new Hono()
    .get('/health', (c) => c.json({ ok: true as const }))
    .route('/calendars', createCalendarsRoute(calendars, guard))
    .route('/places', createPlacesRoute(places, guard, searchDeps))
    .route('/places', createPlaceResolveRoute(guard, searchDeps))
    .route('/events', createEventsRoute(guard, { now, isLoopback, loopbackOnly: eventsLoopbackOnly, onReceived: onEventsReceived }))
    .route('/family', createFamilyRoute(familyMembers, guard))
    .route('/family', createFamilyGroupRoute(familyGuard, familyRequests, { now, clientAddress }))
    .route('/requests', createRequestsRoute(familyGuard, familyRequests, now))
    .route('/drive-state', createDriveStateRoute(familyGuard, familyRequests))
    .route('/pairing', createPairingRoute(seats, { clientAddress, isLoopback }))
    .route('/pair', createPairRoute(seats, { now, clientAddress, isLoopback }))
    .route('/notifications', createNotificationsRoute(seats, notifications))
    .route('/drivers', createDriversRoute(seats))
    .route('/presence', createPresenceRoute(seats))
    .route('/car', createCarRoute(seats))
    .route('/energy', createEnergyRoute(energy, { now, onError: onEnergyError, totalTimeoutMs: energyTimeoutMs, rateLimit: energyRateLimit, clientKey: clientAddress }))
    .route('/schedules', createSchedulesRoute(fixture, calendars, places, guard, { members: familyMembers }, now));
};

export type AppType = ReturnType<typeof createApp>;
