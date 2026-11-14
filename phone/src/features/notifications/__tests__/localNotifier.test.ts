import * as Notifications from 'expo-notifications';

import { ANDROID_CHANNEL_ID, expoLocalNotifier } from '../localNotifier';

jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('x'),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponse: jest.fn().mockReturnValue(null),
  clearLastNotificationResponse: jest.fn(),
}));

const mocked = Notifications as unknown as Record<string, jest.Mock>;
const response = (data: Record<string, unknown>, actionIdentifier = 'expo.modules.notifications.actions.DEFAULT', identifier = `req-${String(data.id)}`) => ({
  actionIdentifier,
  notification: { date: 0, request: { identifier, trigger: null, content: { data } } },
});

describe('expoLocalNotifier', () => {
  beforeEach(() => jest.clearAllMocks());

  it('권한 상태를 granted/denied/undetermined로 옮긴다', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    expect(await expoLocalNotifier.permission()).toBe('granted');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'undetermined' });
    expect(await expoLocalNotifier.permission()).toBe('undetermined');
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    expect(await expoLocalNotifier.permission()).toBe('denied');
  });

  it('권한을 물을 때 알림 채널을 먼저 만들고 앞에 있어도 배너가 뜨는 핸들러를 건다', async () => {
    mocked.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    expect(await expoLocalNotifier.requestPermission()).toBe('denied');
    expect(mocked.setNotificationChannelAsync.mock.calls[0]?.[0]).toBe(ANDROID_CHANNEL_ID);
    const handler = mocked.setNotificationHandler.mock.calls[0]?.[0] as { handleNotification: () => Promise<unknown> };
    expect(await handler.handleNotification()).toEqual({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false });
  });

  it('로컬 알림은 즉시(채널 지정 trigger)로 띄우고 data에 id·kind를 싣는다', async () => {
    await expoLocalNotifier.present({ id: '10', kind: 'events-stale', title: '제목', body: '본문', data: { action: 'resend-events' } });
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: '제목', body: '본문', data: { action: 'resend-events', id: '10', kind: 'events-stale' } },
      trigger: { channelId: ANDROID_CHANNEL_ID },
    });
  });

  it('알림을 누르면(기본 동작) id·kind·data를 넘기고, 다른 동작(버튼 등)은 무시한다. 해제하면 구독을 푼다', async () => {
    const remove = jest.fn();
    let listener: (r: unknown) => void = () => undefined;
    mocked.addNotificationResponseReceivedListener.mockImplementation((l: (r: unknown) => void) => {
      listener = l;
      return { remove };
    });
    const handler = jest.fn();
    const off = expoLocalNotifier.onTap(handler);
    listener(response({ id: '10', kind: 'events-stale', action: 'resend-events', n: 3 }));
    expect(handler).toHaveBeenCalledWith({ id: '10', kind: 'events-stale', data: { id: '10', kind: 'events-stale', action: 'resend-events' } });
    listener(response({ id: '11', kind: 'events-stale' }, 'some-button'));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    expect(remove).toHaveBeenCalled();
  });

  it('알림으로 앱이 열렸다면(꺼져 있던 중의 누름) 동기 API로 마지막 응답을 한 번 전하고 지운다', async () => {
    mocked.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
    mocked.getLastNotificationResponse.mockReturnValueOnce(response({ id: '20', kind: 'events-stale' }));
    const handler = jest.fn();
    expoLocalNotifier.onTap(handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocked.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('같은 알림 응답은 한 번만 처리한다: 리스너로 받은 응답이 마지막 응답으로 남아 훅이 다시 붙어도 두 번 처리하지 않는다', async () => {
    let listener: (r: unknown) => void = () => undefined;
    mocked.addNotificationResponseReceivedListener.mockImplementation((l: (r: unknown) => void) => {
      listener = l;
      return { remove: jest.fn() };
    });
    const first = jest.fn();
    expoLocalNotifier.onTap(first);
    const tapped = response({ id: '30', kind: 'events-stale' });
    listener(tapped);
    expect(first).toHaveBeenCalledTimes(1);
    expect(mocked.clearLastNotificationResponse).toHaveBeenCalled(); // 처리한 응답은 지운다
    // 지우지 못했다고 해도(또는 지우기 전에 다시 붙어도) 같은 응답은 다시 전하지 않는다.
    mocked.getLastNotificationResponse.mockReturnValueOnce(tapped);
    const second = jest.fn();
    expoLocalNotifier.onTap(second);
    expect(second).not.toHaveBeenCalled();
    // 다른 알림의 응답은 전한다.
    listener(response({ id: '31', kind: 'events-stale' }));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('마지막 응답을 읽다 던져도 리스너는 동작한다', async () => {
    let listener: (r: unknown) => void = () => undefined;
    mocked.addNotificationResponseReceivedListener.mockImplementation((l: (r: unknown) => void) => {
      listener = l;
      return { remove: jest.fn() };
    });
    mocked.getLastNotificationResponse.mockImplementationOnce(() => {
      throw new Error('x');
    });
    const handler = jest.fn();
    expect(() => expoLocalNotifier.onTap(handler)).not.toThrow();
    listener(response({ id: '40', kind: 'events-stale' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
