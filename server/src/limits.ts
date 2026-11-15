/** 요청 본문 상한(바이트). */
export const MAX_BODY_BYTES = 64 * 1024;
/** 장소·캘린더 id 길이 상한. */
export const MAX_ID_LENGTH = 100;

/** PUT /events 한 번에 받는 일정 개수 상한(오늘·내일 일정이면 충분하다). */
export const MAX_EVENTS = 200;
/**
 * PUT /events 본문 상한(바이트). 필드를 상한까지 채운 일정은 한 건이 수 KB~20KB(한글은 글자당 3바이트)라 200개가 모두 꽉 차면 넘는다.
 * 폰은 직렬화 크기를 이 안(여유 두고)으로 맞춰 일정을 덜어 보내고, 넘기면 서버가 413으로 거절한다.
 */
export const MAX_EVENTS_BODY_BYTES = 1024 * 1024;
/** 일정 제목·장소 칸·메모·참석자 이름 길이 상한(글자). */
export const MAX_TITLE_LENGTH = 200;
export const MAX_LOCATION_LENGTH = 300;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_ATTENDEES = 50;
export const MAX_ATTENDEE_NAME_LENGTH = 100;
/** 앱에서 적는 채비 한 줄의 길이 상한(글자). 차는 30자 이하면 그대로 읽고 길면 '채비가 있어요'만 말한다. */
export const MAX_CARE_LENGTH = 100;
/** 자리 하나가 기억하는 '이동 없음' 일정 이름 개수 상한. 차면 새 이름은 409 `full`(폰의 '이동 일정이에요' 예외 목록 상한과 같다). */
export const MAX_SKIPS = 500;
/** 연결 전 기기 버킷 하나가 기억하는 '이동 없음' 이름 상한. 버킷은 잠깐 쓰고 버려질 수 있는 데이터라 연결된 자리(`MAX_SKIPS`)보다 작게 둔다(버킷 수 500개 × 이름이 서버 메모리를 채우지 않게). 차면 409 `full`. */
export const MAX_BUCKET_SKIPS = 50;
/** PUT /skips 한 번에 더하고 빼는 이름 수(더하기+빼기 합계) 상한. */
export const MAX_SKIP_CHANGES = 50;
