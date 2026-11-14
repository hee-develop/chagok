import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import type { PlaceSnapshot } from '../places/placesApi';

export type SchedulePlaces = InferResponseType<typeof api.schedules.places.$get, 200>;
export type SetupSchedule = SchedulePlaces['schedules'][number];
export type SchedulePlaceChange = { placeId: string | null } | { place: PlaceSnapshot } | { noTravel: true };
export type SavedSchedulePlace = Pick<SetupSchedule, 'id' | 'place' | 'locationText' | 'noTravel' | 'noTravelReason'>;
export type SavedCare = InferResponseType<(typeof api.schedules)[':id']['care']['$put'], 200>;
export type SchedulePlacesApi = {
  fetchSchedules: (signal: AbortSignal) => Promise<SchedulePlaces>;
  savePlace: (id: string, change: SchedulePlaceChange, signal: AbortSignal) => Promise<SavedSchedulePlace>;
  /** 일정 하나의 채비 한 줄을 저장한다. null이면 지운다. 캘린더에는 쓰지 않는다. */
  saveCare: (id: string, care: string | null, signal: AbortSignal) => Promise<SavedCare>;
};

export const schedulePlacesApi: SchedulePlacesApi = {
  fetchSchedules: async (signal) => {
    const res = await api.schedules.places.$get({ query: {} }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /schedules/places ${res.status}`);
    return res.json();
  },
  savePlace: async (id, change, signal) => {
    const res = await api.schedules[':id'].place.$put({ param: { id }, json: change }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `PUT /schedules/:id/place ${res.status}`);
    return res.json();
  },
  saveCare: async (id, care, signal) => {
    const res = await api.schedules[':id'].care.$put({ param: { id }, json: { care } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `PUT /schedules/:id/care ${res.status}`);
    return res.json();
  },
};
