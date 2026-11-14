/**
 * 에너지 후보 기준값. 정책서 12장의 값을 한 파일에 모았다(전부 가안이라 바꿀 때 여기만 고친다).
 * 필요 거리·'에너지 여유 90%' 판단은 차의 몫이라 서버는 쓰지 않는다.
 */

/** 정책서 12장 '오래 머무는 일정'(2시간 이상, 확정). 이 이상 머무는 일정이면 목적지 근처 완속 충전기를 먼저 찾는다. */
export const LONG_STAY_MINUTES = 120;

/** 정책서 12장 '충전기 찾는 반경'(500m, 가안). 오래 머무는 일정 장소에서 빈 완속 충전기를 찾는 반경. */
export const SLOW_CHARGER_RADIUS_METERS = 500;

/**
 * 정책서 12장 '주유소 우회'(3km 이하, 가안). 경로에서 벗어나는 거리.
 * 경로 모양을 모르므로 출발→목적지 선분까지의 수직 거리로 근사한다(docs/energy.md).
 */
export const FUEL_DETOUR_MAX_METERS = 3000;

/** 경로상 휴게소로 보는 거리(가안). 선분 근사라 고속도로 곡선을 감안해 주유소 우회와 같은 값으로 둔다. */
export const REST_STOP_CORRIDOR_METERS = 3000;

/** 휴게소 안의 급속 충전기로 보는 반경(가안). 휴게소 좌표와 충전소 좌표 오차를 감안한 값이다. */
export const REST_STOP_CHARGER_RADIUS_METERS = 300;

/** 응답 후보 상한(가안). 차의 '다른 데' 의도(다음 후보 하나)를 위해 여러 개를 주되 상한을 둔다. */
export const MAX_CANDIDATES = 5;

/**
 * 식사 시간대(서울 시각, 분 단위, [시작, 끝) 가안). 정책서는 '식사 시간대'라고만 하고 범위를 정하지 않았다.
 * 아침 07:00~09:00, 점심 11:00~14:00, 저녁 17:00~20:00.
 */
export const MEAL_WINDOWS_SEOUL_MINUTES: readonly (readonly [number, number])[] = [
  [7 * 60, 9 * 60],
  [11 * 60, 14 * 60],
  [17 * 60, 20 * 60],
];

/** 요청 값 상한. stayMinutes는 일주일(분)까지만 받는다. */
export const MAX_STAY_MINUTES = 7 * 24 * 60;

/** 오피넷 aroundAll.do의 radius 상한(m). 공식 문서: 최대 5000. */
export const OPINET_MAX_RADIUS_METERS = 5000;

/**
 * 경로를 따라 주유소를 찾을 때 검색 원의 중심 간격(m). 반경 5000 원이 폭 3000m 띠를 빈틈없이 덮으려면 간격이
 * 2*sqrt(5000^2-3000^2)=8000m 이하여야 한다. 오피넷 조회는 중심을 `OPINET_GRID_DEGREES`로 맞춰(최대 약 0.4km 이동)
 * 캐시를 공유하므로, 이동분을 빼고 2*sqrt(5000^2-3400^2)=7300m보다 작은 7000m로 둔다.
 */
export const FUEL_SAMPLE_SPACING_METERS = 7000;

/** 출발점에서 이 거리(m)까지만 경로를 훑는다(가안). 검색 원 개수(=외부 호출 수)를 16개 이하로 묶으려는 상한이다. */
export const FUEL_SCAN_MAX_METERS = 100_000;

/** 외부 API 호출 하나의 제한 시간(ms). 넘기면 실패로 보고 `source: "unavailable"`로 답한다. */
export const EXTERNAL_TIMEOUT_MS = 8000;

/** 휴게소 한 번 조회에서 충전기를 찾아 볼 휴게소 수 상한. */
export const MAX_REST_STOPS_LOOKUP = 20;

/** `POST /energy/options` 전체 제한 시간(ms). 외부 호출 여러 번(주유소 경로 탐색)이 겹쳐도 이 안에 답한다. */
export const TOTAL_TIMEOUT_MS = 12_000;

/**
 * 충전기 급속·완속 구분 기준(kW, 가안). 환경부 충전기 정보의 `output`(충전용량 kW)이 이 값 이상이면 급속으로 본다.
 * 공식 가이드의 output 예시 값이 3·7·50·100·200이라 7과 50 사이를 가르는 값이고, 가이드가 급속의 정의를 밝힌 것은 아니다(미확인).
 */
export const FAST_CHARGER_MIN_KW = 50;

