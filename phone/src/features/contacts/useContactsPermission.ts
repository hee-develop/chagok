import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { defaultContactsSource, type ContactsPermission, type ContactsSource } from './contactsSource';

/** 연락처 권한 상태. 읽는 동안은 null이다(안내를 깜빡이지 않으려고 모르는 동안은 아무것도 보이지 않는다). 읽지 못해도 null이다. */
export type ContactsPermissionState = ContactsPermission | null;

/**
 * 연락처 권한을 읽는다. 화면이 포커스를 얻을 때와 앱이 다시 앞으로 올 때(설정에서 켜고 돌아온 경우) 새로 읽는다.
 * `request()`는 시스템 권한 창을 띄우고(처음 물을 때만 창이 뜬다) 끝나면 다시 읽는다. 창을 거부해도 던지지 않는다.
 */
export function useContactsPermission(source: ContactsSource = defaultContactsSource) {
  const [permission, setPermission] = useState<ContactsPermissionState>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await source.permission();
      if (generation.current === mine) setPermission(next);
    } catch {
      // 이미 읽어 둔 값이 있으면 그대로 둔다.
    }
  }, [source]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void refresh(); });
    return () => {
      generation.current += 1;
      sub.remove();
    };
  }, [refresh]);

  const request = useCallback(async (): Promise<ContactsPermission> => {
    let result: ContactsPermission = 'denied';
    try {
      result = await source.request();
    } catch {
      result = 'denied';
    }
    await refresh();
    return result;
  }, [source, refresh]);

  const openSettings = useCallback(() => { Linking.openSettings().catch(() => {}); }, []);

  return { permission, request, refresh, openSettings };
}
