import type { ScheduledJob, Scheduler } from './scheduler.js';
import type { SeatDataRegistry } from './seatData.js';
import type { SeatStore } from './seats.js';
import { DAY_MS, MINUTE_MS, seoulDay, seoulDayStart } from './time.js';

/**
 * 정기 정리 작업(정책서 11장 '서버 정기 작업', 10.9 '앱만 지운 경우'). 알림 작업(`notify/eventsStale.ts`)과 같은 스케줄러(`scheduler.ts`)에 등록해 쓰고,
 * 판정은 모두 주입한 시계(`now`)로 한다. 작업은 반복해서 불려도 안전하다.
 *
 * - `purge-expired`(매일 새벽): 모든 자리·연결 전 버킷의 날짜 지난 일정과 그에 딸린 보정·채비를 지우고, 만료된 코드·시도 기록·자리 없는 옛 차·낡은 버킷을 비운다.
 *   (날짜 지난 일정은 읽을 때·교체할 때도 지워지므로 이 작업은 아무도 읽지 않는 자리의 메모리를 비우는 것이다. 가족 요청 삭제는 가족 요청 묶음이 같은 스케줄러에 더한다.)
 * - `prune-silent-seats`(매일 새벽): 30일 동안 일정이 안 온 자리를 지운다.
 */

/** 새벽 정리를 시작하는 서울 시각(시). 이 시각 이후 하루 한 번(가안: 정책서는 '새벽'이라고만 한다). */
export const DAWN_HOUR = 4;
/** 일정이 이만큼 오지 않은 자리를 지운다(정책서 12장 '무소식 자리 정리' 30일, 가안). */
export const SILENT_SEAT_AFTER_MS = 30 * DAY_MS;

const HOUR_MS = 60 * MINUTE_MS;

/** 서울 시각으로 그날 0시부터 지난 밀리초. */
const seoulTimeOfDay = (at: Date) => at.getTime() - seoulDayStart(seoulDay(at.getTime()));

/** 이 시각이 서울 새벽 정리를 시작해도 되는 때(그날 04:00 이후)인가. */
export const afterDawn = (at: Date) => seoulTimeOfDay(at) >= DAWN_HOUR * HOUR_MS;

/**
 * 서울 날짜마다 04:00 이후 처음 불릴 때 한 번만 `run`을 돈다. 04:00에 서버가 꺼져 있었어도 켜진 뒤 첫 판정에서 따라잡고,
 * `run`이 던지면 다음 판정에서 다시 시도한다(그날 끝난 것으로 치지 않는다).
 */
export function dailyAtDawn(name: string, run: (at: Date) => void): ScheduledJob {
  let doneDay: number | null = null;
  return {
    name,
    run: (at) => {
      const day = seoulDay(at.getTime());
      if (doneDay === day || !afterDawn(at)) return;
      run(at);
      doneDay = day;
    },
  };
}

/**
 * 일정이 마지막으로 온 지 `afterMs` 이상 지난 자리를 지운다. 기준 시각은 마지막 일정 수신, 한 번도 받지 못했거나 폰을 바꾼 직후면 연결 시각이다
 * (`runEventsStaleCheck`와 같은 기준). 자리 삭제는 연결 끊기와 같은 경로(`SeatStore.removeSeat`)라 그 자리의 연결·일정·기억·알림이 모두 지워진다.
 * 지운 자리 id를 돌려준다.
 */
export function pruneSilentSeats({ seats, now, afterMs = SILENT_SEAT_AFTER_MS }: { seats: Pick<SeatStore, 'allSeats' | 'removeSeat'>; now: Date; afterMs?: number }): string[] {
  const at = now.getTime();
  const removed: string[] = [];
  for (const seat of seats.allSeats()) {
    const basis = Math.max(Date.parse(seat.pairedAt), seat.lastEventsAt === null ? 0 : Date.parse(seat.lastEventsAt));
    if (!(at - basis >= afterMs)) continue;
    if (seats.removeSeat(seat.seatId)) removed.push(seat.seatId);
  }
  return removed;
}

export type MaintenanceOptions = {
  scheduler: Pick<Scheduler, 'register'>;
  seats: SeatStore;
  /** 자리 데이터 저장소. `createApp({ seatData })`에 넘긴 것과 같아야 한다. */
  registry: SeatDataRegistry;
  /** 지운 개수만 알린다(일정·자리 내용은 로그에 남기지 않는다). */
  log?: (message: string) => void;
};

/** 정기 정리 작업을 스케줄러에 등록한다(서버 시작 코드가 한 번 부른다). */
export function registerMaintenanceJobs({ scheduler, seats, registry, log = (message) => console.log(message) }: MaintenanceOptions): void {
  scheduler.register(
    dailyAtDawn('purge-expired', () => {
      const { eventsRemoved, bucketsDropped } = registry.purgeExpired();
      seats.purgeExpired();
      if (eventsRemoved > 0 || bucketsDropped > 0) log(`정기 정리: 지난 일정 ${eventsRemoved}건, 오래된 연결 전 버킷 ${bucketsDropped}개를 지웠습니다.`);
    }),
  );
  scheduler.register(
    dailyAtDawn('prune-silent-seats', (at) => {
      const removed = pruneSilentSeats({ seats, now: at });
      if (removed.length > 0) log(`정기 정리: 30일 동안 일정이 오지 않은 자리 ${removed.length}개를 지웠습니다.`);
    }),
  );
}
