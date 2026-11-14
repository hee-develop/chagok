/**
 * 가족 묶기·가족 요청의 기준값(정책서 10.10·11·12·13장). '가안'은 정책서 13장 '결정이 남은 것'이라 개발하며 바꿀 수 있고, 바꾸면 docs/family-requests.md를 고친다.
 */

/** 가족 초대 코드가 살아 있는 시간. 가안(정책서 13장 미결): 24시간. */
export const FAMILY_INVITE_TTL_MS = 24 * 60 * 60_000;
/** 한 가족의 인원 한도(만든 사람 포함). 가안(정책서 13장 미결): 6명. */
export const MAX_FAMILY_MEMBERS = 6;

/** 서버가 아는 가족 수 상한(메모리 보호). 넘으면 새 가족은 429 `too-many-families`. */
export const MAX_FAMILIES = 300;
/** 한 요청 주소가 FAMILY_CREATE_WINDOW_MS 안에 새로 만들 수 있는 가족 수(기기 id만 있는 폰도 가족을 만들 수 있어 주소별로 막는다). */
export const FAMILY_CREATE_WINDOW_MS = 10 * 60_000;
export const MAX_FAMILY_CREATES_PER_SOURCE = 10;
/**
 * 차에 연결하지 않은 폰(기기 id만으로 가족에 든 구성원)은 이만큼 쓰지 않으면 가족에서 내보낸다(그 사람이 보낸·받은 요청과 공유 설정도 지움).
 * 연결된 자리의 구성원은 자리와 함께 간다. 가안: 30일(정책서 11장 '30일 동안 일정이 안 온 자리 삭제'와 같은 길이).
 */
export const DEVICE_MEMBER_TTL_MS = 30 * 24 * 60 * 60_000;

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
 * 완료된 요청을 보낸 사람이 '도착했어요' 같은 상태를 볼 수 있게 남기는 시간. 정책서 11장은 '완료되거나 날짜가 지나면 삭제'라 완료 즉시가 원문이지만
 * 그러면 보낸 사람 폰이 완료 상태를 조회할 수 없어, 가안으로 1시간 뒤에 지운다(날짜가 지나면 그전에 지운다).
 */
export const COMPLETED_RETENTION_MS = 60 * 60_000;
