import { useEffect } from 'react';
import { AppState } from 'react-native';

import { appEventSync, type EventSync } from './eventSync';

/**
 * 앱이 앞에 있는 동안 캘린더를 다시 읽는 간격. 정책서 10.2의 '캘린더가 바뀔 때(앱이 깨어 있을 때)'를 주기적 재읽기로 대신한다.
 * 읽기·거르기는 폰 안에서 끝나고, 내용이 같으면 서버로 보내지 않으므로(`RESEND_UNCHANGED_AFTER_MS`, 15분마다만 같은 내용을 다시 보낸다) 짧게 잡아도 부담이 적다.
 */
export const REREAD_INTERVAL_MS = 3 * 60 * 1000;

/**
 * 앱을 열 때, 앱이 앞으로 올 때(AppState active), 앞에 있는 동안 `intervalMs`마다 일정을 서버에 보낸다.
 * 뒤로 가면(background·inactive) 주기를 멈춘다. 처음 읽기는 앱 상태와 상관없이 한 번 한다(앱을 열 때 불린다). 동시에 하나만 보내는 규칙은 sync가 지킨다(겹치면 하나로 합쳐짐).
 */
export function useEventSync(sync: EventSync = appEventSync, intervalMs: number = REREAD_INTERVAL_MS) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
      if (timer === null) timer = setInterval(() => void sync.run(), intervalMs);
    };
    const stopTimer = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    void sync.run();
    // 마운트 시점에 앱이 앞(active)에 있을 때만 주기를 시작한다. 뒤에서 마운트되면 앞으로 올 때 시작한다.
    if (AppState.currentState === 'active') startTimer();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void sync.run();
        startTimer();
      } else {
        stopTimer();
      }
    });
    return () => {
      subscription.remove();
      stopTimer();
      sync.stop();
    };
  }, [sync, intervalMs]);
}
