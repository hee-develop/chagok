import { HttpError } from '../../../api/request';
import { createInbox } from '../inbox';
import { createMemoryStorage } from '../keyValue';
import type { NotificationsApi } from '../notificationsApi';
import { createNotificationPoller } from '../poller';
import { deferred, fakeNotifier, idsOf, note } from '../testSupport';

const setup = (over: { permission?: 'granted' | 'denied' | 'undetermined'; session?: boolean; list?: ReturnType<typeof note>[] } = {}) => {
  const inbox = createInbox({ storage: createMemoryStorage() });
  const { notifier, present, state } = fakeNotifier(over.permission ?? 'granted');
  const fetchNew = jest.fn<ReturnType<NotificationsApi['fetchNew']>, Parameters<NotificationsApi['fetchNew']>>().mockResolvedValue(over.list ?? []);
  const ack = jest.fn<ReturnType<NotificationsApi['ack']>, Parameters<NotificationsApi['ack']>>().mockResolvedValue(undefined);
  const log = jest.fn();
  const poller = createNotificationPoller({ api: { fetchNew, ack }, inbox, notifier, hasSession: async () => over.session ?? true, timeoutMs: 1000, log });
  return { poller, inbox, fetchNew, ack, present, state, log };
};

describe('createNotificationPoller', () => {
  afterEach(() => jest.useRealTimers());

  it('새 알림을 알림함에 담고, 권한이 있으면 시스템 알림으로 띄우고, 읽어 간 알림을 ack한다', async () => {
    const { poller, inbox, present, ack, fetchNew } = setup({ list: [note('10'), note('20')] });
    expect(await poller.poll()).toBe('ok');
    expect(fetchNew).toHaveBeenCalledWith(null, expect.any(AbortSignal));
    expect(idsOf(inbox)).toEqual(['20', '10']);
    expect(present.mock.calls.map(([item]) => item.id)).toEqual(['10', '20']);
    expect(present.mock.calls[0]?.[0]).toMatchObject({ kind: 'events-stale', title: '제목 10', data: { action: 'resend-events' } });
    expect(ack).toHaveBeenCalledWith(['10', '20'], expect.any(AbortSignal));
  });

  it('새 알림만 띄운다: 다음 폴링은 since=마지막 id로 묻고, 같은 알림이 다시 오면 다시 띄우지 않는다', async () => {
    const { poller, fetchNew, present, ack } = setup({ list: [note('10')] });
    await poller.poll();
    fetchNew.mockResolvedValueOnce([note('10'), note('20')]); // ack이 실패했던 것처럼 10이 다시 온다
    await poller.poll();
    expect(fetchNew.mock.calls[1]?.[0]).toBe('10');
    expect(present.mock.calls.map(([item]) => item.id)).toEqual(['10', '20']);
    fetchNew.mockResolvedValueOnce([]);
    await poller.poll();
    expect(present).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(2); // 빈 목록은 ack하지 않는다
  });

  it('동시에 하나만 돈다: 도는 중에 다시 불리면 같은 실행의 결과를 받고 요청을 하나 더 보내지 않는다', async () => {
    const { poller, fetchNew } = setup();
    const gate = deferred<ReturnType<typeof note>[]>();
    fetchNew.mockReturnValueOnce(gate.promise);
    const first = poller.poll();
    const second = poller.poll();
    await Promise.resolve();
    gate.resolve([]);
    expect(await Promise.all([first, second])).toEqual(['ok', 'ok']);
    expect(fetchNew).toHaveBeenCalledTimes(1);
    await poller.poll();
    expect(fetchNew).toHaveBeenCalledTimes(2);
  });

  it('권한이 거부(또는 미결정)면 시스템 알림 없이 알림함(홈)에만 쌓이고 ack한다', async () => {
    for (const permission of ['denied', 'undetermined'] as const) {
      const { poller, inbox, present, ack } = setup({ permission, list: [note('10')] });
      expect(await poller.poll()).toBe('ok');
      expect(present).not.toHaveBeenCalled();
      expect(idsOf(inbox)).toEqual(['10']);
      expect(ack).toHaveBeenCalled();
    }
  });

  it('시스템 알림 표시가 실패해도 알림함에는 남고 나머지를 계속 띄운다', async () => {
    const { poller, inbox, present, log } = setup({ list: [note('10'), note('20')] });
    present.mockRejectedValueOnce(new Error('boom'));
    expect(await poller.poll()).toBe('ok');
    expect(present).toHaveBeenCalledTimes(2);
    expect(idsOf(inbox)).toEqual(['20', '10']);
    expect(log).toHaveBeenCalledWith('[notifications] 알림 표시 실패: Error');
  });

  it('폰 토큰이 없으면(연결 전) 서버에 묻지 않는다', async () => {
    const { poller, fetchNew } = setup({ session: false });
    expect(await poller.poll()).toBe('no-session');
    expect(fetchNew).not.toHaveBeenCalled();
  });

  it('요청이 실패하면 failed(알림 내용 없이 이름만 기록), 다음 폴링은 다시 시도한다. ack 실패는 무시한다', async () => {
    const { poller, fetchNew, ack, log, inbox } = setup({ list: [note('10')] });
    fetchNew.mockRejectedValueOnce(new HttpError(500, 'x'));
    expect(await poller.poll()).toBe('failed');
    expect(log).toHaveBeenCalledWith('[notifications] 폴링 실패: HttpError');
    ack.mockRejectedValueOnce(new Error('ack'));
    expect(await poller.poll()).toBe('ok');
    expect(idsOf(inbox)).toEqual(['10']);
    expect(log).toHaveBeenCalledWith('[notifications] ack 실패: Error');
  });

  it('시간 제한(10초 기본) 안에 응답이 없으면 failed', async () => {
    jest.useFakeTimers();
    const { poller, fetchNew } = setup();
    fetchNew.mockReturnValueOnce(new Promise(() => undefined));
    const result = poller.poll();
    await jest.advanceTimersByTimeAsync(1000);
    expect(await result).toBe('failed');
  });

  it('stop()으로 취소된 요청의 늦은 응답은 알림함·시스템 알림에 반영하지 않고 ack도 안 한다', async () => {
    const { poller, inbox, present, ack, fetchNew } = setup();
    const gate = deferred<ReturnType<typeof note>[]>();
    fetchNew.mockReturnValueOnce(gate.promise);
    const result = poller.poll();
    await Promise.resolve();
    await Promise.resolve();
    poller.stop();
    gate.resolve([note('10')]);
    expect(await result).toBe('cancelled');
    expect(idsOf(inbox)).toEqual([]);
    expect(present).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });

  it('stop() 뒤 다시 poll하면 취소된 옛 실행을 기다리지 않고 새로 돈다(오래된 응답이 새 결과를 덮지 않는다)', async () => {
    const { poller, inbox, fetchNew } = setup();
    const stale = deferred<ReturnType<typeof note>[]>();
    fetchNew.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([note('20')]);
    const first = poller.poll();
    await Promise.resolve();
    await Promise.resolve();
    poller.stop();
    expect(await poller.poll()).toBe('ok');
    stale.resolve([note('10')]);
    expect(await first).toBe('cancelled');
    expect(idsOf(inbox)).toEqual(['20']);
  });

  it('stop()이 세션 확인 중에 불려도 그 실행은 요청을 보내지 않는다', async () => {
    const gate = deferred<boolean>();
    const inbox = createInbox({ storage: createMemoryStorage() });
    const fetchNew = jest.fn().mockResolvedValue([]);
    const poller = createNotificationPoller({ api: { fetchNew, ack: jest.fn() }, inbox, notifier: fakeNotifier().notifier, hasSession: () => gate.promise, log: jest.fn() });
    const result = poller.poll();
    poller.stop();
    gate.resolve(true);
    expect(await result).toBe('cancelled');
    expect(fetchNew).not.toHaveBeenCalled();
  });
});
