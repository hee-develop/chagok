import * as Notifications from 'expo-notifications';

import type { InboxItem, NotificationTap, PermissionState } from './types';

/** 폰 개발 빌드가 FCM으로 받을 때도 같은 채널을 쓴다(서버 `FCM_ANDROID_CHANNEL_ID`와 같다). */
export const ANDROID_CHANNEL_ID = 'chagok-default';

/**
 * 시스템 알림(로컬 알림)을 띄우고 누름을 듣는 포트. 기본 구현은 `expo-notifications`이고 테스트가 바꾼다.
 * Expo Go(SDK 58)에서 **로컬 알림은 되고 원격 푸시는 안 된다**(공식 문서: 로컬 알림은 Expo Go에서 계속 쓸 수 있고,
 * 푸시는 SDK 53부터 Android Expo Go에서 쓸 수 없다). 그래서 서버 알림함을 폴링해서 로컬 알림으로 대신한다.
 */
export type LocalNotifier = {
  permission(): Promise<PermissionState>;
  /** 시스템 권한 창을 띄운다(Android 13+는 알림 채널을 먼저 만든다). 이미 정해졌으면 창 없이 현재 상태가 온다. */
  requestPermission(): Promise<PermissionState>;
  /** 지금 시스템 알림 하나를 띄운다. */
  present(item: Pick<InboxItem, 'id' | 'kind' | 'title' | 'body' | 'data'>): Promise<void>;
  /** 알림을 눌렀을 때를 듣는다. 앱이 꺼져 있다가 알림으로 열렸다면 그 누름도 한 번 전해 준다. 해제 함수를 돌려준다. */
  onTap(handler: (tap: NotificationTap) => void): () => void;
};

const toPermission = (res: { granted: boolean; status: string }): PermissionState =>
  res.granted ? 'granted' : res.status === 'undetermined' ? 'undetermined' : 'denied';

let prepared: Promise<void> | null = null;
/** 앱이 앞에 있어도 알림이 뜨게 하는 핸들러와 Android 채널을 한 번 만든다. */
const prepare = () => {
  prepared ??= (async () => {
    // 앞에 있는 동안에도 배너를 띄운다(폴링은 앱이 앞일 때만 돈다). Android는 소리를 끄면 배너가 안 뜬다(공식 문서) — 채널 기본 소리를 따른다.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: '차곡 알림',
      // eslint-disable-next-line import/namespace -- 열거형은 `export *`로 내보내져 린터가 못 찾는다(타입 검사는 통과)
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => undefined);
  })();
  return prepared;
};

const tapOf = (response: Notifications.NotificationResponse): NotificationTap | null => {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const raw = response.notification.request.content.data as Record<string, unknown> | null | undefined;
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) if (typeof v === 'string') data[k] = v;
  const { id = '', kind = '' } = data;
  return { id, kind, data };
};

export const expoLocalNotifier: LocalNotifier = {
  permission: async () => toPermission(await Notifications.getPermissionsAsync()),
  requestPermission: async () => {
    await prepare();
    return toPermission(await Notifications.requestPermissionsAsync());
  },
  present: async (item) => {
    await prepare();
    await Notifications.scheduleNotificationAsync({
      content: { title: item.title, body: item.body, data: { ...item.data, id: item.id, kind: item.kind } },
      trigger: { channelId: ANDROID_CHANNEL_ID },
    });
  },
  onTap: (handler) => {
    void prepare();
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const tap = tapOf(response);
      if (tap) handler(tap);
    });
    // 앱이 꺼져 있다가 알림을 눌러 열렸다면 그 응답은 리스너가 붙기 전에 왔으니 한 번 꺼내서 전하고 지운다.
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        const tap = response ? tapOf(response) : null;
        if (tap) {
          handler(tap);
          await Notifications.clearLastNotificationResponseAsync();
        }
      })
      .catch(() => undefined);
    return () => subscription.remove();
  },
};
