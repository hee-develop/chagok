import type { SeatStore } from '../seats.js';
import { DAY_MS, formatSeoulDate, MINUTE_MS, seoulDay } from '../time.js';
import type { Notifier } from './notifier.js';

/** 마지막으로 일정을 받은 지 이만큼 지나야 '못 받고 있어요'(정책서 12장 기준값, 가안). */
export const EVENTS_STALE_AFTER_MS = 24 * 60 * MINUTE_MS;
/** 알림을 넣는 서울 시각: 저녁 8시(정책서 12장 기준값, 가안). */
export const EVENTS_STALE_HOUR = 20;
/**
 * 8시 정각에 서버가 꺼져 있었어도 놓치지 않도록, 8시부터 이 시간 안에 처음 판정하는 때까지 보낸다(하루 한 번).
 * 밤늦게(자정 직전) 울리지 않게 창을 닫아 둔다.
 */
export const EVENTS_STALE_WINDOW_MS = 2 * 60 * MINUTE_MS;

export const EVENTS_STALE_TITLE = '차곡이 일정을 못 받고 있어요';
export const EVENTS_STALE_BODY = '앱을 열면 일정을 새로 보내요.';

/** 서울 시각으로 오늘 0시부터 지난 밀리초. */
const seoulTimeOfDay = (ms: number) => (((ms + 9 * 60 * MINUTE_MS) % DAY_MS) + DAY_MS) % DAY_MS;

/** 이 시각이 알림을 넣는 창(서울 20:00 이상, 22:00 미만)인가. */
export const inEventsStaleWindow = (at: Date) => {
  const t = seoulTimeOfDay(at.getTime());
  return t >= EVENTS_STALE_HOUR * 60 * MINUTE_MS && t < EVENTS_STALE_HOUR * 60 * MINUTE_MS + EVENTS_STALE_WINDOW_MS;
};

/**
 * '일정을 못 받고 있어요' 판정: 서울 저녁 8시 창 안에서, 마지막으로 일정을 받은 지 24시간 **이상** 지난 자리에 하루 한 번 알림을 넣는다.
 * 기준 시각은 마지막 일정 수신, 한 번도 못 받았거나 폰을 바꾼 직후면 연결 시각(새로 연결한 폰에 곧바로 울리지 않게)이다.
 * 하루 한 번은 중복 억제 키(`events-stale:<서울 날짜>`)가 막고, 일정을 다시 받으면 기준 시각이 바뀌어 멈춘다.
 * 주기 작업이 자주 불러도 되도록 상태를 바꾸는 것은 알림 만들기뿐이다. 알림을 넣은 자리 id를 돌려준다.
 */
export function runEventsStaleCheck({ seats, notifier, now }: { seats: Pick<SeatStore, 'allSeats'>; notifier: Notifier; now: Date }): string[] {
  if (!inEventsStaleWindow(now)) return [];
  const at = now.getTime();
  const day = formatSeoulDate(seoulDay(at));
  const notified: string[] = [];
  for (const seat of seats.allSeats()) {
    const basis = Math.max(Date.parse(seat.pairedAt), seat.lastEventsAt === null ? 0 : Date.parse(seat.lastEventsAt));
    if (!(at - basis >= EVENTS_STALE_AFTER_MS)) continue;
    const result = notifier.notify(seat.seatId, {
      kind: 'events-stale',
      title: EVENTS_STALE_TITLE,
      body: EVENTS_STALE_BODY,
      data: { action: 'resend-events' },
      dedupeKey: `events-stale:${day}`,
    });
    if (result.ok) notified.push(seat.seatId);
  }
  return notified;
}
