import { api } from '../../api/client';

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
