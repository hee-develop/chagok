import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import { session } from '../../api/session';
import { getDeviceName } from './deviceName';
import { clearLocalCarState, quiesceLocalCarState } from './localState';

/** 연결 결과. 서버가 준 폰 토큰은 여기서 저장하고 화면에는 넘기지 않는다. */
export type PairingResult = Omit<InferResponseType<typeof api.pair.claim.$post, 200>, 'phoneToken'>;

/** 연결 상태(`GET /pair` 200). 자리 이름·연결 시각으로 '○○ 폰으로 연결됨'을 보인다. 차 id는 오지 않는다. */
export type PairStatus = InferResponseType<typeof api.pair.$get, 200>;

/** 차–폰 연결. 차 화면의 QR·숫자 6자리를 서버에 보내면 이 폰이 그 차의 운전자 자리가 된다(계약: docs/pairing.md). */
export type PairingApi = {
  claim: (code: string, signal: AbortSignal) => Promise<PairingResult>;
  /**
   * 차 연결 끊기: 서버가 이 폰의 자리와 일정·기억을 지우고(`DELETE /pair`, 정책서 10.9), 폰은 토큰과 그 자리에 딸린 로컬 상태(알림함·폴링·일정 보내기 기억·거른 일정 목록)를
   * 비운다(`clearLocalCarState`). 확인 화면은 설정 화면 묶음이 붙인다(이 함수만 부르면 된다).
   * **서버 DELETE 전에** 알림 폴링과 일정 보내기를 멈추고(보내기는 붙잡아 둔다) 기억을 잊는다: 끊는 도중 진행 중이던 보내기가 401을 받고 토큰 없이 다시 보내
   * 연결 전 버킷에 일정을 만들지 않게 한다. 서버 오류로 던지면 토큰·알림함·거른 일정은 그대로 두고 붙잡은 보내기만 풀어(다음에 앞으로 올 때 다시 보낸다) 다시 시도할 수 있게 한다.
   */
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
    const release = quiesceLocalCarState();
    try {
      const res = await api.pair.$delete(undefined, { init: { signal } });
      // 401은 서버가 이미 이 토큰을 모른다는 뜻이라(바뀜·끊김·초기화) 끊긴 것과 같다.
      const status: number = res.status;
      if (status !== 200 && status !== 401) throw new HttpError(status, `DELETE /pair ${status}`);
      await session.clearToken();
      clearLocalCarState();
    } finally {
      release();
    }
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
