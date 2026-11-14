import { useEffect } from 'react';
import { AppState } from 'react-native';

import { expoLocalNotifier, type LocalNotifier } from './localNotifier';
import { appPoller, POLL_INTERVAL_MS, type NotificationPoller } from './poller';
import { handleNotificationTap } from './taps';

/**
 * 앱 루트에서 한 번 부르는 훅. 앱을 열 때·앞으로 올 때 서버 알림함을 보고, 앞에 있는 동안 `intervalMs`마다 다시 본다
 * (뒤로 가면 타이머를 멈춘다: Expo Go는 백그라운드 폴링을 못 한다). 알림을 누르면 종류별 처리(`taps.ts`)를 부른다.
 */
export function useNotifications({
  poller = appPoller,
  notifier = expoLocalNotifier,
  intervalMs = POLL_INTERVAL_MS,
}: { poller?: NotificationPoller; notifier?: LocalNotifier; intervalMs?: number } = {}) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopTimer = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const startTimer = () => {
      stopTimer();
      timer = setInterval(() => void poller.poll(), intervalMs);
    };
    const onActive = () => {
      void poller.poll();
      startTimer();
    };
    if (AppState.currentState === 'active') onActive();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') onActive();
      else stopTimer();
    });
    const unsubscribeTap = notifier.onTap((tap) => void handleNotificationTap(tap));
    return () => {
      appState.remove();
      unsubscribeTap();
      stopTimer();
      poller.stop();
    };
  }, [poller, notifier, intervalMs]);
}
