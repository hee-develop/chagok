import { Hono, type Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import {
  MAX_ATTENDEES,
  MAX_ATTENDEE_NAME_LENGTH,
  MAX_EVENTS,
  MAX_EVENTS_BODY_BYTES,
  MAX_ID_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_TITLE_LENGTH,
} from '../limits.js';
import { openDenied, type SeatEnv, type SeatGuard } from '../seatScope.js';
import { DAY_MS, formatSeoulDate, parseAt, parseSeoulDate, seoulDay, seoulDayStart } from '../time.js';

/** 폰이 보낸 일정 한 건. 시각은 UTC 밀리초로 들고 있고, 응답에서 ISO8601로 바꾼다. */
export type PhoneEvent = {
  id: string;
  calendarId: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  locationText: string | null;
  notes: string | null;
  attendees: string[];
  /**
   * 폰에서 사용자가 "이동 일정이에요"로 바꾼 같은 이름 일정. true면 서버의 이동 없음 안전망(온라인·건물 안 판정)을 적용하지 않는다.
   * 없으면 false로 본다(안전망 적용).
   */
  travelConfirmed?: boolean;
};

export type SavedEvents = { receivedAt: string; events: PhoneEvent[] };

/** 저장한 일정이 차지하는 대략적인 크기(바이트). 서버 전체 용량 상한에 쓴다. */
export const eventsBytes = (events: PhoneEvent[]) => JSON.stringify(events).length;

/**
 * 폰이 보낸 오늘·내일(서울) 일정을 메모리에 둔다. 운전자 자리마다 저장소 하나(자리가 없으면 기본 자리).
 * 한 번이라도 받았으면 일정이 0건이어도 '폰 일정이 출처'로 본다(실제 사용자에게 목 일정이 보이면 안 되므로).
 * 날짜가 지나 끝난 일정은 읽을 때마다 지운다. 받은 시각(receivedAt)은 다음 PUT까지 남는다.
 */
export type EventsStore = {
  /** 받은 적이 없으면 null. 오늘(서울) 이전에 끝난 일정은 지우고 돌려준다. */
  get(): SavedEvents | null;
  /** 일정 전체를 바꾼다(오늘 0시 전에 끝난 일정은 이때도 버린다). */
  replace(events: PhoneEvent[]): SavedEvents;
  /** 개발·데모용 초기화: 받은 적 없는 상태로 되돌린다(기본 자리는 일정 출처가 픽스처로 복귀하고, 실제 자리는 '0건'이다). */
  clear(): void;
  /** 지금 저장한 일정의 대략적인 크기(바이트). 받은 적 없으면 0. */
  bytes(): number;
  /** 일정이 바뀌거나 비워질 때 새 일정 id 목록으로 부른다(일정별 보정 정리용). 구독 해제 함수를 돌려준다. */
  subscribe(listener: (ids: Set<string>) => void): () => void;
};

/** 포함 범위인 서울 오늘 0시 ~ 모레 0시(미포함). */
export const eventWindow = (now: Date) => {
  const today = seoulDay(now.getTime());
  return { start: seoulDayStart(today), end: seoulDayStart(today + 2) };
};

/** 구간 [start, end)와 겹치는 일정인가. 길이 0인 일정은 1ms로 본다. */
export const overlaps = (e: Pick<PhoneEvent, 'start' | 'end'>, start: number, end: number) =>
  e.start < end && Math.max(e.end, e.start + 1) > start;

export function createEventsStore(now: () => Date = () => new Date()): EventsStore {
  let saved: SavedEvents | null = null;
  let size = 0;
  const listeners = new Set<(ids: Set<string>) => void>();
  // 오늘 0시(서울) 전에 끝난 일정만 지운다. 모레 이후 일정은 PUT 때 이미 걸렀다.
  const alive = (events: PhoneEvent[]) => {
    const { start } = eventWindow(now());
    return events.filter((e) => overlaps(e, start, Number.POSITIVE_INFINITY));
  };
  const notify = () => {
    const ids = new Set((saved?.events ?? []).map((e) => e.id));
    for (const listener of listeners) listener(ids);
  };
  const store: EventsStore = {
    get: () => {
      if (saved === null) return null;
      const kept = alive(saved.events);
      if (kept.length !== saved.events.length) {
        saved = { ...saved, events: kept };
        size = eventsBytes(kept);
        notify();
      }
      return saved;
    },
    replace: (events) => {
      saved = { receivedAt: now().toISOString(), events: alive(events) };
      size = eventsBytes(saved.events);
      notify();
      return saved;
    },
    clear: () => {
      saved = null;
      size = 0;
      notify();
    },
    bytes: () => {
      store.get(); // 날짜가 지난 일정을 먼저 버린다
      return size;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** 요청 본문의 일정 한 건(시각은 ISO8601 문자열). 클라이언트(Hono RPC) 입력 타입이 된다. */
export type EventInput = Omit<PhoneEvent, 'start' | 'end'> & { start: string; end: string };

type Parsed = { ok: true; events: EventInput[] } | { ok: false; error: string };

function parseEvents(raw: unknown): Parsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '본문은 객체여야 합니다' };
  const list = (raw as { events?: unknown }).events;
  if (!Array.isArray(list)) return { ok: false, error: 'events는 배열이어야 합니다' };
  if (list.length > MAX_EVENTS) return { ok: false, error: `events는 ${MAX_EVENTS}개 이하여야 합니다` };
  const ids = new Set<string>();
  const events: EventInput[] = [];
  for (const item of list) {
    const e = item as Record<string, unknown> | null;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return { ok: false, error: 'events 항목은 객체여야 합니다' };
    if (typeof e.id !== 'string' || e.id === '' || e.id.length > MAX_ID_LENGTH) return { ok: false, error: `id는 1~${MAX_ID_LENGTH}자 문자열이어야 합니다` };
    if (ids.has(e.id)) return { ok: false, error: `id가 중복되었습니다: ${e.id}` };
    ids.add(e.id);
    if (typeof e.calendarId !== 'string' || e.calendarId === '' || e.calendarId.length > MAX_ID_LENGTH) {
      return { ok: false, error: `calendarId는 1~${MAX_ID_LENGTH}자 문자열이어야 합니다` };
    }
    if (!isString(e.title, MAX_TITLE_LENGTH)) return { ok: false, error: `title은 ${MAX_TITLE_LENGTH}자 이하 문자열이어야 합니다` };
    if (typeof e.allDay !== 'boolean') return { ok: false, error: 'allDay는 boolean이어야 합니다' };
    if (e.locationText !== null && !isString(e.locationText, MAX_LOCATION_LENGTH)) {
      return { ok: false, error: `locationText는 ${MAX_LOCATION_LENGTH}자 이하 문자열 또는 null이어야 합니다` };
    }
    if (e.notes !== null && !isString(e.notes, MAX_NOTES_LENGTH)) {
      return { ok: false, error: `notes는 ${MAX_NOTES_LENGTH}자 이하 문자열 또는 null이어야 합니다` };
    }
    if (
      !Array.isArray(e.attendees) ||
      e.attendees.length > MAX_ATTENDEES ||
      !e.attendees.every((a) => isString(a, MAX_ATTENDEE_NAME_LENGTH) && a.trim() !== '')
    ) {
      return { ok: false, error: `attendees는 이름 문자열(${MAX_ATTENDEE_NAME_LENGTH}자 이하) ${MAX_ATTENDEES}개 이하 배열이어야 합니다` };
    }
    if (e.travelConfirmed !== undefined && typeof e.travelConfirmed !== 'boolean') {
      return { ok: false, error: 'travelConfirmed는 boolean이어야 합니다' };
    }
    const start = typeof e.start === 'string' ? parseAt(e.start) : null;
    const end = typeof e.end === 'string' ? parseAt(e.end) : null;
    if (start === null || end === null) return { ok: false, error: 'start와 end는 오프셋이 있는 ISO8601 시각이어야 합니다' };
    if (end.getTime() < start.getTime()) return { ok: false, error: 'end는 start 이상이어야 합니다' };
    events.push({
      id: e.id,
      calendarId: e.calendarId,
      title: e.title,
      start: e.start as string,
      end: e.end as string,
      allDay: e.allDay,
      locationText: e.locationText as string | null,
      notes: e.notes as string | null,
      attendees: e.attendees as string[],
      ...(e.travelConfirmed === true ? { travelConfirmed: true } : {}),
    });
  }
  return { ok: true, events };
}

const toJson = (e: PhoneEvent) => ({
  id: e.id,
  calendarId: e.calendarId,
  title: e.title,
  start: new Date(e.start).toISOString(),
  end: new Date(e.end).toISOString(),
  allDay: e.allDay,
  locationText: e.locationText,
  notes: e.notes,
  attendees: e.attendees,
  ...(e.travelConfirmed === true ? { travelConfirmed: true as const } : {}),
});

/** 요청이 이 서버와 같은 기기(127.0.0.1·::1)에서 왔는가. node 서버가 아닌 환경(app.request 등)에서는 알 수 없어 false. */
export const isLoopbackRequest = (c: Context): boolean => {
  try {
    const address = getConnInfo(c).remote.address;
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  } catch {
    return false;
  }
};

export type EventsRouteOptions = {
  now?: () => Date;
  /** 같은 기기에서 온 요청인가(테스트에서 바꿀 수 있다). */
  isLoopback?: (c: Context) => boolean;
  /** true면 같은 기기가 아닌 곳의 /events 요청을 모두 403으로 막는다(HOST=0.0.0.0으로 열었을 때 일정 노출 방지). */
  loopbackOnly?: boolean;
  /** 연결된 자리(기본 자리·연결 전 버킷 제외)가 일정을 받았을 때 부른다(마지막으로 일정 받은 시각 갱신). */
  onReceived?: (seatId: string) => void;
};

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createEventsRoute = (
  guard: SeatGuard,
  { now = () => new Date(), isLoopback = isLoopbackRequest, loopbackOnly = false, onReceived }: EventsRouteOptions = {},
) =>
  new Hono<SeatEnv>()
    .use('*', async (c, next) => {
      if (loopbackOnly && !isLoopback(c)) return c.json({ error: '이 서버의 /events는 같은 기기에서만 쓸 수 있습니다' }, 403);
      await next();
    })
    .put(
      '/',
      guard.write,
      bodyLimit({
        maxSize: MAX_EVENTS_BODY_BYTES,
        onError: (c) => c.json({ error: `본문은 ${MAX_EVENTS_BODY_BYTES}바이트 이하여야 합니다` }, 413),
      }),
      validator('json', (value, c) => {
        const parsed = parseEvents(value);
        if (!parsed.ok) return c.json({ error: parsed.error }, 400);
        return { events: parsed.events };
      }),
      (c) => {
        const events: PhoneEvent[] = c.req.valid('json').events.map((e) => ({ ...e, start: Date.parse(e.start), end: Date.parse(e.end) }));
        // 오늘·내일(서울)에 걸치지 않는 일정은 저장하지 않는다.
        const { start, end } = eventWindow(now());
        const inWindow = events.filter((e) => overlaps(e, start, end)).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
        const { kind, seatId } = c.var.seat;
        // 연결 전 버킷은 본문 검증을 통과한 여기서 비로소 만들어진다(요청 주소별 속도 제한).
        const opened = c.var.seat.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        // 일정 저장 용량에는 예산이 있다(연결된 자리와 연결 전 버킷은 따로, 버킷 하나의 상한도 있다: 자리·버킷을 많이 만들어 메모리를 채우는 것을 막는다).
        if (!opened.reserveEvents(eventsBytes(inWindow))) return c.json({ error: '서버 저장 공간이 가득 찼어요. 잠시 뒤 다시 해 주세요', reason: 'capacity' as const }, 429);
        const saved = opened.data.events.replace(inWindow);
        if (kind === 'seat') onReceived?.(seatId);
        return c.json({ receivedAt: saved.receivedAt, stored: inWindow.length, dropped: events.length - inWindow.length }, 200);
      },
    )
    .get(
      '/',
      guard.read,
      validator('query', (value: { date?: string | string[] }, c) => {
        if (value.date === undefined) return { date: undefined as string | undefined };
        if (typeof value.date !== 'string' || parseSeoulDate(value.date) === null) {
          return c.json({ error: 'date는 YYYY-MM-DD 형식의 날짜여야 합니다' }, 400);
        }
        return { date: value.date as string | undefined };
      }),
      (c) => {
        const query = c.req.valid('query').date;
        const day = query === undefined ? seoulDay(now().getTime()) : (parseSeoulDate(query) as number);
        const saved = c.var.seat.data.events.get();
        const from = seoulDayStart(day);
        const events = (saved?.events ?? []).filter((e) => overlaps(e, from, from + DAY_MS));
        return c.json({ date: formatSeoulDate(day), receivedAt: saved?.receivedAt ?? (null as string | null), events: events.map(toJson) }, 200);
      },
    )
    // 개발·데모 전용: 폰이 보낸 일정을 지워 받은 적 없는 상태로 되돌린다(기본 자리는 /schedules/today·places가 픽스처로 복귀, 실제 자리는 0건). 같은 기기 요청만 받는다.
    // 폰 토큰이 있으면 그 자리만, 기기 id만 있으면 그 연결 전 버킷만, 식별이 없으면 기본 자리와 옛 차 앱이 보는 자리를 비운다.
    .delete('/', (c) => {
      if (!isLoopback(c)) return c.json({ error: '같은 기기에서만 초기화할 수 있습니다' }, 403);
      const write = guard.resolveWrite(c);
      if (write instanceof Response) return write;
      const read = guard.resolveRead(c);
      if (read instanceof Response) return read;
      for (const scope of new Map([[write.seatId, write], [read.seatId, read]]).values()) scope.data.events.clear();
      return c.json({ receivedAt: null as string | null }, 200);
    });
