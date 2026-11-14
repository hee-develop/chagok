import { createInbox } from '../inbox';
import { createMemoryStorage } from '../keyValue';
import { CALENDAR_SETTINGS_PATH, createEventsStaleTapHandler, handleNotificationTap, registerTapHandler } from '../taps';
import { fakeSync as makeFakeSync, note } from '../../../__tests__/support/notifications';
import type { SyncResult } from '../../calendar-sync/eventSync';

const fakeSync = (result: SyncResult) => makeFakeSync(result).sync;

describe('알림 누름 처리', () => {
  const tapOf = (id: string, kind = 'events-stale') => ({ id, kind, data: { action: 'resend-events' } });

  it('events-stale: 일정 동기화를 한 번 부르고 읽음으로 하고, 보냈으면 알림함에서 지운다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    await inbox.add([note('10')]);
    const fake = makeFakeSync('sent');
    const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(fake.sync, inbox, jest.fn()));
    await handleNotificationTap(tapOf('10'), inbox);
    expect(fake.run).toHaveBeenCalledTimes(1);
    expect(inbox.getState().items).toEqual([]);
    unregister();
  });

  it('변화 없음(unchanged)도 해결로 본다: 알림함의 events-stale을 모두 지운다. 화면은 옮기지 않는다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    await inbox.add([note('10'), note('11')]);
    const navigate = jest.fn();
    const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(fakeSync('unchanged'), inbox, navigate));
    await handleNotificationTap(tapOf('10'), inbox);
    expect(inbox.getState().items).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    unregister();
  });

  it('실패·취소면 알림은 남고 읽음 처리만 된다', async () => {
    for (const result of ['failed', 'cancelled'] as const) {
      const inbox = createInbox({ storage: createMemoryStorage() });
      await inbox.add([note('10')]);
      const navigate = jest.fn();
      const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(fakeSync(result), inbox, navigate));
      await handleNotificationTap(tapOf('10'), inbox);
      expect(inbox.getState().items.map((i) => [i.id, i.read])).toEqual([['10', true]]);
      expect(navigate).not.toHaveBeenCalled();
      unregister();
    }
  });

  it('일정을 보낼 수 없는 폰(권한 꺼짐·캘린더 미선택)이면 알림을 지우고 캘린더 권한·선택 화면으로 간다', async () => {
    for (const result of ['permission-denied', 'no-selection'] as const) {
      const inbox = createInbox({ storage: createMemoryStorage() });
      await inbox.add([note('10')]);
      const navigate = jest.fn();
      const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(fakeSync(result), inbox, navigate));
      await handleNotificationTap(tapOf('10'), inbox);
      expect(inbox.getState().items).toEqual([]);
      expect(navigate).toHaveBeenCalledWith(CALENDAR_SETTINGS_PATH);
      unregister();
    }
  });

  it('목 출처는 알림만 지우고 이동하지 않는다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    await inbox.add([note('10')]);
    const navigate = jest.fn();
    const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(fakeSync('mock'), inbox, navigate));
    await handleNotificationTap(tapOf('10'), inbox);
    expect(inbox.getState().items).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    unregister();
  });

  it('동기화가 이미 도는 중이면 새로 돌리지 않고 그 결과를 쓴다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    await inbox.add([note('10')]);
    const fake = makeFakeSync('failed', Promise.resolve('sent'));
    const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(fake.sync, inbox, jest.fn()));
    await handleNotificationTap(tapOf('10'), inbox);
    expect(fake.run).not.toHaveBeenCalled();
    expect(inbox.getState().items).toEqual([]);
    unregister();
  });

  it('다른 묶음이 종류별 처리를 등록할 수 있고, 모르는 종류·던지는 처리기는 조용히 넘어간다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    const family = jest.fn();
    const off = registerTapHandler('family-status', family);
    await handleNotificationTap(tapOf('1', 'family-status'), inbox);
    expect(family).toHaveBeenCalledWith(tapOf('1', 'family-status'));
    off();
    await handleNotificationTap(tapOf('1', 'family-status'), inbox);
    expect(family).toHaveBeenCalledTimes(1);
    const off2 = registerTapHandler('late-sms', () => { throw new Error('x'); });
    await expect(handleNotificationTap(tapOf('2', 'late-sms'), inbox)).resolves.toBeUndefined();
    await expect(handleNotificationTap(tapOf('3', 'unknown-kind'), inbox)).resolves.toBeUndefined();
    off2();
  });
});
