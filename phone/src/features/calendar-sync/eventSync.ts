import { HttpError, requestWithTimeout, REQUEST_TIMEOUT_MS, createRevisionClock } from '../../api/request';
import { CalendarPermissionError, type CalendarSource, type DeviceEvent } from '../calendar-select/calendarSource';
import { defaultCalendarSource } from '../calendar-select/defaultSource';
import {
  fetchCalendarSelectionState,
  saveCalendarSelection,
  type FetchSelectionState,
} from '../calendar-select/selectionApi';
import { fetchEventsReceivedAt, putEvents, type FetchReceivedAt, type SendEvents } from './eventsApi';
import { appFilteredEvents, type FilteredEvent } from './filteredEvents';
import { fitToBudget } from './payloadBudget';
import { appTravelExceptions, type TravelExceptions } from './travelExceptions';
import { partitionEvents } from './travelFilter';

export type SyncResult =
  | 'sent'
  | 'unchanged' // 직전에 보낸 것과 같고 RESEND_UNCHANGED_AFTER_MS가 지나지 않아 다시 보내지 않음
  | 'mock' // 목 출처는 보내지 않음
  | 'no-selection' // 고른 기기 캘린더가 아직 없음(저장된 선택이 없거나 목 캘린더 선택)
  | 'permission-denied'
  | 'failed'
  | 'cancelled';

/**
 * 내용이 같으면 서버로 다시 보내지 않는다. 다만 서버가 재시작해 폰 일정을 잊었거나 날짜가 지나 지웠을 수 있어, 같은 내용도 이 간격이 지나면 한 번 다시 보낸다.
 * 앞에 있는 동안 3분마다 읽으므로(`useEventSync`의 `REREAD_INTERVAL_MS`) 그 5배 = 15분이고, 읽는 시각이 조금 어긋나도 한 번 더 기다리는 정도(18분)다.
 * 이 기준 시각은 보내기를 시작한 때다(응답이 늦어도 간격이 밀리지 않는다).
 */
export const RESEND_UNCHANGED_AFTER_MS = 15 * 60 * 1000;

export type EventSyncOptions = {
  source?: CalendarSource;
  fetchSelection?: FetchSelectionState;
  /** 서버가 선택을 잃었을 때(재시작) 기억해 둔 선택을 다시 저장한다. */
  saveSelection?: (selectedIds: string[], revision: number, signal: AbortSignal) => Promise<unknown>;
  send?: SendEvents;
  /** 서버가 폰 일정을 받은 시각(받은 적이 없으면 null). 같은 내용 생략 직전에 확인한다. */
  fetchReceivedAt?: FetchReceivedAt;
  /** "이동 일정이에요"로 바꾼 이름 목록(폰 저장소). */
  exceptions?: Pick<TravelExceptions, 'load' | 'has'>;
  /** 폰이 거른 일정을 받는 곳(화면이 흐리게 보인다). 서버로는 보내지 않는다. */
  filtered?: { set(events: readonly FilteredEvent[]): void };
  timeoutMs?: number;
  now?: () => Date;
  /** 실패를 드러내는 곳. 일정 내용 없이 결과 이름과 HTTP 상태만 넘긴다. 기본은 개발 빌드에서 console.warn. */
  log?: (message: string) => void;
};

export type EventSync = {
  /** 고른 캘린더의 오늘·내일 일정을 읽어 서버로 보낸다. 이미 보내는 중이면 끝난 뒤 한 번 더(다시 읽어서) 보낸다. */
  run(): Promise<SyncResult>;
  /** 진행 중인 요청을 취소하고 대기 중인 재실행을 버린다. */
  stop(): void;
  /** 선택을 서버에 저장한 직후 알린다. 서버가 선택을 잃으면 이 값으로 다시 저장한다(앱이 떠 있는 동안만 기억). */
  rememberSelection(selectedIds: string[]): void;
  /** 가장 최근 실행의 결과(화면에서 상태를 보여 주거나 디버깅할 때). */
  lastResult(): SyncResult | null;
};

