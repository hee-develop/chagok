import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';

export type SchedulePlaces = InferResponseType<typeof api.schedules.places.$get, 200>;
export type SetupSchedule = SchedulePlaces['schedules'][number];
export type SchedulePlaceChange = { placeId: string | null } | { noTravel: true };
export type SavedSchedulePlace = Pick<SetupSchedule, 'id' | 'place' | 'locationText' | 'noTravel' | 'noTravelReason'>;
export type SchedulePlacesApi = {
  fetchSchedules: (signal: AbortSignal) => Promise<SchedulePlaces>;
  savePlace: (id: string, change: SchedulePlaceChange, signal: AbortSignal) => Promise<SavedSchedulePlace>;
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
};
