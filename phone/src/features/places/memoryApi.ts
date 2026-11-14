import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';

/** 이 자리가 기억한 장소 한 줄(이름 → 장소, 애매 여부). 차가 '다음부터 여기로 기억할게요'로 저장한 것이다(계약: docs/place-resolve.md). */
export type PlaceMemory = InferResponseType<typeof api.places.memory.$get, 200>['memories'][number];

/**
 * 폰의 '기억한 장소' API. 목록·지우기 화면은 장소 탭 묶음이 붙인다(정책서 10.8 '기억한 장소 지우기').
 * 저장(`PUT /places/memory`)과 해석(`POST /places/resolve`)은 차가 부르므로 폰 클라이언트에는 없다.
 */
export type PlaceMemoryApi = {
  /** 최근에 쓴 기억부터. */
  fetchMemories: (signal: AbortSignal) => Promise<PlaceMemory[]>;
  /** 기억 하나 지우기. 이미 없으면(404) 지운 것과 같으므로 false, 지웠으면 true. 그 밖의 오류는 던진다. */
  deleteMemory: (name: string, signal: AbortSignal) => Promise<boolean>;
};

export const placeMemoryApi: PlaceMemoryApi = {
  fetchMemories: async (signal) => {
    const res = await api.places.memory.$get({}, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /places/memory ${res.status}`);
    return (await res.json()).memories;
  },
  deleteMemory: async (name, signal) => {
    const res = await api.places.memory[':name'].$delete({ param: { name } }, { init: { signal } });
    const status: number = res.status;
    if (status === 404) return false;
    if (status !== 200) throw new HttpError(status, `DELETE /places/memory/:name ${status}`);
    return true;
  },
};