const devLog = (message: string) => {
  if (__DEV__) console.warn(message);
};

/**
 * 폰 일정 보내기.
 * - 동시에 하나만 보낸다. 보내는 중에 다시 불리면 하나로 합쳐 끝난 뒤 한 번만 더 돈다(PUT은 전체 교체라 순서가 뒤집히면 안 된다).
 * - 선택은 서버에 저장된 값을 읽는다. 기기 캘린더(source=device)로 저장한 선택만 쓰고, 없거나 목 캘린더 선택이면 보내지 않는다
 *   (목 id로 기기 일정을 조회해 빈 목록을 보내면 서버가 폰 출처로 영구 전환되므로).
 * - 서버에 선택이 없는데(재시작) 이 앱이 마지막 선택을 기억하면 그 선택을 다시 저장한 뒤 보낸다. 서버가 선택을 잃었다면 일정도 잃었으므로
 *   이 경우에는 같은 내용이어도 반드시 다시 보낸다(생략하지 않는다).
 * - 같은 내용을 생략하기 직전에 서버가 일정을 받은 적이 있는지(`GET /events`의 `receivedAt`)를 확인한다. null이면(서버 재시작·초기화·알 수 없음) 생략하지 않는다.
 * - 읽은 일정은 보내기 전에 폰에서 거른다(`travelFilter.ts`): 온라인·건물 안 일정은 보내지 않고 폰 로컬 목록에만 두며,
 *   종일 일정은 이름만 보낸다. 같은 내용 판단·크기 예산은 거른 뒤의 일정으로 한다.
 * - 거른 목록(`filtered`)은 일정을 읽은 결과다. 고른 캘린더가 없거나 권한이 없거나 캘린더를 읽지 못하면 이전 목록을 비운다(낡은 일정을 계속 보이지 않는다).
 * - 예외 이름 목록(AsyncStorage)을 읽는 데 시간 제한을 두고, 읽지 못해도 동기화는 멈추지 않는다(저장된 이름을 모르는 채 이어 간다).
 * - 권한을 묻지 않는다. 권한이 없으면 그냥 건너뛰고, 권한 요청은 캘린더 고르기 화면만 한다.
 * - 실패해도 화면에 알리지 않지만 결과를 기록하고 개발 로그로 남긴다. 다음에 앱이 앞으로 올 때 다시 시도한다.
 */
