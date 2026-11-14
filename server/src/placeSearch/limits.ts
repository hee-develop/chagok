/**
 * 장소 검색·장소 기억의 상수. (이 묶음의 상수는 모두 이 파일에 둔다.)
 * 값은 가안이다: 카카오 로컬 API의 쿼터(문서: https://developers.kakao.com/docs/ko/getting-started/quota)는 확인하지 못해 보수적으로 잡았다.
 */

/** 외부 장소 검색 한 번의 제한 시간. 넘으면 실패로 보고 빈 후보 + source "unavailable"로 답한다. */
export const SEARCH_TIMEOUT_MS = 3000;

/** 같은 검색어·비슷한 위치(좌표를 소수 3자리, 약 110m로 뭉침)의 결과를 이 시간 동안 다시 쓴다. 실패는 캐시하지 않는다. */
export const SEARCH_CACHE_TTL_MS = 60_000;
export const SEARCH_CACHE_MAX_ENTRIES = 200;
export const SEARCH_CACHE_COORD_DECIMALS = 3;

/** 요청 주소 하나가 RATE_LIMIT_WINDOW_MS 안에 장소 검색(키워드·주소)을 부를 수 있는 횟수. 넘으면 429 rate-limited. */
export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** 요청 주소별 기록은 이만큼까지만 둔다. 차면 가장 오래 쓰지 않은 주소의 기록을 버린다. */
export const RATE_LIMIT_MAX_ADDRESSES = 1000;

/** `POST /places/resolve`가 돌려주는 후보 수(가까운 순, 정책서 8장 3b). */
export const MAX_CANDIDATES = 2;
/** `GET /places/search`가 돌려주는 최대 개수(기존 계약). */
export const MAX_SEARCH_RESULTS = 10;

/** 연결된 자리 하나가 기억하는 '이름 → 장소' 수. 넘으면 가장 오래 전에 쓴 기억부터 버린다(가안). */
export const MAX_MEMORIES = 200;
/** 연결 전 버킷(기기 id만 있는 폰)이 기억하는 수. 토큰 없이 누구나 만들 수 있는 저장소라 낮게 둔다(가안). 연결해 자리가 되면 MAX_MEMORIES로 늘어난다. */
export const MAX_BUCKET_MEMORIES = 20;
/** 요청 주소 하나가 MEMORY_WRITE_WINDOW_MS 안에 `PUT /places/memory`로 저장할 수 있는 횟수(가안). 넘으면 429 rate-limited. */
export const MEMORY_WRITE_MAX = 30;
export const MEMORY_WRITE_WINDOW_MS = 60_000;
/** 외부 장소 검색으로 보내는 검색어의 최대 길이(글자). 일정 제목 같은 긴 글이 통째로 밖으로 나가지 않게 자른다. */
export const MAX_EXTERNAL_QUERY_LENGTH = 50;
/** 실패 로그를 같은 이유로는 이 시간에 한 번만 남긴다. */
export const FAILURE_LOG_INTERVAL_MS = 10 * 60_000;
/** 기억 이름(일정의 장소 칸 글자 또는 들은 이름)·기억한 장소 이름·주소 길이 상한(글자). */
export const MAX_MEMORY_NAME_LENGTH = 300;
export const MAX_MEMORY_PLACE_NAME_LENGTH = 200;
export const MAX_MEMORY_ADDRESS_LENGTH = 300;
