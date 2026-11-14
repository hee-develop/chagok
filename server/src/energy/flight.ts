/**
 * 같은 키의 외부 호출을 하나로 합치고(`joinFlight`), 서버 전체 동시 호출 수를 제한하는(`createGate`) 작은 도구.
 * 호출을 기다리는 쪽의 `AbortSignal`이 모두 중단되면 실제 호출도 중단한다.
 */

export const abortError = () => new Error('조회가 취소되었습니다');

/** promise를 기다리되 signal이 중단되면 먼저 실패한다(promise 자체는 멈추지 않는다). */
export function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export type Flight<T> = { promise: Promise<T>; controller: AbortController; waiters: number };

/**
 * `flights`에 같은 key로 진행 중인 호출이 있으면 거기에 붙고, 없으면 `start`로 새로 시작한다.
 * 붙은 호출자가 전부 signal로 떠나면 `start`에 준 signal을 중단해 실제 호출을 멈춘다.
 */
export function joinFlight<T>(flights: Map<string, Flight<T>>, key: string, start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const created: Flight<T> = { promise: start(controller.signal), controller, waiters: 0 };
    const forget = () => {
      if (flights.get(key) === created) flights.delete(key);
    };
    created.promise.then(forget, forget);
    flights.set(key, created);
    flight = created;
  }
  const joined = flight;
  joined.waiters += 1;
  return new Promise<T>((resolve, reject) => {
    let left = false;
    const leave = () => {
      if (left) return false;
      left = true;
      signal?.removeEventListener('abort', onAbort);
      joined.waiters -= 1;
      return true;
    };
    const onAbort = () => {
      if (!leave()) return;
      reject(abortError());
      if (joined.waiters === 0) {
        if (flights.get(key) === joined) flights.delete(key);
        joined.controller.abort();
      }
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    joined.promise.then(
      (v) => leave() && resolve(v),
      (e) => leave() && reject(e),
    );
  });
}

/** 동시에 limit개까지만 실행하고, 그 위로 maxQueue개까지만 기다리게 한다(넘으면 바로 실패). */
export function createGate(limit: number, maxQueue: number) {
  let active = 0;
  const queue: { start: () => void; cancel: () => void }[] = [];
  const next = () => {
    while (active < limit && queue.length > 0) queue.shift()!.start();
  };
  return {
    run<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise<T>((resolve, reject) => {
        const go = () => {
          signal?.removeEventListener('abort', onAbort);
          active += 1;
          fn().then(resolve, reject).finally(() => {
            active -= 1;
            next();
          });
        };
        const entry = { start: go, cancel: () => reject(abortError()) };
        const onAbort = () => {
          const i = queue.indexOf(entry);
          if (i >= 0) {
            queue.splice(i, 1);
            entry.cancel();
          }
        };
        if (active < limit) return go();
        if (queue.length >= maxQueue) return reject(new Error('외부 조회 대기열이 가득 찼습니다'));
        queue.push(entry);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
  };
}
