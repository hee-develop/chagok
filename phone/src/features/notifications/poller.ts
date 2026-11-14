import { requestWithTimeout, REQUEST_TIMEOUT_MS } from '../../api/request';
import { session } from '../../api/session';
import { appEventSync, type EventSync } from '../calendar-sync/eventSync';
import { EVENTS_STALE_KIND, SYNC_WAIT_MS, settleEventsStale } from './eventsStale';
import { appInbox, compareIds, type Inbox } from './inbox';
import { expoLocalNotifier, type LocalNotifier } from './localNotifier';
import { notificationsApi, type NotificationsApi } from './notificationsApi';

/** 앱이 앞에 있는 동안 서버 알림함을 보는 주기(밀리초). */
export const POLL_INTERVAL_MS = 60_000;

export type PollResult =
  | 'ok'
  | 'no-session' // 폰 토큰이 없다(연결 전): 서버에 묻지 않는다
  | 'failed'
  | 'cancelled';

export type PollerOptions = {
  api?: NotificationsApi;
  inbox?: Inbox;
  notifier?: LocalNotifier;
  /** 연결된 폰인가(폰 토큰이 있는가). 기본은 세션의 토큰. */
  hasSession?: () => Promise<boolean>;
  /** '일정을 못 받고 있어요'를 받았을 때 결과를 따르는 일정 동기화. 기본은 앱 전체가 쓰는 하나. */
  sync?: Pick<EventSync, 'inFlight' | 'run'>;
  /** 일정 동기화 결과를 기다리는 최대 시간(밀리초). */
  syncWaitMs?: number;
  timeoutMs?: number;
  /** 실패를 드러내는 곳. 알림 내용 없이 단계와 오류 이름만 넘긴다. 기본은 개발 빌드에서 console.warn. */
  log?: (message: string) => void;
};

export type NotificationPoller = {
  /**
   * 서버 알림함을 한 번 본다. **동시에 하나만** 돈다: 도는 중에 다시 불리면 그 실행의 결과를 같이 받는다(새 요청을 쌓지 않는다).
   * 새 알림만 폰 알림함에 담고, 권한이 있으면 시스템 알림으로 띄우고, 읽어 간 알림은 서버에서 지운다.
   * 받은 `events-stale`은 이 폰의 일정 동기화 결과를 따른다(진행 중이면 기다린다): 보냈거나(`sent`·`unchanged`) 이 폰이 일정을 보낼 수 없는 상태
   * (권한 꺼짐·캘린더 미선택·목)면 알림함에도 시스템 알림에도 쓰지 않고 ack만 한다(앱을 연 순간 낡은 경고가 뜨지 않게).
   * 서버가 바뀌었거나 서버 시계가 뒤로 가서 마지막 id가 서버 id 기준값(`cursor`)보다 커졌으면 마지막 id를 버리고 처음부터 받는다.
   */
  poll(): Promise<PollResult>;
  /** 진행 중인 요청을 취소한다. 취소된 요청의 늦은 응답은 화면(알림함·시스템 알림)에 반영하지 않는다. */
  stop(): void;
};

const devLog = (message: string) => {
  if (__DEV__) console.warn(message);
};

const errorName = (e: unknown) => (e instanceof Error ? e.name : 'error');

export function createNotificationPoller({
  api = notificationsApi,
  inbox = appInbox,
  notifier = expoLocalNotifier,
  hasSession = async () => Boolean(await session.getToken()),
  sync = appEventSync,
  syncWaitMs = SYNC_WAIT_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  log = devLog,
}: PollerOptions = {}): NotificationPoller {
  let running: Promise<PollResult> | null = null;
  let current: AbortController | null = null;
  /** stop()마다 올라간다. 그 전에 시작한 실행의 늦은 결과를 버리는 데 쓴다. */
  let generation = 0;

  const once = async (): Promise<PollResult> => {
    const started = generation;
    if (!(await hasSession())) return 'no-session';
    if (started !== generation) return 'cancelled';
    const controller = new AbortController();
    current = controller;
    // stop()이나 더 새로운 요청이 이 요청을 밀어냈는가. 시간 제한으로 abort된 것은 '실패'이지 취소가 아니다.
    const cancelled = () => started !== generation || current !== controller;
    try {
      await inbox.load();
      const since = inbox.getState().lastId;
      let page = await requestWithTimeout((signal) => api.fetchNew(since, signal), timeoutMs, controller);
      if (cancelled()) return 'cancelled';
      if (since !== null && page.cursor !== null && compareIds(since, page.cursor) > 0) {
        // 마지막 id가 서버가 아는 id보다 크다: 다른 서버이거나 서버 시계가 뒤로 갔다. 처음부터 받는다(이미 가진 알림은 id로 걸러진다).
        inbox.resetLastId();
        page = await requestWithTimeout((signal) => api.fetchNew(null, signal), timeoutMs, controller);
        if (cancelled()) return 'cancelled';
      }
      const received = page.notifications;
      const stale = received.filter((n) => n.kind === EVENTS_STALE_KIND);
      let skip: ReadonlySet<string> | undefined;
      if (stale.length > 0) {
        const outcome = await settleEventsStale(sync, syncWaitMs);
        if (cancelled()) return 'cancelled';
        if (outcome !== 'unknown') skip = new Set(stale.map((n) => n.id));
      }
      const added = await inbox.add(received, { skip });
      if (cancelled()) return 'cancelled';
      if (added.length > 0) {
        // 권한이 없으면(거부·미결정) 시스템 알림 없이 폰 알림함(홈)에만 둔다.
        const allowed = await notifier.permission().catch(() => 'denied' as const);
        if (allowed === 'granted') {
          for (const item of added) {
            try {
              await notifier.present(item);
            } catch (e) {
              log(`[notifications] 알림 표시 실패: ${errorName(e)}`);
            }
          }
        }
      }
      if (cancelled()) return 'cancelled';
      if (received.length > 0) {
        try {
          // 알림함에 담은 뒤에 지운다. 지우기가 실패해도 id(lastId)로 다시 담지 않는다.
          await requestWithTimeout((signal) => api.ack(received.map((n) => n.id), signal), timeoutMs, controller);
        } catch (e) {
          if (cancelled()) return 'cancelled';
          log(`[notifications] ack 실패: ${errorName(e)}`);
        }
      }
      return 'ok';
    } catch (e) {
      if (cancelled()) return 'cancelled';
      log(`[notifications] 폴링 실패: ${errorName(e)}`);
      return 'failed';
    } finally {
      if (current === controller) current = null;
    }
  };

  return {
    poll() {
      if (running) return running;
      const run: Promise<PollResult> = once().finally(() => {
        if (running === run) running = null;
      });
      running = run;
      return run;
    },
    stop() {
      generation += 1;
      current?.abort();
      current = null;
      running = null; // 멈춘 뒤 다시 시작하면(화면이 다시 붙음) 취소된 옛 실행을 기다리지 않고 새로 돈다
    },
  };
}

/** 앱 전체가 하나를 공유한다. */
export const appPoller = createNotificationPoller();
