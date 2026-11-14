import { createMemoryStore } from '../../../storage/keyValueStore';
import { askNotificationPermissionOnce } from '../permission';
import { createInbox } from '../inbox';
import { createNotificationPoller } from '../poller';
import { fakeNotifier, fakeSync, idsOf, note, page } from '../../../__tests__/support/notifications';

describe('알림 권한(첫 설정 끝에 묻는다)', () => {
  it('아직 안 정해졌으면 한 번 묻고, 한 번 물은 뒤에는 창 없이 현재 상태만 돌려준다', async () => {
    const { notifier, state, requestPermission } = fakeNotifier('undetermined');
    const storage = createMemoryStore();
    state.permission = 'undetermined';
    requestPermission.mockImplementation(async () => {
      state.permission = 'denied';
      return 'denied';
    });
    expect(await askNotificationPermissionOnce({ notifier, storage })).toBe('denied');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(await askNotificationPermissionOnce({ notifier, storage })).toBe('denied');
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('이미 허용됐으면 묻지 않는다', async () => {
    const { notifier, requestPermission } = fakeNotifier('granted');
    expect(await askNotificationPermissionOnce({ notifier, storage: createMemoryStore() })).toBe('granted');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('저장소·권한 API가 던져도 던지지 않는다(거부로 본다)', async () => {
    const { notifier, requestPermission } = fakeNotifier('undetermined');
    requestPermission.mockRejectedValueOnce(new Error('x'));
    expect(await askNotificationPermissionOnce({ notifier, storage: createMemoryStore() })).toBe('denied');
    const failing = { getItem: async () => { throw new Error('r'); }, setItem: async () => { throw new Error('w'); }, removeItem: async () => undefined };
    const ok = fakeNotifier('undetermined');
    expect(await askNotificationPermissionOnce({ notifier: ok.notifier, storage: failing })).toBe('undetermined');
    expect(ok.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('동시에 여러 번 불려도 창은 한 번만 띄운다', async () => {
    const { notifier, requestPermission } = fakeNotifier('undetermined');
    const storage = createMemoryStore();
    const [a, b] = await Promise.all([askNotificationPermissionOnce({ notifier, storage }), askNotificationPermissionOnce({ notifier, storage })]);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual(['undetermined', 'undetermined']);
  });

  it('거부해도 받은 알림은 폰 알림함에 쌓여 홈에서 볼 수 있다(시스템 알림은 없다)', async () => {
    const { notifier, present } = fakeNotifier('denied');
    const inbox = createInbox({ storage: createMemoryStore() });
    const poller = createNotificationPoller({
      api: { fetchNew: async () => page([note('10', { title: '차곡이 일정을 못 받고 있어요' })]), ack: async () => undefined },
      inbox,
      notifier,
      hasSession: async () => true,
      sync: fakeSync().sync,
      log: () => undefined,
    });
    expect(await askNotificationPermissionOnce({ notifier, storage: createMemoryStore() })).toBe('denied');
    await poller.poll();
    expect(present).not.toHaveBeenCalled();
    expect(idsOf(inbox)).toEqual(['10']);
    expect(inbox.getState().items[0]).toMatchObject({ title: '차곡이 일정을 못 받고 있어요', read: false });
  });
});
