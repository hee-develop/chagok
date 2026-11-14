/**
 * 서버 정기 작업을 도는 작은 스케줄러(정책서 11장). `setInterval` 하나가 주기마다 등록된 작업을 차례로 부른다.
 * 작업은 지금 시각(`now`)을 받아 스스로 '이번에 할 일인가'를 판정하고(예: 서울 20시 창, 새벽, 30일) 반복해서 불려도 안전해야 한다.
 * 알림 '일정을 못 받고 있어요'(`notify/eventsStale.ts`)가 첫 작업이고, 지난 일정 삭제·자리 정리 같은 다른 정기 작업은 `register`로 더한다.
 * 시작은 서버 프로세스(`index.ts`)가 한다. `createApp`은 타이머를 켜지 않으므로 테스트에서는 꺼져 있다.
 */
export type ScheduledJob = {
  name: string;
  run: (now: Date) => void | Promise<void>;
};

export type SchedulerOptions = {
  now?: () => Date;
  /** 판정 주기(밀리초). 기본 5분. */
  intervalMs?: number;
  /** 작업이 던질 때 알리는 곳. 한 작업이 던져도 다른 작업은 계속 돈다. 기본은 console.error(이름과 오류 이름만). */
  onError?: (jobName: string, error: unknown) => void;
};

export type Scheduler = {
  /** 작업을 더한다(같은 이름은 바꾼다). */
  register(job: ScheduledJob): void;
  jobNames(): string[];
  /** 지금 모든 작업을 한 번 차례로 돈다(주기 타이머와 테스트가 쓴다). 이미 도는 중이면 그 실행을 기다린다. */
  tick(): Promise<void>;
  /** 주기 타이머를 켠다. 이미 켜져 있으면 아무것도 하지 않는다. 프로세스 종료를 막지 않는다(unref). */
  start(): void;
  stop(): void;
  running(): boolean;
};

export const DEFAULT_SCHEDULER_INTERVAL_MS = 5 * 60_000;

export function createScheduler({
  now = () => new Date(),
  intervalMs = DEFAULT_SCHEDULER_INTERVAL_MS,
  onError = (name, error) => console.error(`정기 작업 ${name} 실패: ${error instanceof Error ? error.name : 'error'}`),
}: SchedulerOptions = {}): Scheduler {
  const jobs = new Map<string, ScheduledJob>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  const runAll = async () => {
    for (const job of [...jobs.values()]) {
      try {
        await job.run(now());
      } catch (e) {
        try {
          onError(job.name, e);
        } catch {
          // 오류 보고가 던져도 다음 작업은 돈다.
        }
      }
    }
  };

  const tick = () => {
    inFlight ??= runAll().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    register: (job) => {
      jobs.set(job.name, job);
    },
    jobNames: () => [...jobs.keys()],
    tick,
    start: () => {
      if (timer !== null) return;
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    running: () => timer !== null,
  };
}
