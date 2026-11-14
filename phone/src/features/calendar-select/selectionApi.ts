import { api } from '../../api/client';
import { HttpError } from '../../api/request';

export type SaveSelection = (selectedIds: string[], revision: number, signal: AbortSignal) => Promise<unknown>;
/** 캘린더 출처. device면 서버가 목 캘린더 id 검사를 하지 않는다. */
export type SelectionSourceKind = 'mock' | 'device';
export type FetchSelection = (signal: AbortSignal) => Promise<string[] | null>;

export const saveCalendarSelection = async (
  selectedIds: string[],
  revision: number,
  signal: AbortSignal,
  sourceKind: SelectionSourceKind = 'mock',
): Promise<unknown> => {
  // 실제 기기 캘린더 id는 서버의 목 캘린더 id가 아니므로 항상 선택의 출처를 함께 보낸다.
  const json = { selectedIds, revision, source: sourceKind };
  const res = await api.calendars.selection.$put({ json }, { init: { signal } });
  if (!res.ok) throw new Error(`PUT /calendars/selection ${res.status}`);
  return res.json();
};

export const fetchCalendarSelection: FetchSelection = async (signal) => {
  const res = await api.calendars.selection.$get({}, { init: { signal } });
  if (!res.ok) throw new Error(`GET /calendars/selection ${res.status}`);
  return (await res.json()).selectedIds;
};

/** 서버에 저장된 선택 전체. 저장한 적이 없으면 selectedIds·source가 null. */
export type SelectionState = { selectedIds: string[] | null; source: SelectionSourceKind | null };
export type FetchSelectionState = (signal: AbortSignal) => Promise<SelectionState>;

export const fetchCalendarSelectionState: FetchSelectionState = async (signal) => {
  const res = await api.calendars.selection.$get({}, { init: { signal } });
  if (!res.ok) throw new HttpError(res.status, `GET /calendars/selection ${res.status}`);
  const body = await res.json();
  return { selectedIds: body.selectedIds, source: body.source };
};
