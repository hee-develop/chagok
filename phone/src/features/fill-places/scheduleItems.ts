import type { FilteredEvent } from '../calendar-sync/filteredEvents';
import type { SetupSchedule } from './schedulePlacesApi';

/** 일정 목록의 한 줄: 서버가 아는 일정, 또는 폰이 읽을 때 거른(서버로 보내지 않은) 일정. */
export type ScheduleItem =
  | { kind: 'server'; id: string; start: number; schedule: SetupSchedule }
  | { kind: 'filtered'; id: string; start: number; event: FilteredEvent };

/**
 * 서버 일정과 폰이 거른 일정을 시작순으로 합친다. 서버 목록에 같은 id가 있으면 서버 쪽만 쓴다
 * (거른 일정을 이동 일정으로 바꾼 직후 서버가 같은 일정을 알게 되는 순간 줄이 두 번 나오지 않게).
 * 3단계 화면과 오늘 탭이 같이 쓴다.
 */
export function mergeScheduleItems(schedules: readonly SetupSchedule[], filtered: readonly FilteredEvent[]): ScheduleItem[] {
  const known = new Set(schedules.map((s) => s.id));
  return [
    ...schedules.map((schedule): ScheduleItem => ({ kind: 'server', id: schedule.id, start: Date.parse(schedule.start), schedule })),
    ...filtered.filter((e) => !known.has(e.id)).map((event): ScheduleItem => ({ kind: 'filtered', id: event.id, start: Date.parse(event.start), event })),
  ].sort((a, b) => a.start - b.start);
}
