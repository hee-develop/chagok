import { travelFilterReason } from '@chagok/server/no-travel';

import type { DeviceEvent } from '../calendar-select/calendarSource';
import type { FilteredEvent } from './filteredEvents';

/**
 * 폰이 일정을 읽은 뒤 서버로 보내기 전에 거른다(정책서 10.3 표 1~3번). 판정은 서버와 같은 함수 한 곳(`@chagok/server/no-travel`).
 * - 종일: 이름만 보낸다(메모·참석자는 비운다. 장소 칸은 "어디로 갈까요?" 후보에 쓰이므로 남긴다).
 * - 온라인·건물 안: 보내지 않는다. 제목이 폰 밖으로 나가지 않는다. 폰 로컬 목록(`filtered`)에만 남겨 화면에 흐리게 보인다.
 * - 단 사용자가 같은 이름을 "이동 일정이에요"로 바꿨다면 거르지 않고 보내며, 서버의 안전망도 건너뛰도록 `travelConfirmed`를 단다.
 * - 장소 칸이 비었거나 보통 장소면 그대로 보낸다.
 */
export function partitionEvents(
  events: readonly DeviceEvent[],
  isTravelException: (title: string) => boolean,
): { toSend: DeviceEvent[]; filtered: FilteredEvent[] } {
  const toSend: DeviceEvent[] = [];
  const filtered: FilteredEvent[] = [];
  for (const event of events) {
    const reason = travelFilterReason(event);
    if (reason === null) {
      toSend.push(event);
    } else if (reason === 'allDay') {
      toSend.push({ ...event, notes: null, attendees: [] });
    } else if (isTravelException(event.title)) {
      toSend.push({ ...event, travelConfirmed: true });
    } else {
      filtered.push({ id: event.id, title: event.title, start: event.start, end: event.end, reason });
    }
  }
  return { toSend, filtered };
}
