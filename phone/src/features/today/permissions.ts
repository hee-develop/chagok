import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { defaultCalendarSource } from '../calendar-select/defaultSource';

/** 앱이 실제로 쓰는 권한만 둔다. 캘린더는 일정을 읽을 때, 카메라는 차 화면의 QR을 찍을 때. */
export type PermissionName = 'calendar' | 'camera';
/** granted 켜짐 / ask 아직 안 물었거나 다시 물을 수 있음 / denied 설정에서만 켤 수 있음 */
export type PermissionStatus = 'granted' | 'ask' | 'denied';
export type PermissionMap = Record<PermissionName, PermissionStatus>;

export interface PermissionsSource {
  read(): Promise<PermissionMap>;
  /** 시스템 권한 창을 띄운다. 결과 상태를 돌려준다. */
  request(name: PermissionName): Promise<PermissionStatus>;
  openSettings(): void;
}

type Response = { granted: boolean; canAskAgain: boolean };
const toStatus = (r: Response): PermissionStatus => (r.granted ? 'granted' : r.canAskAgain ? 'ask' : 'denied');

// 네이티브 모듈은 처음 쓸 때 불러온다. 목 캘린더로 돌 때나 테스트에서는 건드리지 않는다.
/* eslint-disable @typescript-eslint/no-require-imports */
const calendarModule = () => require('expo-calendar/legacy') as typeof import('expo-calendar/legacy');
const cameraModule = () => require('expo-camera') as typeof import('expo-camera');
/* eslint-enable @typescript-eslint/no-require-imports */

export const devicePermissions: PermissionsSource = {
  read: async () => {
    // 목 캘린더(테스트·E2E)는 기기 캘린더를 읽지 않으므로 권한이 필요 없다.
    const calendar: PermissionStatus = defaultCalendarSource.kind === 'mock' ? 'granted' : toStatus(await calendarModule().getCalendarPermissionsAsync());
    const camera = toStatus(await cameraModule().Camera.getCameraPermissionsAsync());
    return { calendar, camera };
  },
  request: async (name) => toStatus(name === 'calendar' ? await calendarModule().requestCalendarPermissionsAsync() : await cameraModule().Camera.requestCameraPermissionsAsync()),
  openSettings: () => { Linking.openSettings().catch(() => {}); },
};

export type PermissionsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; map: PermissionMap };

/**
 * 권한 상태를 읽는다. 화면이 포커스를 얻을 때와 앱이 다시 앞으로 올 때(설정에서 켜고 돌아온 경우) 새로 읽는다.
 * 읽지 못하면 error(권한을 모르는 채로 일정을 막지 않도록 호출한 쪽이 판단한다).
 */
export function usePermissions(source: PermissionsSource = devicePermissions) {
  const [state, setState] = useState<PermissionsState>({ status: 'loading' });
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const map = await source.read();
      if (generation.current === mine) setState({ status: 'ready', map });
    } catch {
      if (generation.current === mine) setState({ status: 'error' });
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

  const request = useCallback(async (name: PermissionName) => {
    try {
      await source.request(name);
    } finally {
      await refresh();
    }
  }, [source, refresh]);

  return { state, refresh, request, openSettings: source.openSettings };
}
