import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { defaultCalendarSource } from '../calendar-select/defaultSource';
import type { PermissionState } from '../notifications/types';

/** 앱이 실제로 쓰는 권한만 둔다. 캘린더는 일정을 읽을 때, 카메라는 차 화면의 QR을 찍을 때, 알림은 시스템 알림을 띄울 때(첫 설정 끝에 한 번 묻는다). */
export type PermissionName = 'calendar' | 'camera' | 'notifications';
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
/** 알림은 한 번 물은 뒤에는 창 없이 현재 상태만 오므로(`askNotificationPermissionOnce`) 아직 안 정했으면 ask, 거부했으면 denied(설정에서만 켤 수 있다). */
const fromNotification = (state: PermissionState): PermissionStatus => (state === 'granted' ? 'granted' : state === 'undetermined' ? 'ask' : 'denied');

// 네이티브 모듈은 처음 쓸 때 불러온다. 목 캘린더로 돌 때나 테스트에서는 건드리지 않는다.
/* eslint-disable @typescript-eslint/no-require-imports */
const calendarModule = () => require('expo-calendar/legacy') as typeof import('expo-calendar/legacy');
const cameraModule = () => require('expo-camera') as typeof import('expo-camera');
const notificationModule = () => require('../notifications/permission') as typeof import('../notifications/permission');
/* eslint-enable @typescript-eslint/no-require-imports */

export const devicePermissions: PermissionsSource = {
  read: async () => {
    // 목 캘린더(테스트·E2E)는 기기 캘린더를 읽지 않으므로 권한이 필요 없다.
    const calendar: PermissionStatus = defaultCalendarSource.kind === 'mock' ? 'granted' : toStatus(await calendarModule().getCalendarPermissionsAsync());
    const camera = toStatus(await cameraModule().Camera.getCameraPermissionsAsync());
    const notifications = fromNotification(await notificationModule().getNotificationPermission());
    return { calendar, camera, notifications };
  },
  request: async (name) => {
    if (name === 'notifications') return fromNotification(await notificationModule().askNotificationPermissionOnce());
    return toStatus(name === 'calendar' ? await calendarModule().requestCalendarPermissionsAsync() : await cameraModule().Camera.requestCameraPermissionsAsync());
  },
  openSettings: () => { Linking.openSettings().catch(() => {}); },
};

export type PermissionsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; map: PermissionMap };

/**
 * 권한 상태를 읽는다. 화면이 포커스를 얻을 때와 앱이 다시 앞으로 올 때(설정에서 켜고 돌아온 경우) 새로 읽는다.
 * 처음부터 읽지 못하면 error(권한을 모르는 채로 일정을 막지 않도록 호출한 쪽이 판단한다). 다시 읽는 동안에는 직전 결과를 유지한다.
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
      // 이미 읽어 둔 결과가 있으면 다시 읽다 실패해도 그대로 둔다(화면이 출렁이지 않게). 처음부터 못 읽었을 때만 오류다.
      if (generation.current === mine) setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
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