export function createEventSync({
  source = defaultCalendarSource,
  fetchSelection = fetchCalendarSelectionState,
  saveSelection = (ids, revision, signal) => saveCalendarSelection(ids, revision, signal, 'device'),
  send = putEvents,
  fetchReceivedAt = fetchEventsReceivedAt,
  exceptions = appTravelExceptions,
  filtered: filteredSink = appFilteredEvents,
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = () => new Date(),
  log = devLog,
}: EventSyncOptions = {}): EventSync {
  let running: Promise<SyncResult> | null = null;
  let again = false;
  let current: AbortController | null = null;
  let lastSent: { key: string; at: number } | null = null;
  let remembered: string[] | null = null;
  let last: SyncResult | null = null;
  const revisions = createRevisionClock();

  const clearFiltered = () => filteredSink.set([]);

  const fail = (stage: string, error: unknown): SyncResult => {
    const detail = error instanceof HttpError ? `HTTP ${error.status}` : error instanceof Error ? error.name : 'error';
    log(`[calendar-sync] ${stage} 실패: ${detail}`);
    return 'failed';
  };

  const once = async (): Promise<SyncResult> => {
    if (source.kind === 'mock') return 'mock';
    const controller = new AbortController();
    current = controller;
    // stop()이나 더 새로운 요청이 이 요청을 밀어냈는가. 시간 제한으로 abort된 것은 '실패'이지 취소가 아니다.
    const cancelled = () => current !== controller;
    try {
      let state = await requestWithTimeout(fetchSelection, timeoutMs, controller);
      if (cancelled()) return 'cancelled';
      // 서버가 선택을 잃었다면 일정도 잃었다(둘 다 메모리). 선택을 다시 저장한 이번에는 같은 내용 생략을 건너뛴다.
      let serverLostState = false;
      if (state.selectedIds === null && remembered !== null) {
        serverLostState = true;
        const ids = remembered;
        await requestWithTimeout((signal) => saveSelection(ids, revisions(), signal), timeoutMs, controller);
        if (cancelled()) return 'cancelled';
        state = { selectedIds: ids, source: 'device' };
      }
      if (state.source !== 'device' || state.selectedIds === null || state.selectedIds.length === 0) {
        clearFiltered();
        return 'no-selection';
      }
      const selectedIds = state.selectedIds;
      let events: DeviceEvent[];
      try {
        events = await requestWithTimeout(() => source.listEvents(selectedIds, now()), timeoutMs, controller);
      } catch (e) {
        if (cancelled()) return 'cancelled';
        clearFiltered();
        return e instanceof CalendarPermissionError ? 'permission-denied' : fail('캘린더 읽기', e);
      }
      if (cancelled()) return 'cancelled';
      try {
        // 이 요청의 controller와 따로 시간을 잰다(시간이 넘어도 이 요청을 취소하지 않고 이름 없이 이어 간다).
        await requestWithTimeout(() => exceptions.load(), timeoutMs);
      } catch {
        log('[calendar-sync] 이동 예외 목록 읽기 실패: 저장된 이름 없이 이어 갑니다');
      }
      if (cancelled()) return 'cancelled';
      const { toSend, filtered } = partitionEvents(events, exceptions.has);
      filteredSink.set(filtered);
      events = fitToBudget(toSend);
      const key = JSON.stringify(events);
      const startedAt = now().getTime();
      if (!serverLostState && lastSent && lastSent.key === key && startedAt - lastSent.at < RESEND_UNCHANGED_AFTER_MS) {
        // 내용이 같아도 서버가 폰 일정을 받은 적이 없으면(재시작·초기화) 다시 보낸다. 확인하지 못하면 보내는 쪽을 택한다.
        let received: string | null = null;
        try {
          received = await requestWithTimeout((signal) => fetchReceivedAt(signal), timeoutMs, controller);
        } catch {
          if (cancelled()) return 'cancelled';
        }
        if (cancelled()) return 'cancelled';
        if (received !== null) return 'unchanged';
      }
      try {
        await requestWithTimeout((signal) => send(events, signal), timeoutMs, controller);
      } catch (e) {
        if (cancelled()) return 'cancelled';
        return fail('PUT /events', e);
      }
      // 응답이 돌아온 시점에도 이 요청이 현재 것일 때만 기록한다.
      if (cancelled()) return 'cancelled';
      lastSent = { key, at: startedAt };
      return 'sent';
    } catch (e) {
      return cancelled() ? 'cancelled' : fail('선택 조회', e);
    } finally {
      if (current === controller) current = null;
    }
  };

  const loop = async (): Promise<SyncResult> => {
    for (;;) {
      again = false;
      last = await once();
      if (!again) {
        // 판단과 해제를 같은 동기 구간에서 해야 그 사이에 들어온 호출이 사라지지 않는다.
        running = null;
        return last;
      }
    }
  };

  return {
    run() {
      if (running) {
        again = true;
        return running;
      }
      running = loop();
      return running;
    },
    stop() {
      again = false;
      current?.abort();
      current = null;
    },
    rememberSelection(selectedIds) {
      remembered = [...selectedIds];
    },
    lastResult: () => last,
  };
}

/** 앱 전체가 하나를 공유한다(앱 시작·앞으로 올 때·캘린더 선택 저장 뒤에서 같은 인스턴스로 부른다). */
export const appEventSync = createEventSync();
