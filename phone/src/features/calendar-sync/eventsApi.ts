import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import type { DeviceEvent } from '../calendar-select/calendarSource';

export type SendEvents = (events: DeviceEvent[], signal: AbortSignal) => Promise<unknown>;

/** 오늘·내일 일정 전체를 서버에 바꿔 넣는다(PUT /events). */
export const putEvents: SendEvents = async (events, signal) => {
  const res = await api.events.$put({ json: { events } }, { init: { signal } });
  if (!res.ok) throw new HttpError(res.status, `PUT /events ${res.status}`);
  return res.json();
};
