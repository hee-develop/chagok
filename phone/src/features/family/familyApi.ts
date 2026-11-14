import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';

export type FamilyMember = InferResponseType<typeof api.family.members.$get, 200>['members'][number];
export type FamilyRequest = InferResponseType<typeof api.family.requests.$get, 200>['requests'][number];

/** 가족에게 보내기. 가족은 시연용 계정으로 미리 묶어 두고(서버 fixtures/family), 받는 쪽은 아직 프로토타입이다. */
export type FamilyApi = {
  fetchMembers: (signal: AbortSignal) => Promise<FamilyMember[]>;
  /** 이 일정을 이미 보낸 요청 */
  fetchRequests: (scheduleId: string, signal: AbortSignal) => Promise<FamilyRequest[]>;
  /** 일정을 가족 한 명에게 보낸다. 서버가 받아 저장하면 '전달됨'이다. */
  send: (scheduleId: string, memberId: string, signal: AbortSignal) => Promise<FamilyRequest>;
};

export const familyApi: FamilyApi = {
  fetchMembers: async (signal) => {
    const res = await api.family.members.$get({}, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /family/members ${res.status}`);
    return (await res.json()).members;
  },
  fetchRequests: async (scheduleId, signal) => {
    const res = await api.family.requests.$get({ query: { scheduleId } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /family/requests ${res.status}`);
    return (await res.json()).requests;
  },
  send: async (scheduleId, memberId, signal) => {
    const res = await api.schedules[':id']['family-request'].$post({ param: { id: scheduleId }, json: { memberId } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `POST /schedules/:id/family-request ${res.status}`);
    return res.json();
  },
};
