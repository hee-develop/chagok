import { detectNoTravel, travelFilterReason } from '@chagok/server/no-travel';

import type { DeviceEvent } from '../calendar-select/calendarSource';
import type { FilteredEvent } from './filteredEvents';

/**
 * 폰이 일정을 읽은 뒤 서버로 보내기 전에 거른다(정책서 10.3 표 1~4번). 판정은 서버와 같은 함수 한 곳(`@chagok/server/no-travel`).
 * - 종일: 이름만 보낸다(메모·참석자는 비운다). 장소 칸은 "어디로 갈까요?" 후보에 쓰이므로 남기되,
 *   온라인·건물 안 표시('Zoom', '본사 3층 회의실')면 후보가 될 수 없으므로 비워 보낸다. 서버도 종일은 거르지 않는다(첫 탑승 인사에 이름을 쓴다).
 * - 온라인·건물 안: 보내지 않는다. 제목이 폰 밖으로 나가지 않는다. 폰 로컬 목록(`filtered`)에만 남겨 화면에 흐리게 보인다.
 * - 단 사용자가 같은 이름을 "이동 일정이에요"로 바꿨다면 거르지 않고 보내며, 서버의 안전망도 건너뛰도록 `travelConfirmed`를 단다.
 * - 4번 이동 없음 기억: 위 둘에 걸리지 않은 일정(종일 제외)의 제목이 '이동 없음'으로 기억한 이름이면 보내지 않고 폰 로컬 목록에만 둔다(이유 `skipped`).
 *   이름이 기억에도 예외에도 있는 어긋난 상태에서는 기억이 이긴다(서버 안전망도 기억이 이긴다. 폰은 동기화 때 그런 예외를 지운다).
 * - 단 사용자가 그 일정에 장소를 넣어 보정했다면(`isCorrected`) 이름이 기억에 있어도 거르지 않는다: 장소 보정이 이동 없음 기억을 이긴다(가장 최근 선택이 이김).
 *   거르면 서버가 그 일정과 보정을 함께 잃는다. 장소를 넣을 때 같은 이름의 기억도 지워지므로 이 예외는 그 지우기가 올라가기 전이나 기억을 나중에 더한 경우를 덮는다.
 * - 장소 칸이 비었거나 보통 장소면 그대로 보낸다.
 */
export function partitionEvents(
  events: readonly DeviceEvent[],
  isTravelException: (title: string) => boolean,
  isSkippedName: (title: string) => boolean = () => false,
  isCorrected: (id: string) => boolean = () => false,
): { toSend: DeviceEvent[]; filtered: FilteredEvent[] } {
  const toSend: DeviceEvent[] = [];
  const filtered: FilteredEvent[] = [];
  for (const event of events) {
    const reason = travelFilterReason(event);
    const skippedByName = () => isSkippedName(event.title) && !isCorrected(event.id);
    const skipped = (): FilteredEvent => ({ id: event.id, title: event.title, start: event.start, end: event.end, reason: 'skipped' });
    if (reason === null) {
      if (skippedByName()) filtered.push(skipped());
      else toSend.push(event);
    } else if (reason === 'allDay') {
      // 이동 일정으로 바꾼 이름이면 사용자가 장소를 찾아가는 곳으로 본 것이므로 장소 칸을 그대로 둔다.
      // 장소 칸만 본다(메모는 어차피 비워 보낸다).
      const hasNoTravelPlace = detectNoTravel({ title: event.title, locationText: event.locationText, notes: null }) !== null && !isTravelException(event.title);
      toSend.push({ ...event, notes: null, attendees: [], locationText: hasNoTravelPlace ? null : event.locationText });
    } else if (isTravelException(event.title)) {
      if (skippedByName()) filtered.push(skipped());
      else toSend.push({ ...event, travelConfirmed: true });
    } else {
      filtered.push({ id: event.id, title: event.title, start: event.start, end: event.end, reason });
    }
  }
  return { toSend, filtered };
}
