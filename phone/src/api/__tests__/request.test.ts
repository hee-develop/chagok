import { createRevisionClock, HttpError, isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout, whenAborted } from '../request';

describe('requestWithTimeout', () => {
  it('끝나면 결과를 돌려주고 signal을 넘긴다', async () => {
    let received: AbortSignal | undefined;
    await expect(
      requestWithTimeout(async (signal) => {
        received = signal;
        return 7;
      }),
    ).resolves.toBe(7);
    expect(received?.aborted).toBe(false);
  });

  it('시간 안에 끝나지 않으면 signal을 abort하고 reject한다(요청이 signal을 무시해도)', async () => {
    let received: AbortSignal | undefined;
    await expect(
      requestWithTimeout(
        (signal) => {
          received = signal;
          return new Promise(() => {});
        },
        30,
      ),
    ).rejects.toThrow('aborted');
    expect(received?.aborted).toBe(true);
  });

  it('호출한 쪽이 넘긴 controller로 취소할 수 있다', async () => {
    const controller = new AbortController();
    const pending = requestWithTimeout(() => new Promise(() => {}), 10_000, controller);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('요청이 던진 오류를 그대로 전달한다', async () => {
    await expect(requestWithTimeout(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('시간 제한 기본값은 10초다', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  });
});

describe('whenAborted', () => {
  it('이미 abort된 signal이면 바로 reject한다', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(whenAborted(controller.signal)).rejects.toThrow('aborted');
  });
});

describe('createRevisionClock', () => {
  it('항상 이전보다 큰 안전 정수를 돌려준다', () => {
    const times = [1000, 1000, 900];
    const next = createRevisionClock(() => times.shift() as number);
    const [a, b, c] = [next(), next(), next()];
    expect(a).toBe(1_000_000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('현재 시각 기준 값은 안전 정수 범위 안이다', () => {
    expect(Number.isSafeInteger(createRevisionClock()())).toBe(true);
  });
});

describe('isClientError', () => {
  it('4xx HttpError만 true다', () => {
    expect(isClientError(new HttpError(400, 'x'))).toBe(true);
    expect(isClientError(new HttpError(404, 'x'))).toBe(true);
    expect(isClientError(new HttpError(499, 'x'))).toBe(true);
    expect(isClientError(new HttpError(500, 'x'))).toBe(false);
    expect(isClientError(new HttpError(503, 'x'))).toBe(false);
    expect(isClientError(new Error('network'))).toBe(false);
    expect(isClientError(new Error('aborted'))).toBe(false);
    expect(isClientError(undefined)).toBe(false);
  });
});
