import type { SetupSchedule } from '../fill-places/schedulePlacesApi';

const SEOUL_OFFSET_MS = 9 * 60 * 60_000;
const seoulDay = (ms: number) => new Date(ms + SEOUL_OFFSET_MS).toISOString().slice(0, 10);

/** 장소도 이동 없음도 정해지지 않은 일정(후보가 있어도 센다). 서버의 빈 개수 규칙과 같다. */
export const isMissingPlace = (s: SetupSchedule) => !s.place && !s.noTravel;

/**
 * 서버가 말하는 '오늘'(anchor의 서울 날짜)에 걸친 일정인가: 시작이 그 날짜이거나, 전날 시작해 anchor 시각에 아직 끝나지 않은 일정.
 * 서버의 /schedules/today와 같은 규칙이라 차가 읽는 오늘과 폰이 보이는 오늘이 어긋나지 않는다.
 */
export function isTodaySchedule(s: SetupSchedule, anchorIso: string): boolean {
  const anchor = new Date(anchorIso).getTime();
  const start = new Date(s.start).getTime();
  const day = seoulDay(anchor);
  return seoulDay(start) === day || (seoulDay(start) < day && new Date(s.end).getTime() > anchor);
}

/**
 * 오늘 탭이 보이는 구성.
 * - today: 오늘 일정(이동 없음 포함, 시작순)
 * - otherMissing: 오늘이 아니면서 아직 끝나지 않았고 장소가 빈 일정(다가오는 일정)
 * - missingCount: 오늘 + 다른 날을 합친 장소 빈 일정 수
 */
export function splitSchedules(schedules: SetupSchedule[], anchorIso: string) {
  const anchor = new Date(anchorIso).getTime();
  const today = schedules.filter((s) => isTodaySchedule(s, anchorIso));
  const otherMissing = schedules.filter((s) => !isTodaySchedule(s, anchorIso) && isMissingPlace(s) && new Date(s.end).getTime() > anchor);
  return { today, otherMissing, missingCount: today.filter(isMissingPlace).length + otherMissing.length };
}
