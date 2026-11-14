import { HttpError } from '../../../api/request';
import { createInbox } from '../inbox';
import { createMemoryStorage } from '../keyValue';
import type { NotificationsApi } from '../notificationsApi';
import { createNotificationPoller } from '../poller';
import { deferred, fakeNotifier, fakeSync, idsOf, note, page } from '../../../__tests__/support/notifications';
import type { SyncResult } from '../../calendar-sync/eventSync';

const setup = (over: { permission?: 'granted' | 'denied' | 'undetermined'; session?: boolean; list?: ReturnType<typeof note>[]; sync?: SyncResult | null; inFlight?: Promise<SyncResult> | null; cursor?: string | null } = {}) => {
  const inbox = createInbox({ storage: createMemoryStorage() });
  const { notifier, present, state } = fakeNotifier(over.permission ?? 'granted');
  const fetchNew = jest.fn<ReturnType<NotificationsApi['fetchNew']>, Parameters<NotificationsApi['fetchNew']>>().mockResolvedValue(page(over.list ?? [], over.cursor ?? null));
  const ack = jest.fn<ReturnType<NotificationsApi['ack']>, Parameters<NotificationsApi['ack']>>().mockResolvedValue(undefined);
  const log = jest.fn();
  const fake = fakeSync(over.sync === undefined ? 'failed' : over.sync, over.inFlight ?? null);
  const poller = createNotificationPoller({ api: { fetchNew, ack }, inbox, notifier, hasSession: async () => over.session ?? true, sync: fake.sync, syncWaitMs: 500, timeoutMs: 1000, log });
  return { poller, inbox, fetchNew, ack, present, state, log, sync: fake };
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
    fetchNew.mockResolvedValueOnce(page([note('10'), note('20')])); // ack이 실패했던 것처럼 10이 다시 온다
    await poller.poll();
    expect(fetchNew.mock.calls[1]?.[0]).toBe('10');
    expect(present.mock.calls.map(([item]) => item.id)).toEqual(['10', '20']);
    fetchNew.mockResolvedValueOnce(page());
    await poller.poll();
    expect(present).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(2); // 빈 목록은 ack하지 않는다
  });

  it('동시에 하나만 돈다: 도는 중에 다시 불리면 같은 실행의 결과를 받고 요청을 하나 더 보내지 않는다', async () => {
    const { poller, fetchNew } = setup();
    const gate = deferred<ReturnType<typeof page>>();
    fetchNew.mockReturnValueOnce(gate.promise);
    const first = poller.poll();
    const second = poller.poll();
    await Promise.resolve();
    gate.resolve(page());
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
    const gate = deferred<ReturnType<typeof page>>();
    fetchNew.mockReturnValueOnce(gate.promise);
    const result = poller.poll();
    await Promise.resolve();
    await Promise.resolve();
    poller.stop();
    gate.resolve(page([note('10')]));
    expect(await result).toBe('cancelled');
    expect(idsOf(inbox)).toEqual([]);
    expect(present).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });

  it('stop() 뒤 다시 poll하면 취소된 옛 실행을 기다리지 않고 새로 돈다(오래된 응답이 새 결과를 덮지 않는다)', async () => {
    const { poller, inbox, fetchNew } = setup();
    const stale = deferred<ReturnType<typeof page>>();
    fetchNew.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page([note('20')]));
    const first = poller.poll();
    await Promise.resolve();
    await Promise.resolve();
    poller.stop();
    expect(await poller.poll()).toBe('ok');
    stale.resolve(page([note('10')]));
    expect(await first).toBe('cancelled');
    expect(idsOf(inbox)).toEqual(['20']);
  });

  it('stop()이 세션 확인 중에 불려도 그 실행은 요청을 보내지 않는다', async () => {
    const gate = deferred<boolean>();
    const inbox = createInbox({ storage: createMemoryStorage() });
    const fetchNew = jest.fn().mockResolvedValue(page());
    const poller = createNotificationPoller({ api: { fetchNew, ack: jest.fn() }, inbox, notifier: fakeNotifier().notifier, hasSession: () => gate.promise, sync: fakeSync().sync, log: jest.fn() });
    const result = poller.poll();
    poller.stop();
    gate.resolve(true);
    expect(await result).toBe('cancelled');
    expect(fetchNew).not.toHaveBeenCalled();
  });
  describe('events-stale은 이 폰의 일정 동기화 결과를 따른다', () => {
    const stale = (id: string) => note(id, { kind: 'events-stale' });

    it('일정을 보냈으면(sent·unchanged) 알림함에도 시스템 알림에도 쓰지 않고 ack만 한다. 다음 폴링은 그 id 뒤부터 묻는다', async () => {
      for (const result of ['sent', 'unchanged'] as const) {
        const { poller, inbox, present, ack, fetchNew } = setup({ list: [stale('10')], sync: result });
        expect(await poller.poll()).toBe('ok');
        expect(idsOf(inbox)).toEqual([]);
        expect(present).not.toHaveBeenCalled();
        expect(ack).toHaveBeenCalledWith(['10'], expect.any(AbortSignal));
        await poller.poll();
        expect(fetchNew.mock.calls[1]?.[0]).toBe('10');
      }
    });

    it('동기화가 도는 중이면 그 결과를 기다린다: 끝나기 전에는 알림함에 아무것도 없고, 성공으로 끝나면 띄우지 않는다(새로 돌리지도 않는다)', async () => {
      const running = deferred<SyncResult>();
      const { poller, inbox, present, ack, sync } = setup({ list: [stale('10')], inFlight: running.promise });
      const result = poller.poll();
      await new Promise((r) => setTimeout(r, 20));
      expect(idsOf(inbox)).toEqual([]);
      expect(ack).not.toHaveBeenCalled();
      running.resolve('sent');
      expect(await result).toBe('ok');
      expect(idsOf(inbox)).toEqual([]);
      expect(present).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(['10'], expect.any(AbortSignal));
      expect(sync.run).not.toHaveBeenCalled();
    });

    it('도는 중인 동기화가 실패로 끝나면 알림을 그대로 보인다', async () => {
      const { poller, inbox, present } = setup({ list: [stale('10')], inFlight: Promise.resolve('failed') });
      await poller.poll();
      expect(idsOf(inbox)).toEqual(['10']);
      expect(present).toHaveBeenCalledTimes(1);
    });

    it('일정을 보낼 수 없는 폰(권한 꺼짐·캘린더 미선택·목)이면 알림함에도 시스템 알림에도 쓰지 않고 ack로 지운다', async () => {
      for (const result of ['permission-denied', 'no-selection', 'mock'] as const) {
        const { poller, inbox, present, ack } = setup({ list: [stale('10')], sync: result });
        await poller.poll();
        expect(idsOf(inbox)).toEqual([]);
        expect(present).not.toHaveBeenCalled();
        expect(ack).toHaveBeenCalledWith(['10'], expect.any(AbortSignal));
      }
    });

    it('도는 동기화가 없으면 한 번 돌려 본다. 다른 종류 알림은 결과와 상관없이 보인다', async () => {
      const { poller, inbox, present, sync } = setup({ list: [stale('10'), note('20', { kind: 'late-sms' })], sync: 'sent' });
      await poller.poll();
      expect(sync.run).toHaveBeenCalledTimes(1);
      expect(idsOf(inbox)).toEqual(['20']);
      expect(present.mock.calls.map(([item]) => item.id)).toEqual(['20']);
    });

    it('events-stale이 없으면 동기화를 건드리지 않는다', async () => {
      const { poller, sync } = setup({ list: [note('20', { kind: 'late-sms' })], sync: 'sent' });
      await poller.poll();
      expect(sync.run).not.toHaveBeenCalled();
    });

    it('결과가 syncWaitMs 안에 나오지 않으면 알림을 그대로 보인다', async () => {
      const { poller, inbox } = setup({ list: [stale('10')], inFlight: new Promise(() => undefined) });
      expect(await poller.poll()).toBe('ok');
      expect(idsOf(inbox)).toEqual(['10']);
    });

    it('기다리는 동안 stop()되면 cancelled이고 아무것도 반영하지 않는다', async () => {
      const running = deferred<SyncResult>();
      const { poller, inbox, ack } = setup({ list: [stale('10')], inFlight: running.promise });
      const result = poller.poll();
      await new Promise((r) => setTimeout(r, 20));
      poller.stop();
      running.resolve('failed');
      expect(await result).toBe('cancelled');
      expect(idsOf(inbox)).toEqual([]);
      expect(ack).not.toHaveBeenCalled();
    });
  });

  describe('서버 id 기준값(cursor)', () => {
    it('마지막 id가 서버 cursor보다 크면(서버가 바뀜·시계가 뒤로 감) 마지막 id를 버리고 처음부터 다시 받는다. 이미 가진 알림은 다시 담지 않는다', async () => {
      const { poller, inbox, fetchNew, present } = setup({ list: [note('900')], cursor: '1000' });
      await poller.poll();
      expect(inbox.getState().lastId).toBe('900');
      // 다른 서버: 기준값 500, since=900으로 물으면 빈 목록이 오지만 cursor가 더 작다 → since 없이 다시 묻는다.
      fetchNew.mockResolvedValueOnce(page([], '500')).mockResolvedValueOnce(page([note('900'), note('510')], '500'));
      expect(await poller.poll()).toBe('ok');
      expect(fetchNew.mock.calls.slice(1).map(([since]) => since)).toEqual(['900', null]);
      expect(idsOf(inbox)).toEqual(['900', '510']); // 900은 이미 있어 한 번만
      expect(inbox.getState().lastId).toBe('900'); // 새로 받은 것 중 가장 큰 id
      expect(present.mock.calls.map(([item]) => item.id)).toEqual(['900', '510']); // 900은 처음 한 번, 510만 새로
    });

    it('cursor가 마지막 id 이상이면 그대로 이어서 받는다. cursor가 없는 서버(옛 서버)면 비교하지 않는다', async () => {
      const { poller, fetchNew } = setup({ list: [note('900')], cursor: '900' });
      await poller.poll();
      await poller.poll();
      expect(fetchNew).toHaveBeenCalledTimes(2);
      fetchNew.mockResolvedValueOnce(page([], null));
      await poller.poll();
      expect(fetchNew).toHaveBeenCalledTimes(3);
    });
  });
});
