import { useEffect } from 'react';
import { AppState } from 'react-native';

import { session as appSession, type Session } from '../../api/session';
import { appEventSync, type EventSync } from '../calendar-sync/eventSync';
import { EVENTS_STALE_KIND, staleOutcomeOf } from './eventsStale';
import { appInbox, type Inbox } from './inbox';
import { expoLocalNotifier, type LocalNotifier } from './localNotifier';
import { appPoller, POLL_INTERVAL_MS, type NotificationPoller } from './poller';
import { handleNotificationTap } from './taps';

/**
 * 앱 루트에서 한 번 부르는 훅. 앱을 열 때·앞으로 올 때 서버 알림함을 보고, 앞에 있는 동안 `intervalMs`마다 다시 본다
 * (뒤로 가면 타이머를 멈춘다: Expo Go는 백그라운드 폴링을 못 한다). 알림을 누르면 종류별 처리(`taps.ts`)를 부른다.
 * 그 밖에 두 가지를 이어 둔다.
 * - 일정 동기화가 보냄·변화 없음으로 끝나거나 이 폰이 일정을 보낼 수 없는 상태로 끝나면 폰 알림함의 `events-stale`을 지운다(해결된 경고가 홈에 남지 않게).
 * - 폰 토큰이 지워지면(연결 끊기·401) 진행 중인 폴링을 멈추고 폰 알림함을 비운다(다른 자리의 알림이 이어 보이지 않게).
 */
export function useNotifications({
  poller = appPoller,
  notifier = expoLocalNotifier,
  intervalMs = POLL_INTERVAL_MS,
  sync = appEventSync,
  inbox = appInbox,
  session = appSession,
}: {
  poller?: NotificationPoller;
  notifier?: LocalNotifier;
  intervalMs?: number;
  sync?: Pick<EventSync, 'subscribe'>;
  inbox?: Pick<Inbox, 'dismissKind' | 'clear'>;
  session?: Pick<Session, 'onTokenCleared'>;
} = {}) {
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
    const unsubscribeSync = sync.subscribe((result) => {
      if (staleOutcomeOf(result) !== 'unknown') inbox.dismissKind(EVENTS_STALE_KIND);
    });
    const unsubscribeSession = session.onTokenCleared(() => {
      poller.stop(); // 옛 자리의 늦은 응답이 방금 비운 알림함을 다시 채우지 않게
      inbox.clear();
    });
    return () => {
      appState.remove();
      unsubscribeTap();
      unsubscribeSync();
      unsubscribeSession();
      stopTimer();
      poller.stop();
    };
  }, [poller, notifier, intervalMs, sync, inbox, session]);
}
