import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { api as serverApi } from '../../api/client';
import { HttpError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { deviceStore, type KeyValueStore } from '../../storage/keyValueStore';
import type { PairingApi } from '../pair-car/pairingApi';

/** 마지막으로 연결한 차의 익명 id. 서버에 그 차가 아직 연결돼 있는지 물을 때 쓴다. */
export const PAIRED_CAR_KEY = 'chagok.pairedCarId.v1';

export type ConnectionState = { status: 'checking' } | { status: 'error' } | { status: 'connected' } | { status: 'notConnected' };

/**
 * 폰이 차와 연결돼 있는가. 오늘·설정 탭이 이 인터페이스만 본다.
 * 지금 구현은 연결할 때 저장해 둔 차 id로 서버(GET /pairing/cars/:carId)에 묻는다.
 * 연결 API가 바뀌면(J1) 이 파일의 구현만 바꾸면 된다.
 */
export interface CarConnectionSource {
  isConnected(signal: AbortSignal): Promise<boolean>;
}

export function createCarConnectionSource(store: KeyValueStore = deviceStore): CarConnectionSource {
  return {
    isConnected: async (signal) => {
      const carId = await store.get(PAIRED_CAR_KEY).catch(() => null);
      if (!carId) return false;
      const res = await serverApi.pairing.cars[':carId'].$get({ param: { carId } }, { init: { signal } });
      if (!res.ok) throw new HttpError(res.status, `GET /pairing/cars/:carId ${res.status}`);
      return (await res.json()).paired;
    },
  };
}

export const carConnectionSource = createCarConnectionSource();

/** 연결에 성공하면 그 차 id를 저장한다. 연결 화면은 그대로 두고 api 한 겹만 감싼다. 저장 실패는 연결 결과에 영향을 주지 않는다. */
export function recordPairedCar(inner: PairingApi, store: KeyValueStore = deviceStore): PairingApi {
  return {
    claim: async (code, signal) => {
      const result = await inner.claim(code, signal);
      await store.set(PAIRED_CAR_KEY, result.carId).catch(() => {});
      return result;
    },
  };
}

/** 화면이 포커스를 얻을 때마다 연결 상태를 새로 읽는다. 늦게 온 이전 응답은 버린다. */
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
    setState({ status: 'checking' });
    void requestWithTimeout((signal) => source.isConnected(signal), timeoutMs, controller).then(
      (connected) => { if (current.current === controller) setState({ status: connected ? 'connected' : 'notConnected' }); },
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
