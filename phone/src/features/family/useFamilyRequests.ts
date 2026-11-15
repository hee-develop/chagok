import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { familyGroupApi, type FamilyGroupApi } from './familyGroupApi';
import { memberSession, type MemberSession } from './memberSecret';
import type { ReceivedRequest, SentRequest } from './requestModel';

/**
 * 앱이 앞에 있고 화면이 보이는 동안 요청 목록을 다시 읽는 주기. 알림 폴링(60초, `notifications/poller.ts`)과 박자가 겹치지 않게 그 약수·배수가 아닌 45초로 두고,
 * 서버가 느려도 한 번에 하나만 돈다. 앱을 열 때·앞으로 올 때·탭이 포커스를 얻을 때도 바로 읽는다.
 */
export const REQUESTS_POLL_MS = 45_000;

export type RequestsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; sent: SentRequest[]; received: ReceivedRequest[] };

/**
 * 보낸 요청과 받은 요청(`GET /requests`). 가족 탭과 오늘 탭의 '받은 가족 요청'이 같이 쓴다.
 * - 화면이 포커스를 얻을 때 읽고, 포커스가 있고 앱이 앞에 있는 동안 `intervalMs`마다 다시 읽는다(앱이 뒤로 가면 멈추고, 다시 앞으로 오면 바로 읽고 이어 간다).
 * - 읽는 요청은 한 번에 하나다: 새 조회가 시작되면 이전 조회를 취소하고, 응답을 반영하기 전에 그 요청의 controller가 아직 현재 것인지 확인해 늦은 응답은 버린다.
 * - 이미 목록이 있으면 다시 읽다 실패해도 그대로 둔다(주기 조회가 화면을 오류로 깜빡이지 않게). 처음 읽기(또는 목록이 없을 때)의 실패만 오류로 보인다.
 * - 가족에서 나가거나(비밀값이 지워짐) 서버가 모르는 구성원이면 목록을 비운다.
 * - 마지막 응답이 '가족 없음'(`lists.family === false`)이면 주기 조회를 돌리지 않는다(받을 요청이 있을 수 없다).
 * `enabled`가 false면 요청하지 않는다.
 */
export function useFamilyRequests({
  api = familyGroupApi,
  member = memberSession,
  timeoutMs = REQUEST_TIMEOUT_MS,
  intervalMs = REQUESTS_POLL_MS,
  enabled = true,
}: { api?: FamilyGroupApi; member?: Pick<MemberSession, 'subscribe'>; timeoutMs?: number; intervalMs?: number; enabled?: boolean } = {}) {
  const [state, setState] = useState<RequestsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  /** 응답을 화면에 반영한 횟수. 화면이 '내가 부른 새로 읽기가 끝났는가'를 가리는 데 쓴다. */
  const [reads, setReads] = useState(0);
  const current = useRef<AbortController | null>(null);
  /** 마지막 응답이 가족 없음이면 거짓: 받을 요청이 있을 수 없으므로 주기 조회를 멈춘다(포커스·앞으로 올 때·직접 부를 때는 읽는다). */
  const pollable = useRef(true);

  const read = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    try {
      const lists = await requestWithTimeout((signal) => api.fetchRequests(signal), timeoutMs, controller);
      if (current.current === controller) {
        pollable.current = lists.family !== false;
        setState({ status: 'ready', sent: lists.sent, received: lists.received });
        setReads((n) => n + 1);
      }
    } catch {
      if (current.current === controller) setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [api, timeoutMs]);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null && intervalMs > 0) timer = setInterval(() => { if (pollable.current) void read(); }, intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    void read();
    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void read();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      subscription.remove();
      current.current?.abort();
      current.current = null;
    };
  // attempt는 사용자가 다시 시도할 때 조회를 처음부터 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, read, attempt]));

  // 가족에서 나가거나 정리되면 비밀값이 지워진다. 옛 목록을 남기지 않는다.
  useEffect(() => member.subscribe((event) => {
    if (event.type === 'cleared') {
      pollable.current = false;
      setState({ status: 'ready', sent: [], received: [] });
    } else {
      pollable.current = true;
    }
  }), [member]);

  return {
    state,
    reads,
    /** 지금 바로 다시 읽는다(요청을 만든 뒤, 상태를 눌러 확인할 때). 이미 목록이 있으면 그대로 두고 읽는다. */
    refresh: () => void read(),
    /** 오류 화면의 다시 시도: 목록을 로딩으로 되돌리고 처음부터 읽는다. */
    retry: () => {
      setState({ status: 'loading' });
      setAttempt((n) => n + 1);
    },
  };
}
