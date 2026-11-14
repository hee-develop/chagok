import { createInbox } from '../inbox';
import { createMemoryStorage } from '../keyValue';
import { createEventsStaleTapHandler, handleNotificationTap, registerTapHandler } from '../taps';
import { note } from '../testSupport';
import type { EventSync, SyncResult } from '../../calendar-sync/eventSync';

const fakeSync = (result: SyncResult): EventSync => ({ run: jest.fn().mockResolvedValue(result), stop: jest.fn(), rememberSelection: jest.fn(), lastResult: () => result });

describe('알림 누름 처리', () => {
  const tapOf = (id: string, kind = 'events-stale') => ({ id, kind, data: { action: 'resend-events' } });

  it('events-stale: 일정 동기화를 한 번 부르고 읽음으로 하고, 보냈으면 알림함에서 지운다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    await inbox.add([note('10')]);
    const sync = fakeSync('sent');
    const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(sync, inbox));
    await handleNotificationTap(tapOf('10'), inbox);
    expect(sync.run).toHaveBeenCalledTimes(1);
    expect(inbox.getState().items).toEqual([]);
    unregister();
  });

  it('보내지 못했으면(권한 없음·실패) 알림은 남고 읽음 처리만 된다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    await inbox.add([note('10')]);
    const unregister = registerTapHandler('events-stale', createEventsStaleTapHandler(fakeSync('permission-denied'), inbox));
    await handleNotificationTap(tapOf('10'), inbox);
    expect(inbox.getState().items.map((i) => [i.id, i.read])).toEqual([['10', true]]);
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
