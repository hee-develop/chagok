import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import { session } from '../../api/session';
import { getDeviceName } from './deviceName';

/** 연결 결과. 서버가 준 폰 토큰은 여기서 저장하고 화면에는 넘기지 않는다. */
export type PairingResult = Omit<InferResponseType<typeof api.pair.claim.$post, 200>, 'phoneToken'>;

/** 차–폰 연결. 차 화면의 QR·숫자 6자리를 서버에 보내면 이 폰이 그 차의 운전자 자리가 된다(계약: docs/pairing.md). */
export type PairingApi = {
  claim: (code: string, signal: AbortSignal) => Promise<PairingResult>;
  /** 차 연결 끊기: 서버가 이 폰의 자리와 일정·기억을 지우고 폰은 토큰을 버린다. 설정 화면이 붙을 자리다. */
  disconnect: (signal: AbortSignal) => Promise<void>;
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
};