/** 오피넷 조회 중심 좌표를 맞추는 격자(도). 0.005도는 위도 방향 약 0.55km라 한 칸 안에서 중심이 최대 약 0.4km 움직인다. */
export const OPINET_GRID_DEGREES = 0.005;
/** 오피넷 조회 결과를 메모리에 두는 시간(ms). 주유소 가격은 하루 단위로 바뀌어 짧게만 둔다. */
export const OPINET_CACHE_TTL_MS = 5 * 60_000;
/** 오피넷 캐시 항목 수 상한(가장 오래 안 쓴 것부터 버린다). */
export const OPINET_CACHE_MAX_ENTRIES = 500;
/** 서버 전체에서 동시에 나가는 오피넷 호출 상한과, 그 위로 기다리게 두는 호출 상한(넘으면 바로 실패). */
export const OPINET_MAX_CONCURRENT = 4;
export const OPINET_MAX_QUEUE = 32;
/** 오피넷 응답 한 번의 바이트 상한. 반경 5km 주유소 목록은 수십 KB다. */
export const OPINET_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 환경부 충전소 정보 한 쪽(9999건)의 응답 바이트 상한. 공식 예시 한 건이 약 1.1KB라 정상 응답은 약 11MB다. */
export const EV_MAX_PAGE_BYTES = 24 * 1024 * 1024;
/** 시도 데이터를 메모리에 두는 시간. 충전기 상태(stat)가 이 주기로 갱신된다. */
export const EV_CACHE_TTL_MS = 5 * 60_000;
/** 받기에 실패했을 때 오래된 데이터로 계속 답하는 한도. 이보다 오래된 시도 데이터는 버린다(상태가 너무 낡는다). */
export const EV_MAX_STALE_MS = 30 * 60_000;
/**
 * 받기에 실패한 시도를 다시 시도하기 전 대기. 연속으로 실패하면 두 배씩 늘려(30초, 60초, 120초…) 상한까지 간다. 성공하면 처음으로 돌아간다.
 * 키가 막혔거나 한도를 넘은 채로 30초마다 다시 부르는 것을 피한다.
 */
export const EV_FAILURE_BACKOFF_MS = 30_000;
export const EV_FAILURE_BACKOFF_MAX_MS = 10 * 60_000;
/** 시도 데이터를 한꺼번에 메모리에 두는 충전기 수 상한(가장 오래 안 쓴 시도부터 버린다). */
export const EV_MAX_CACHED_CHARGERS = 300_000;
/**
 * 시도 데이터를 한꺼번에 메모리에 두는 추정 바이트 상한. 충전기 객체 하나를 `EV_CHARGER_OBJECT_BYTES`로, 글자는 처음 둔 것만 글자당 2바이트로 센
 * 윗값이다(실측은 docs/energy.md). 충전기 수 상한과 둘 중 먼저 닿는 쪽으로 가장 오래 안 쓴 시도부터 버린다. 시도 하나가 혼자 이 값을 넘으면 그것만 둔다.
 */
export const EV_MAX_CACHED_BYTES = 128 * 1024 * 1024;
/**
 * 충전기 객체 하나(필드 11개)의 추정 바이트. 글자는 따로 센다. 필드 11개 객체는 실측 약 153바이트(위경도 숫자 상자 포함)이고
 * 배열 칸과 여유를 더해 200으로 둔다(공식 예시 모양 15만 대를 받아 재 보니 충전기당 약 270바이트, 글자 포함).
 */
export const EV_CHARGER_OBJECT_BYTES = 200;
/** 시도 하나를 받는 전체 제한 시간(ms), 서버 전체에서 동시에 받는 시도 수, 서버 전체에서 응답 원문을 동시에 들고 있는 쪽 수. */
export const EV_LOAD_TIMEOUT_MS = 120_000;
export const EV_MAX_CONCURRENT_LOADS = 3;
export const EV_MAX_CONCURRENT_PAGES = 2;
/**
 * 받을 시도를 고르는 여유 거리(m, 가안). 가장 가까운 앵커까지의 거리 + 이 값 안에 앵커가 있는 시도는 모두 받는다(최대 `EV_REGIONS_MAX_PER_QUERY`곳).
 * 앵커는 시도 중심 도시 몇 곳뿐이라 시도 가장자리(예: 충남 금산, 경북 경산)는 이웃 시도 앵커가 더 가깝다. 그 차이를 덮는 값이다.
 */
export const EV_REGION_MARGIN_METERS = 30_000;
export const EV_REGIONS_MAX_PER_QUERY = 3;

/** XML 한 문서의 글자 수 상한(읽기 도구 방어선). */
export const MAX_XML_CHARS = 32 * 1024 * 1024;

/**
 * `POST /energy/options`의 요청 주소별 속도 제한(분당, 가안). 차 한 대는 에너지 제안 직전에 한 번, 거절하면 한두 번 더 부르는 정도라
 * 정상 사용은 분당 한 자릿수다. 같은 공유기·프록시 뒤의 여러 대와 재시도를 감안해 20으로 둔다.
 */
export const ENERGY_RATE_LIMIT_PER_WINDOW = 20;
export const ENERGY_RATE_LIMIT_WINDOW_MS = 60_000;
/** 속도 제한이 동시에 기억하는 주소 수 상한. */
export const ENERGY_RATE_LIMIT_MAX_CLIENTS = 5000;
