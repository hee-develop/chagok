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
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
}));

const mocked = Notifications as unknown as Record<string, jest.Mock>;
const response = (data: Record<string, unknown>, actionIdentifier = 'expo.modules.notifications.actions.DEFAULT') => ({
  actionIdentifier,
  notification: { date: 0, request: { identifier: 'x', trigger: null, content: { data } } },
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

  it('알림으로 앱이 열렸다면(꺼져 있던 중의 누름) 마지막 응답을 한 번 전하고 지운다', async () => {
    mocked.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
    mocked.getLastNotificationResponseAsync.mockResolvedValueOnce(response({ id: '10', kind: 'events-stale' }));
    const handler = jest.fn();
    expoLocalNotifier.onTap(handler);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocked.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  });
});
