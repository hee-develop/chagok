// 서버의 일정 표시는 한국 시각으로 통일한다. 기기의 시간대가 달라도 같은 일정을 가리킨다.
const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const timeFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const dayFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });

/** 11월 6일 (금) 13:00 */
export const formatScheduleDate = (iso: string) => dateFormat.format(new Date(iso));
/** 13:00 */
export const formatScheduleTime = (iso: string) => timeFormat.format(new Date(iso));
/** 11월 6일 (금) */
export const formatScheduleDay = (iso: string) => dayFormat.format(new Date(iso));
