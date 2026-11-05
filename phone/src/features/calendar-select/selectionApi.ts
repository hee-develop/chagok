import { api } from '../../api/client';

export const REQUEST_TIMEOUT_MS = 10_000;

export type SaveSelection = (selectedIds: string[], revision: number, signal: AbortSignal) => Promise<unknown>;
export type FetchSelection = (signal: AbortSignal) => Promise<string[] | null>;

export const saveCalendarSelection: SaveSelection = async (selectedIds, revision, signal) => {
  const res = await api.calendars.selection.$put({ json: { selectedIds, revision } }, { init: { signal } });
  if (!res.ok) throw new Error(`PUT /calendars/selection ${res.status}`);
  return res.json();
};

export const fetchCalendarSelection: FetchSelection = async (signal) => {
  const res = await api.calendars.selection.$get({}, { init: { signal } });
  if (!res.ok) throw new Error(`GET /calendars/selection ${res.status}`);
  return (await res.json()).selectedIds;
};

/** 호출할 때마다 이전보다 큰 정수를 돌려준다. 밀리초 시각에 1000을 곱한 값 위에서 같은 시각 안의 호출은 1씩 올린다. */
export function createRevisionClock(now: () => number = Date.now): () => number {
  let last = 0;
  return () => {
    last = Math.max(last + 1, now() * 1000);
    return last;
  };
}
