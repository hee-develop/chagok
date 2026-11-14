import { appInbox } from './inbox';
import { asyncKeyValueStorage, type KeyValueStorage } from './keyValue';
import { expoLocalNotifier, type LocalNotifier } from './localNotifier';
import type { PermissionState } from './types';

const ASKED_KEY = 'chagok.notifications.permissionAsked';

/**
 * 알림 권한을 묻는다(정책서 10.4: **첫 설정 끝**에 묻고, 거부하면 알림 없이 홈에만 보인다).
 * 한 번 물은 뒤에는 다시 창을 띄우지 않고 현재 상태만 돌려준다(꺼진 권한을 다시 켜게 하는 안내는 홈·설정 몫이다).
 * 거부해도 던지지 않는다: 받은 알림은 `useInbox`에 쌓이므로 홈에서 볼 수 있다.
 */
export async function askNotificationPermission({
  notifier = expoLocalNotifier,
  storage = asyncKeyValueStorage,
}: { notifier?: LocalNotifier; storage?: KeyValueStorage } = {}): Promise<PermissionState> {
  try {
    const current = await notifier.permission();
    if (current === 'granted') return current;
    let asked = false;
    try {
      asked = (await storage.getItem(ASKED_KEY)) === '1';
    } catch {
      asked = false;
    }
    if (asked) return current;
    // 창을 띄우기 전에 '물었다'를 먼저 적는다(창이 떠 있는 동안 앱이 꺼져도 다시 묻지 않는다).
    await storage.setItem(ASKED_KEY, '1').catch(() => undefined);
    return await notifier.requestPermission();
  } catch {
    return 'denied';
  }
}

/** 지금 알림 권한 상태(홈의 '켜면 이게 돼요' 안내가 쓴다). */
export const getNotificationPermission = (notifier: LocalNotifier = expoLocalNotifier): Promise<PermissionState> =>
  notifier.permission().catch(() => 'denied' as const);

/** 폰 알림함을 비운다(차와 연결이 끊기거나 폰을 바꿔 다른 자리가 될 때 부른다). */
export const clearNotificationInbox = () => appInbox.clear();
