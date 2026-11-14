import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { schedulePlacesApi, type SchedulePlaceChange, type SchedulePlacesApi, type SetupSchedule } from './schedulePlacesApi';

export type ScheduleLoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; anchor: string; schedules: SetupSchedule[] };

/**
 * 선택한 캘린더의 일정과 장소 보정을 읽고 저장한다. 3단계 화면과 오늘·가족 탭이 같이 쓴다.
 * - 화면이 포커스를 얻을 때마다 새로 읽는다(장소·채비·가족 화면에서 돌아올 때 반영).
 * - 새 조회가 시작되거나 저장이 끝나기 전에 이전 조회가 오면 그 응답은 버린다(controller가 아직 현재 것인지 확인).
 * - 저장은 한 번에 하나만 둔다. 4xx는 일정이 바뀐 것이라 다시 읽고, 그 밖의 실패는 같은 저장을 다시 시도하게 한다.
 * enabled가 false면 요청하지 않고 loading으로 둔다(권한 없음 등).
 */
export function useSchedulePlaces({
  api = schedulePlacesApi,
  timeoutMs = REQUEST_TIMEOUT_MS,
  enabled = true,
}: { api?: SchedulePlacesApi; timeoutMs?: number; enabled?: boolean } = {}) {
  const [load, setLoad] = useState<ScheduleLoadState>({ status: 'loading' });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveIssue, setSaveIssue] = useState<'retry' | 'reload' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const retryLast = useRef<(() => void) | null>(null);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoad({ status: 'loading' });
    void requestWithTimeout((signal) => api.fetchSchedules(signal), timeoutMs, controller).then(
      (data) => { if (loadRequest.current === controller) setLoad({ status: 'ready', anchor: data.anchor, schedules: data.schedules }); },
      () => { if (loadRequest.current === controller) setLoad({ status: 'error' }); },
    );
    return () => {
      loadRequest.current = null;
      controller.abort();
      const pending = saveRequest.current;
      saveRequest.current = null;
      pending?.abort();
      setSavingId(null);
    };
  // attempt는 사용자가 재시도할 때 포커스 조회를 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, timeoutMs, attempt, enabled]));

  useEffect(() => () => {
    const pending = saveRequest.current;
    saveRequest.current = null;
    pending?.abort();
  }, []);

  useEffect(() => {
    if (saveIssue) AccessibilityInfo.announceForAccessibility(saveIssue === 'reload' ? strings.placeSearch.scheduleChanged : strings.fillPlaces.saveFailed);
  }, [saveIssue]);

  const save = async (id: string, change: SchedulePlaceChange) => {
    if (saveRequest.current) return;
    // 조회를 끝내기 전에 저장 응답이 오면 이전 조회가 덮어쓰지 않도록 취소한다.
    loadRequest.current?.abort();
    loadRequest.current = null;
    const controller = new AbortController();
    saveRequest.current = controller;
    retryLast.current = () => void save(id, change);
    setSavingId(id);
    setSaveIssue(null);
    try {
      const updated = await requestWithTimeout((signal) => api.savePlace(id, change, signal), timeoutMs, controller);
      if (saveRequest.current === controller) setLoad((prev) => prev.status === 'ready'
        ? { ...prev, schedules: prev.schedules.map((s) => s.id === updated.id ? { ...s, ...updated } : s) } : prev);
    } catch (error) {
      if (saveRequest.current === controller) {
        setSaveIssue(isClientError(error) ? 'reload' : 'retry');
        if (isClientError(error)) { retryLast.current = null; setAttempt((n) => n + 1); }
      }
    } finally {
      if (saveRequest.current === controller) { saveRequest.current = null; setSavingId(null); }
    }
  };

  return {
    load,
    savingId,
    saving: savingId !== null,
    saveIssue,
    clearSaveIssue: () => setSaveIssue(null),
    save,
    retrySave: () => retryLast.current?.(),
    /** 조회를 처음부터 다시 한다(오류 화면의 다시 시도). */
    reload: () => setAttempt((n) => n + 1),
  };
}
