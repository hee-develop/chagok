import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';

/** 서버가 기억한 '이동 없음' 일정 이름(`GET /skips`). 최근에 더한 것부터. */
export type SkipEntry = InferResponseType<typeof api.skips.$get, 200>['skips'][number];
export type SkipChange = { add?: string[]; remove?: string[] };

export type SkipsApi = {
  /** 서버의 이동 없음 목록. */
  fetch: (signal: AbortSignal) => Promise<SkipEntry[]>;
  /** 이름을 더하고 뺀다(`PUT /skips`). 바뀐 뒤의 전체 목록을 돌려준다. */
  change: (change: SkipChange, signal: AbortSignal) => Promise<SkipEntry[]>;
};

export const skipsApi: SkipsApi = {
  fetch: async (signal) => {
    const res = await api.skips.$get(undefined, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /skips ${res.status}`);
    return (await res.json()).skips;
  },
  change: async (change, signal) => {
    const res = await api.skips.$put({ json: change }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `PUT /skips ${res.status}`);
    return (await res.json()).skips;
  },
};
