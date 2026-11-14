const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const SEOUL_OFFSET_MS = 9 * HOUR_MS;

/** 서울 날짜 번호(1970-01-01 = 0). */
export const seoulDay = (ms: number) => Math.floor((ms + SEOUL_OFFSET_MS) / DAY_MS);

/** 날짜 번호의 서울 자정(UTC 밀리초). */
export const seoulDayStart = (day: number) => day * DAY_MS - SEOUL_OFFSET_MS;

/** 오늘 0시(서울) ~ 모레 0시(서울, 미포함). 기기 시간대와 상관없이 서울 날짜로 오늘·내일을 정한다. */
export function todayAndTomorrow(now: Date): { start: Date; end: Date } {
  const today = seoulDay(now.getTime());
  return { start: new Date(seoulDayStart(today)), end: new Date(seoulDayStart(today + 2)) };
}

/**
 * 종일 일정의 날짜(UTC 자정으로 저장된 값)를 같은 달력 날짜의 서울 자정으로 바꾼다.
 * 종일 일정은 시간대와 무관한 '날짜'라서 UTC 날짜 부분을 그대로 서울 날짜로 읽는다.
 */
export const allDayToSeoulMidnight = (utcMidnightMs: number) => seoulDayStart(Math.floor(utcMidnightMs / DAY_MS));
