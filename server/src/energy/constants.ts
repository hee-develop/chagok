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
 * 경로를 따라 주유소를 찾을 때 검색 원의 중심 간격(m). 반경 5000 원이 폭 3000m 띠를 빈틈없이 덮으려면
 * 간격이 2*sqrt(5000^2-3000^2)=8000m 이하여야 한다.
 */
export const FUEL_SAMPLE_SPACING_METERS = 8000;

/** 출발점에서 이 거리(m)까지만 경로를 훑는다(가안). 검색 원 개수(=외부 호출 수)를 14개 이하로 묶으려는 상한이다. */
export const FUEL_SCAN_MAX_METERS = 100_000;

/** 외부 API 호출 하나의 제한 시간(ms). 넘기면 실패로 보고 `source: "unavailable"`로 답한다. */
export const EXTERNAL_TIMEOUT_MS = 8000;

/** 휴게소 한 번 조회에서 충전기를 찾아 볼 휴게소 수 상한. */
export const MAX_REST_STOPS_LOOKUP = 20;

/** `POST /energy/options` 전체 제한 시간(ms). 외부 호출 여러 번(주유소 경로 탐색)이 겹쳐도 이 안에 답한다. */
export const TOTAL_TIMEOUT_MS = 12_000;
