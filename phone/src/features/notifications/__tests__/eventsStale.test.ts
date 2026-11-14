import { deferred, fakeSync } from '../../../__tests__/support/notifications';
import { settleEventsStale, staleOutcomeOf } from '../eventsStale';

describe('staleOutcomeOf', () => {
  it('보냄·변화 없음은 해결, 권한·선택·목은 보낼 수 없음, 나머지는 모름', () => {
    expect(['sent', 'unchanged'].map((r) => staleOutcomeOf(r as never))).toEqual(['resolved', 'resolved']);
    expect(['permission-denied', 'no-selection', 'mock'].map((r) => staleOutcomeOf(r as never))).toEqual(['blocked', 'blocked', 'blocked']);
    expect(['failed', 'cancelled', null].map((r) => staleOutcomeOf(r as never))).toEqual(['unknown', 'unknown', 'unknown']);
  });
});

describe('settleEventsStale', () => {
  afterEach(() => jest.useRealTimers());

  it('도는 중인 실행이 있으면 그 결과를 쓰고 새로 돌리지 않는다', async () => {
    const running = deferred<'sent'>();
    const { sync, run } = fakeSync('failed', running.promise);
    const settled = settleEventsStale(sync, 1000);
    running.resolve('sent');
    expect(await settled).toBe('resolved');
    expect(run).not.toHaveBeenCalled();
  });

  it('도는 실행이 없으면 한 번 돌린다', async () => {
    const { sync, run } = fakeSync('permission-denied');
    expect(await settleEventsStale(sync, 1000)).toBe('blocked');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('시간 안에 끝나지 않거나 던지면 unknown이다', async () => {
    jest.useFakeTimers();
    const hang = fakeSync('sent', new Promise(() => undefined));
    const settled = settleEventsStale(hang.sync, 1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await settled).toBe('unknown');
    const boom = fakeSync();
    boom.run.mockRejectedValueOnce(new Error('x'));
    expect(await settleEventsStale(boom.sync, 1000)).toBe('unknown');
  });
});
