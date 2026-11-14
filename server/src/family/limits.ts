/**
 * 가족 묶기·가족 요청의 기준값(정책서 10.10·11·12·13장). '가안'은 정책서 13장 '결정이 남은 것'이라 개발하며 바꿀 수 있고, 바꾸면 docs/family-requests.md를 고친다.
 */

/** 가족 초대 코드가 살아 있는 시간. 가안(정책서 13장 미결): 24시간. */
export const FAMILY_INVITE_TTL_MS = 24 * 60 * 60_000;
/** 한 가족의 인원 한도(만든 사람 포함). 가안(정책서 13장 미결): 6명. */
export const MAX_FAMILY_MEMBERS = 6;

/**
 * 서버가 아는 가족 수 상한(메모리 보호). 닿으면 '혼자뿐이고 요청이 없는' 가족 중 가장 오래 쓰지 않은 것부터 밀어내고(그 구성원의 비밀값은 죽는다),
 * 밀어낼 가족이 없을 때만 새 가족은 429 `too-many-families`.
 */
export const MAX_FAMILIES = 300;
/**
 * 한 요청 주소가 새로 만들 수 있는 가족 수: 10분에 10개(`FAMILY_CREATE_WINDOW_MS`·`MAX_FAMILY_CREATES_PER_SOURCE`)이면서 하루(24시간)에
 * 20개(`FAMILY_CREATE_DAY_WINDOW_MS`·`MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY`). 가족은 식별 없이 만들 수 있어 주소별로 막는다(넘으면 429 `rate-limited`).
 * 만든 기록을 가진 주소는 `MAX_TRACKED_CREATE_SOURCES`개까지이고, 표가 가득 차면 새 주소는 막는다(fail-closed).
 */
export const FAMILY_CREATE_WINDOW_MS = 10 * 60_000;
export const MAX_FAMILY_CREATES_PER_SOURCE = 10;
export const FAMILY_CREATE_DAY_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY = 20;
export const MAX_TRACKED_CREATE_SOURCES = 1000;
/**
 * 구성원 1명뿐이고 요청이 하나도 없는 가족은 그 구성원이 마지막으로 쓴 지 이만큼 지나면 정리한다(만들기만 하고 버려진 가족이 서버 가족 수를 채우지 못하게).
 * 가안: 24시간(초대 코드 유효 시간과 같음).
 */
export const SOLO_FAMILY_TTL_MS = 24 * 60 * 60_000;
/**
 * 구성원은 이만큼 가족 API(폰의 가족 호출 또는 그 자리의 차 호출)를 쓰지 않으면 가족에서 내보낸다(그 사람이 보낸·받은 요청과 공유 설정도 지움).
 * 차 연결이 끊겨도 구성원은 비밀값으로 가족에 남으므로 오래 쓰지 않은 사람의 정리는 이 기한 하나다. 가안: 30일(정책서 11장 '30일 동안 일정이 안 온 자리 삭제'와 같은 길이).
 */
export const MEMBER_INACTIVE_TTL_MS = 30 * 24 * 60 * 60_000;

/** 부르는 이름(구성원 이름) 길이 상한(글자). 비면 기본 이름. */
export const MAX_MEMBER_NAME_LENGTH = 20;
export const DEFAULT_MEMBER_NAME = '가족';

/** 요청 메모(한 줄)·물건·장소 글자·사람 이름 길이 상한(글자). 차는 메모를 30자 이하면 읽고 길면 '메모가 있어요'만 말한다(차의 몫). */
export const MAX_REQUEST_MEMO_LENGTH = 100;
export const MAX_REQUEST_ITEM_LENGTH = 60;
export const MAX_REQUEST_PLACE_LENGTH = 100;
export const MAX_REQUEST_PERSON_LENGTH = 40;
export const MAX_COMPANIONS = 10;

/** 보낸 사람 한 명이 동시에 가질 수 있는 진행 중 요청 수, 가족 하나의 요청 수 상한(메모리 보호). 넘으면 429 `too-many-requests`. */
export const MAX_REQUESTS_PER_MEMBER = 30;
export const MAX_REQUESTS_PER_FAMILY = 100;
/**
 * 요청은 오늘·내일 날짜(서울)로만 만든다(일정과 같은 범위, 가안). 날짜가 지나면 지운다(정책서 11장).
 */
export const MAX_REQUEST_DAYS_AHEAD = 1;
/**
 * 약속 가기·데려다주기·픽업의 시각(`at`)이 이미 지난 시각이어도 받는 여유. 이보다 더 지난 시각은 400이다(방금 정한 시각·폰과 서버 시계 차이를 위한 여유).
 */
export const PAST_AT_LEEWAY_MS = 10 * 60_000;
/**
 * 도착 예정 알림(5분 전·도착)이 보낸 사람 알림함에 머무는 시간. 5분 전 알림의 `data.etaAt`(도착 예정 시각)이 알림함에 오래 남지 않게 일반 알림(3일)보다 짧게 한다.
 * 폰이 `ack`하면 그 즉시 지운다.
 */
export const ETA_NOTIFICATION_TTL_MS = 60 * 60_000;
