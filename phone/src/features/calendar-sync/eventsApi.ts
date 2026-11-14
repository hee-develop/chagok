import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import type { WireEvent } from './wireEvent';

export type SendEvents = (events: WireEvent[], signal: AbortSignal) => Promise<unknown>;

/** 오늘·내일 일정 전체를 서버에 바꿔 넣는다(PUT /events). */
export const putEvents: SendEvents = async (events, signal) => {
  const res = await api.events.$put({ json: { events } }, { init: { signal } });
  if (!res.ok) throw new HttpError(res.status, `PUT /events ${res.status}`);
  return res.json();
};

export type FetchReceivedAt = (signal: AbortSignal) => Promise<string | null>;

/** 서버가 폰 일정을 받은 적이 있는가(GET /events의 `receivedAt`, 받은 적이 없거나 재시작·초기화됐으면 null). */
export const fetchEventsReceivedAt: FetchReceivedAt = async (signal) => {
  const res = await api.events.$get({ query: { date: undefined } }, { init: { signal } });
  if (!res.ok) throw new HttpError(res.status, `GET /events ${res.status}`);
  return (await res.json()).receivedAt;
};
