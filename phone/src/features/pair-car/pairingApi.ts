import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';

export type PairingResult = InferResponseType<typeof api.pairing.claim.$post, 200>;

/** 차–폰 연결. 차 화면의 QR·숫자 6자리를 서버에 보내면 그 차가 연결된다(계약: docs/pairing.md). */
export type PairingApi = {
  claim: (code: string, signal: AbortSignal) => Promise<PairingResult>;
};

export const pairingApi: PairingApi = {
  claim: async (code, signal) => {
    const res = await api.pairing.claim.$post({ json: { code } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `POST /pairing/claim ${res.status}`);
    return res.json();
  },
};
