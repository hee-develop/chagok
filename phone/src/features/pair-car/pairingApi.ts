import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import { session } from '../../api/session';
import { getDeviceName } from './deviceName';

/** 연결 결과. 서버가 준 폰 토큰은 여기서 저장하고 화면에는 넘기지 않는다. */
export type PairingResult = Omit<InferResponseType<typeof api.pair.claim.$post, 200>, 'phoneToken'>;

/** 연결 상태(`GET /pair` 200). 자리 이름·연결 시각으로 '○○ 폰으로 연결됨'을 보인다. 차 id는 오지 않는다. */
export type PairStatus = InferResponseType<typeof api.pair.$get, 200>;

/** 차–폰 연결. 차 화면의 QR·숫자 6자리를 서버에 보내면 이 폰이 그 차의 운전자 자리가 된다(계약: docs/pairing.md). */
export type PairingApi = {
  claim: (code: string, signal: AbortSignal) => Promise<PairingResult>;
  /** 차 연결 끊기: 서버가 이 폰의 자리와 일정·기억을 지우고 폰은 토큰을 버린다. 설정 화면이 붙을 자리다. */
  disconnect: (signal: AbortSignal) => Promise<void>;
  /** 지금 연결 상태. 연결 안 됨(토큰 없음·끊김·다른 폰으로 바뀜: 서버 401)이면 null. 그 밖의 오류는 던진다. */
  status: (signal: AbortSignal) => Promise<PairStatus | null>;
};

export const pairingApi: PairingApi = {
  claim: async (code, signal) => {
    const res = await api.pair.claim.$post({ json: { code, name: getDeviceName() } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `POST /pair/claim ${res.status}`);
    const { phoneToken, ...result } = await res.json();
    await session.setToken(phoneToken);
    return result;
  },
  disconnect: async (signal) => {
    const res = await api.pair.$delete(undefined, { init: { signal } });
    // 401은 서버가 이미 이 토큰을 모른다는 뜻이라(바뀜·끊김·초기화) 끊긴 것과 같다.
    const status: number = res.status;
    if (status !== 200 && status !== 401) throw new HttpError(status, `DELETE /pair ${status}`);
    await session.clearToken();
  },
  status: async (signal) => {
    const res = await api.pair.$get(undefined, { init: { signal } });
    // 401은 연결되지 않았다는 뜻이다(토큰이 없거나 서버가 모른다). 보낸 토큰은 요청 층이 이미 버렸다.
    const status: number = res.status;
    if (status === 401) return null;
    if (!res.ok) throw new HttpError(status, `GET /pair ${status}`);
    return await res.json();
  },
};
