/**
 * 일정 이름을 비교하는 규칙(정책서 10.3 4번 '이동 없음 기억'의 "같은 이름"). NFC 정규화·보이지 않는 글자 제거·앞뒤 공백 제거·연속 공백 하나·대소문자 무시.
 * 서버의 이동 없음 기억(`routes/skips.ts`)과 폰의 '이동 일정이에요' 예외 이름(`travelExceptions.ts`)·폰의 이동 없음 기억 캐시가
 * 이 한 함수를 쓴다(폰은 워크스페이스 하위 경로 `@chagok/server/event-name`으로 소스 그대로 가져다 씀).
 * 이 파일은 다른 모듈을 가져오지 않는다(폰의 Metro가 소스 그대로 읽는다. `server/test/skips.test.ts`가 import 문이 없음을 검사한다).
 */

/**
 * 이름에서 지우는 보이지 않는 글자: 제로폭 공백(U+200B)·단어 결합 금지(U+2060)·소프트 하이픈(U+00AD)과, 줄바꿈·탭을 뺀 제어 문자.
 * (BOM U+FEFF·줄바꿈·탭·NBSP는 `\s`로 공백이 된다. 이모지를 잇는 ZWJ는 두어 이모지가 깨지지 않게 한다.)
 */
// 폰의 Hermes에서도 같게 돌도록 `\p{Cc}` 대신 범위로 적는다.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[​⁠­\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;

/** 보이는 이름: NFC로 맞추고 보이지 않는 글자를 지운 뒤 앞뒤 공백을 지우고 안쪽 연속 공백을 하나로 줄인다(대소문자는 그대로). */
export const displayEventName = (name: string): string => name.normalize('NFC').replace(INVISIBLE, '').trim().replace(/\s+/g, ' ');

/** 같은 이름인지 가르는 키: 보이는 이름을 소문자로 한 것. */
export const normalizeEventName = (name: string): string => displayEventName(name).toLowerCase();
