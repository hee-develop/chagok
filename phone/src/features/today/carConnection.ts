import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { deviceStore, type KeyValueStore } from '../../storage/keyValueStore';
import { pairingApi, type PairingApi } from '../pair-car/pairingApi';

/**
 * J1 이전 버전이 연결한 차 id를 폰에 남기던 키. 지금은 폰 토큰으로 서버에 묻고 폰 응답에는 차 id가 없으므로 값을 쓰지 않는다.
 * 예전에 저장된 값이 있으면 상태를 확인할 때 한 번 지운다.
 */
export const LEGACY_PAIRED_CAR_KEY = 'chagok.pairedCarId.v1';

export type ConnectionState =
  | { status: 'checking' }
  | { status: 'error' }
  /** name은 연결된 자리 이름(이 폰의 기기 이름), pairedAt은 연결한 시각(ISO). */
  | { status: 'connected'; name: string; pairedAt: string }
  | { status: 'notConnected' };

/**
 * 폰이 차와 연결돼 있는가. 오늘·설정 탭이 이 인터페이스만 본다.
 * 구현은 폰 토큰으로 `GET /pair`를 묻는다: 200이면 연결됨(자리 이름·연결 시각), 401(토큰이 없거나 서버가 모름)이면 null, 그 밖의 오류는 던진다.
 */
export interface CarConnectionSource {
  status(signal: AbortSignal): Promise<{ name: string; pairedAt: string } | null>;
}

export function createCarConnectionSource(
  api: Pick<PairingApi, 'status'> = pairingApi,
  store: KeyValueStore = deviceStore,
): CarConnectionSource {
  let cleaned = false;
  return {
    status: async (signal) => {
      if (!cleaned) {
        cleaned = true;
        await store.removeItem(LEGACY_PAIRED_CAR_KEY).catch(() => undefined);
      }
      const status = await api.status(signal);
      return status ? { name: status.name, pairedAt: status.pairedAt } : null;
    },
  };
}

export const carConnectionSource = createCarConnectionSource();

/**
 * 화면이 포커스를 얻을 때마다 연결 상태를 새로 읽는다. 늦게 온 이전 응답은 버린다.
 * 이미 결과가 있으면 다시 읽는 동안 그 결과를 그대로 두어 탭을 오갈 때 카드가 깜빡이지 않는다.
 */
export function useCarConnection({
  source = carConnectionSource,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: { source?: CarConnectionSource; timeoutMs?: number } = {}) {
  const [state, setState] = useState<ConnectionState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const current = useRef<AbortController | null>(null);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    current.current = controller;
    setState((prev) => (prev.status === 'connected' || prev.status === 'notConnected' ? prev : { status: 'checking' }));
    void requestWithTimeout((signal) => source.status(signal), timeoutMs, controller).then(
      (found) => { if (current.current === controller) setState(found ? { status: 'connected', ...found } : { status: 'notConnected' }); },
      () => { if (current.current === controller) setState({ status: 'error' }); },
    );
    return () => {
      current.current = null;
      controller.abort();
    };
  // attempt는 사용자가 [다시 확인]을 누를 때 조회를 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, timeoutMs, attempt]));

  return { state, recheck: () => setAttempt((n) => n + 1) };
}
