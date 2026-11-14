import { Hono, type Context } from 'hono';
import type { DayFixture, FamilyMember, MockCalendar, PlacesCatalog } from './fixture-types.js';
import { createCalendarsRoute, type SelectionStore } from './routes/calendars.js';
import { createEmptyEnergySources } from './energy/fixtureSources.js';
import type { EnergySources } from './energy/types.js';
import { createEnergyRoute } from './routes/energy.js';
import { createEventsRoute, isLoopbackRequest, type EventsStore } from './routes/events.js';
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
  clientAddress = connectionAddress,
  legacyDriverFallback = true,
  fixtureSeats = false,
  capacity,
  energy = createEmptyEnergySources(),
  onEnergyError,
  energyTimeoutMs,
  energyRateLimit,
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
  const guard = createSeatGuard(seats, registry, { legacyDriverFallback, fixtureSeats, clientAddress });
  return new Hono()
    .get('/health', (c) => c.json({ ok: true as const }))
    .route('/calendars', createCalendarsRoute(calendars, guard))
    .route('/places', createPlacesRoute(places, guard))
    .route('/events', createEventsRoute(guard, { now, isLoopback, loopbackOnly: eventsLoopbackOnly, onReceived: (seatId) => seats.markEvents(seatId) }))
    .route('/family', createFamilyRoute(familyMembers, guard))
    .route('/pairing', createPairingRoute(seats, { clientAddress, isLoopback }))
    .route('/pair', createPairRoute(seats, { now, clientAddress, isLoopback }))
    .route('/drivers', createDriversRoute(seats))
    .route('/presence', createPresenceRoute(seats))
    .route('/car', createCarRoute(seats))
    .route('/energy', createEnergyRoute(energy, { now, onError: onEnergyError, totalTimeoutMs: energyTimeoutMs, rateLimit: energyRateLimit, clientKey: clientAddress }))
    .route('/schedules', createSchedulesRoute(fixture, calendars, places, guard, { members: familyMembers }, now));
};

export type AppType = ReturnType<typeof createApp>;
