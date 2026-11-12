const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/;

/**
 * 오프셋이 있는 ISO8601 시각 문자열만 받는다. 형식이 틀리거나 달력에 없는 값(2026-02-30, T24:00, 초 60)이면 null.
 * Date는 범위를 넘는 값을 다음 날로 넘겨 받아들이므로 날짜 부분은 되돌려 읽어 같은지 확인한다.
 * 0~99년은 Date.UTC가 1900년대로 읽으므로 setUTCFullYear로 연도를 그대로 넣는다.
 */
export function parseAt(value: string): Date | null {
  const m = ISO_8601.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return null;
  if (!isRealDate(year, month, day)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 달력에 있는 날짜인지(2026-02-30 같은 값은 false). */
function isRealDate(year: number, month: number, day: number): boolean {
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
const SEOUL_OFFSET_MS = 9 * 60 * MINUTE_MS;

/** Asia/Seoul 기준 날짜 번호(1970-01-01 = 0). */
export const seoulDay = (ms: number) => Math.floor((ms + SEOUL_OFFSET_MS) / DAY_MS);

/** 날짜 번호의 서울 자정(UTC 밀리초). */
export const seoulDayStart = (day: number) => day * DAY_MS - SEOUL_OFFSET_MS;

/** 'YYYY-MM-DD' 형식의 실제 있는 날짜면 서울 날짜 번호, 아니면 null. */
export function parseSeoulDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [m[1], m[2], m[3]].map(Number);
  if (!isRealDate(year, month, day)) return null;
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return Math.round(utc.getTime() / DAY_MS);
}

/** 서울 날짜 번호를 'YYYY-MM-DD'로 쓴다. */
export const formatSeoulDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
