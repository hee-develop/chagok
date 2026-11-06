export const REQUEST_TIMEOUT_MS = 10_000;

/** signal이 abort되면 reject하는 Promise. 요청 구현이 signal을 무시해도 시간 제한이 걸리도록 경쟁시킨다. */
export function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/** 서버가 ok가 아닌 응답을 돌려줬을 때 던진다. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/** 4xx 응답이면 같은 요청을 다시 보내도 같은 결과이므로 재전송 대상이 아니다. 네트워크 오류·5xx·시간 초과는 아니다. */
export const isClientError = (error: unknown): boolean => error instanceof HttpError && error.status >= 400 && error.status < 500;

/** 호출할 때마다 이전보다 큰 정수를 돌려준다. 밀리초 시각에 1000을 곱한 값 위에서 같은 시각 안의 호출은 1씩 올린다. */
export function createRevisionClock(now: () => number = Date.now): () => number {
  let last = 0;
  return () => {
    last = Math.max(last + 1, now() * 1000);
    return last;
  };
}

/**
 * run에 signal을 넘겨 실행하고, timeoutMs 안에 끝나지 않거나 controller가 abort되면 reject한다.
 * controller를 넘기면 호출한 쪽이 직접 취소할 수 있다.
 */
export async function requestWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  controller: AbortController = new AbortController(),
): Promise<T> {
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([run(controller.signal), whenAborted(controller.signal)]);
  } finally {
    clearTimeout(timer);
  }
}
