import type { ScheduledJob, Scheduler } from './scheduler.js';
import type { SeatDataRegistry } from './seatData.js';
import type { SeatStore } from './seats.js';
import { DAY_MS, MINUTE_MS, seoulDay, seoulDayStart } from './time.js';

/**
 * 정기 정리 작업(정책서 11장 '서버 정기 작업', 10.9 '앱만 지운 경우'). 알림 작업(`notify/eventsStale.ts`)과 같은 스케줄러(`scheduler.ts`)에 등록해 쓰고,
 * 판정은 모두 주입한 시계(`now`)로 한다. 작업은 반복해서 불려도 안전하다.
 *
 * - `purge-expired`(매일 새벽): 모든 자리·연결 전 버킷의 날짜 지난 일정과 그에 딸린 보정·채비·가족 요청(`SeatData.family`)을 지우고, 낡은 도착 일정 id 기억(`SeatData.arrivals`)과
 *   만료된 코드·시도 기록·자리 없는 옛 차·낡은 버킷을 비운다.
 *   (날짜 지난 일정은 읽을 때·교체할 때도 지워지므로 이 작업은 아무도 읽지 않는 자리의 메모리를 비우는 것이다. 가족 요청 묶음(J10a)의 별도 저장소는 그 묶음이 같은 스케줄러에 더한다.)
 * - `prune-silent-seats`(매일 새벽): 30일 동안 일정이 안 온 자리를 지운다. 한 번에 지울 자리가 너무 많으면(서버 시계 이상 의심) 그 실행은 건너뛰고 경고를 남긴다.
 *
 * 서버 시계가 뒤로 가면: 지우는 기준이 모두 `now`와의 차라 이미 지운 것을 되살리지 않고 더 적게 지운다. `dailyAtDawn`은 서울 날짜 번호가 같은 날에는 다시 돌지 않고,
 * 이전 날짜로 돌아가면 그 날짜는 아직 돌지 않은 날로 보아 한 번 돈다(작업은 반복해도 안전해야 한다). 시계가 앞으로 크게 가는 쪽이 위험해서 자리 정리에만 안전장치를 둔다.
 */

/** 새벽 정리를 시작하는 서울 시각(시). 이 시각 이후 하루 한 번(가안: 정책서는 '새벽'이라고만 한다). */
export const DAWN_HOUR = 4;
/** 일정이 이만큼 오지 않은 자리를 지운다(정책서 12장 '무소식 자리 정리' 30일, 가안). */
export const SILENT_SEAT_AFTER_MS = 30 * DAY_MS;

/** 한 번의 실행에서 지울 자리가 전체의 이 비율을 **넘고**(초과) 전체 자리가 `SILENT_PRUNE_GUARD_MIN_SEATS` 이상이면 시계 이상으로 보고 건너뛴다(가안). */
export const SILENT_PRUNE_MAX_RATIO = 0.5;
/** 위 안전장치를 적용하는 최소 자리 수(가안). 자리가 이보다 적으면 모두 무소식이어도 지운다(실제로 쓰지 않는 서버를 비울 수 있게). */
export const SILENT_PRUNE_GUARD_MIN_SEATS = 4;

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
 * **안전장치**: 지울 자리가 전체의 절반을 넘고(`SILENT_PRUNE_MAX_RATIO`) 전체가 `SILENT_PRUNE_GUARD_MIN_SEATS` 이상이면 서버 시계가 갑자기 앞으로 간 것으로 보고
 * 아무것도 지우지 않은 채 `warn`에 한 줄만 남긴다(자리 내용·id는 남기지 않는다). 폰이 다시 일정을 보내 비율이 내려가면 다음 날 실행에서 지워진다.
 * 지운 자리 id를 돌려준다.
 */
export function pruneSilentSeats({
  seats,
  now,
  afterMs = SILENT_SEAT_AFTER_MS,
  warn = (message) => console.warn(message),
}: {
  seats: Pick<SeatStore, 'allSeats' | 'removeSeat'>;
  now: Date;
  afterMs?: number;
  warn?: (message: string) => void;
}): string[] {
  const at = now.getTime();
  const all = seats.allSeats();
  const silent = all.filter((seat) => {
    const basis = Math.max(Date.parse(seat.pairedAt), seat.lastEventsAt === null ? 0 : Date.parse(seat.lastEventsAt));
    return at - basis >= afterMs;
  });
  if (silent.length > all.length * SILENT_PRUNE_MAX_RATIO && all.length >= SILENT_PRUNE_GUARD_MIN_SEATS) {
    warn(`정기 정리 건너뜀: 30일 무소식 자리가 ${silent.length}/${all.length}개로 한 번에 너무 많아 서버 시계 이상으로 보고 이번에는 지우지 않았습니다.`);
    return [];
  }
  const removed: string[] = [];
  for (const seat of silent) if (seats.removeSeat(seat.seatId)) removed.push(seat.seatId);
  return removed;
}

export type MaintenanceOptions = {
  scheduler: Pick<Scheduler, 'register'>;
  seats: SeatStore;
  /** 자리 데이터 저장소. `createApp({ seatData })`에 넘긴 것과 같아야 한다. */
  registry: SeatDataRegistry;
  /** 지운 개수만 알린다(일정·자리 내용은 로그에 남기지 않는다). */
  log?: (message: string) => void;
  /** 안전장치로 건너뛸 때의 경고. 기본은 console.warn. */
  warn?: (message: string) => void;
};

/** 정기 정리 작업을 스케줄러에 등록한다(서버 시작 코드가 한 번 부른다). */
export function registerMaintenanceJobs({ scheduler, seats, registry, log = (message) => console.log(message), warn }: MaintenanceOptions): void {
  scheduler.register(
    dailyAtDawn('purge-expired', () => {
      const { eventsRemoved, bucketsDropped, familyRequestsRemoved, arrivalKeysForgotten } = registry.purgeExpired();
      seats.purgeExpired();
      if (eventsRemoved > 0 || bucketsDropped > 0 || familyRequestsRemoved > 0 || arrivalKeysForgotten > 0) {
        log(`정기 정리: 지난 일정 ${eventsRemoved}건, 가족 요청 ${familyRequestsRemoved}건, 도착 일정 기억 ${arrivalKeysForgotten}건, 오래된 연결 전 버킷 ${bucketsDropped}개를 지웠습니다.`);
      }
    }),
  );
  scheduler.register(
    dailyAtDawn('prune-silent-seats', (at) => {
      const removed = pruneSilentSeats({ seats, now: at, ...(warn ? { warn } : {}) });
      if (removed.length > 0) log(`정기 정리: 30일 동안 일정이 오지 않은 자리 ${removed.length}개를 지웠습니다.`);
    }),
  );
}
