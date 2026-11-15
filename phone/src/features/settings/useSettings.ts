import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { settingsApi, type SettingKey, type Settings, type SettingsApi } from './settingsApi';

export type SettingsLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; values: Settings };

export type UseSettingsOptions = {
  api?: SettingsApi;
  timeoutMs?: number;
  /** 스위치 하나를 서버에 저장하는 데 성공한 뒤 부른다(예: 늦을 때 연락을 켜면 연락처 권한을 묻는다). */
  onSaved?: (key: SettingKey, value: boolean) => void;
};

/**
 * 자리별 설정 읽기·쓰기. 설정 탭과 첫 설정 '말 거는 방법' 단계가 같이 쓴다.
 * - 화면이 포커스를 얻을 때마다 다시 읽는다. 이미 읽은 값은 다시 읽는 동안 그대로 둔다(깜빡이지 않는다). 새 조회가 시작되면 이전 조회를 취소하고,
 *   응답을 반영하기 전에 그 조회가 아직 현재 것인지 확인한다.
 * - 스위치는 낙관적으로 먼저 바꾸고 서버에 그 키만 보낸다. 실패하면 직전 값으로 되돌리고 `issue`를 남긴다. 저장은 한 번에 하나만 두므로(진행 중에는 `toggle`이 무시된다)
 *   응답이 서로 앞서거나 뒤처지지 않는다. 저장이 시작되면 진행 중인 조회는 취소하고, 저장 중이거나 저장이 끝난 뒤에 도착한 이전 조회의 응답은 버린다.
 * - 포커스를 잃어도 진행 중인 저장은 끝까지 보낸다(언마운트 때만 취소).
 */
export function useSettings({ api = settingsApi, timeoutMs = REQUEST_TIMEOUT_MS, onSaved }: UseSettingsOptions = {}) {
  const [state, setState] = useState<SettingsLoad>({ status: 'loading' });
  const [savingKey, setSavingKey] = useState<SettingKey | null>(null);
  const [issue, setIssue] = useState<{ key: SettingKey } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  /** 저장이 시작되거나 끝날 때마다 올린다. 조회는 시작할 때의 값과 같을 때만 반영된다. */
  const epoch = useRef(0);
  const valuesRef = useRef<Settings | null>(null);
  const onSavedRef = useRef(onSaved);
  // 콜백은 렌더가 끝난 뒤에 바꿔 둔다(저장이 끝나는 시점에는 늘 최신 콜백이 불린다).
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const commit = useCallback((next: SettingsLoad) => {
    valuesRef.current = next.status === 'ready' ? next.values : valuesRef.current;
    setState(next);
  }, []);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    loadRequest.current = controller;
    const startedAt = epoch.current;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    void requestWithTimeout((signal) => api.fetchSettings(signal), timeoutMs, controller).then(
      (values) => {
        if (loadRequest.current !== controller || epoch.current !== startedAt || saveRequest.current) return;
        commit({ status: 'ready', values });
      },
      () => {
        if (loadRequest.current !== controller || epoch.current !== startedAt) return;
        // 이미 읽어 둔 값이 있으면 다시 읽다 실패해도 그대로 둔다(화면이 출렁이지 않게). 처음부터 못 읽었을 때만 오류다.
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
      },
    );
    return () => {
      loadRequest.current = null;
      controller.abort();
    };
  // attempt는 [다시 시도]로 포커스 조회를 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, timeoutMs, attempt, commit]));

  useEffect(() => () => {
    saveRequest.current?.abort();
    saveRequest.current = null;
  }, []);

  useEffect(() => {
    if (issue) AccessibilityInfo.announceForAccessibility(strings.settings.saveFailed);
  }, [issue]);

  /** 스위치 하나를 바꾼다. 저장에 성공하면 true. 이미 저장 중이거나 아직 읽지 못했으면 아무것도 하지 않고 false. */
  const toggle = useCallback(async (key: SettingKey, value: boolean): Promise<boolean> => {
    const before = valuesRef.current;
    if (saveRequest.current || before === null || before[key] === value) return false;
    // 이전 조회가 저장보다 늦게 끝나 방금 바꾼 값을 되돌리지 않도록 조회를 취소한다.
    loadRequest.current?.abort();
    loadRequest.current = null;
    epoch.current += 1;
    const controller = new AbortController();
    saveRequest.current = controller;
    setIssue(null);
    setSavingKey(key);
    commit({ status: 'ready', values: { ...before, [key]: value } });
    try {
      const saved = await requestWithTimeout((signal) => api.saveSettings({ [key]: value }, signal), timeoutMs, controller);
      if (saveRequest.current !== controller) return false;
      commit({ status: 'ready', values: saved });
      onSavedRef.current?.(key, saved[key]);
      return true;
    } catch {
      if (saveRequest.current === controller) {
        commit({ status: 'ready', values: before });
        setIssue({ key });
      }
      return false;
    } finally {
      if (saveRequest.current === controller) {
        saveRequest.current = null;
        epoch.current += 1;
        setSavingKey(null);
      }
    }
  }, [api, timeoutMs, commit]);

  return {
    state,
    savingKey,
    issue,
    toggle,
    clearIssue: () => setIssue(null),
    /** 다시 읽는다([다시 시도], 연결을 끊은 뒤). 저장 중이면 저장 결과가 우선이라 무시된다. */
    reload: () => setAttempt((n) => n + 1),
  };
}
