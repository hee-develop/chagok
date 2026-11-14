import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { appEventSync, type EventSync } from '../calendar-sync/eventSync';
import { UNDO_VISIBLE_MS } from '../calendar-sync/useTravelMark';
import { appSkipMemory, type SkipMemory } from '../skips/skipMemory';
import { schedulePlacesApi, type SchedulePlaceChange, type SchedulePlacesApi, type SetupSchedule } from './schedulePlacesApi';

/** 방금 누른 [이동 없음]: 같은 이름 일정을 앞으로 차에 보내지 않는다는 안내와 [되돌리기]를 보이는 동안의 상태. `keepName`은 누르기 전부터 기억하던 이름이다(되돌려도 기억은 그대로). */
export type SkipNotice = { id: string; title: string; keepName: boolean };

export type ScheduleLoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; anchor: string; schedules: SetupSchedule[] };

/**
 * 선택한 캘린더의 일정과 장소 보정을 읽고 저장한다. 3단계 화면과 오늘·가족 탭이 같이 쓴다.
 * - 화면이 포커스를 얻을 때마다 새로 읽는다(장소·채비·가족 화면에서 돌아올 때 반영). 이미 읽어 둔 목록이 있으면 다시 읽는 동안 그대로 보여 탭을 오갈 때 깜빡이지 않는다.
 * - 화면이 포커스를 잃으면 **조회만** 취소한다. 이미 보낸 저장은 끝까지 보내고(탭을 바꿨다고 저장이 조용히 사라지지 않게), 언마운트될 때만 취소한다.
 *   저장이 아직 끝나지 않았는데 다시 포커스를 얻으면 그 저장이 끝난 뒤에 읽는다(저장 전 상태를 읽어 화면에 되돌리지 않게).
 * - 새 조회가 시작되거나 저장이 끝나기 전에 이전 조회가 오면 그 응답은 버린다(controller가 아직 현재 것인지 확인).
 * - 저장은 한 번에 하나만 둔다. 4xx는 일정이 바뀐 것이라 다시 읽고, 그 밖의 실패는 같은 저장을 다시 시도하게 한다.
 * enabled가 false면 요청하지 않는다(권한 없음 등).
 * 일정에 [이동 없음]을 고르면(`{ noTravel: true }`) 같은 이름을 기억하고(`schedulePlacesApi.savePlace`) 안내와 10초 [되돌리기]를 `skipNotice`로 낸다. 되돌리면
 * 일정별 이동 없음과 이름 기억을 함께 되돌린다(`undoSkipNotice`). 서버가 기억 상한이라며 거절하면 `memoryFull`로 알린다(3단계·오늘 탭이 같은 `NoTravelNotices`를 보인다).
 */
export function useSchedulePlaces({
  api = schedulePlacesApi,
  timeoutMs = REQUEST_TIMEOUT_MS,
  enabled = true,
  skips = appSkipMemory,
  undoVisibleMs = UNDO_VISIBLE_MS,
  sync = appEventSync,
}: {
  api?: SchedulePlacesApi;
  timeoutMs?: number;
  enabled?: boolean;
  skips?: Pick<SkipMemory, 'has' | 'full' | 'dismissFull' | 'subscribe'>;
  undoVisibleMs?: number;
  /** 일정 보내기. 서버로 일정을 보냈다는 결과가 오면 서버가 아는 일정이 달라졌을 수 있어(이름으로 기억한 일정이 빠짐 등) 목록을 다시 읽는다. */
  sync?: Pick<EventSync, 'subscribe'>;
} = {}) {
  const [load, setLoad] = useState<ScheduleLoadState>({ status: 'loading' });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveIssue, setSaveIssue] = useState<'retry' | 'reload' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  /** 진행 중인 저장이 끝나면 풀리는 약속(실패해도 거부하지 않는다). */
  const saveDone = useRef<Promise<void> | null>(null);
  const retryLast = useRef<(() => void) | null>(null);
  const [skipNotice, setSkipNotice] = useState<SkipNotice | null>(null);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 마지막으로 읽은 일정(저장하는 일정의 제목을 알아내는 데 쓴다). */
  const schedulesRef = useRef<SetupSchedule[]>([]);
  useEffect(() => {
    schedulesRef.current = load.status === 'ready' ? load.schedules : [];
  });
  const memoryFull = useSyncExternalStore(skips.subscribe, skips.full, skips.full);

  const showSkipNotice = (notice: SkipNotice | null) => {
    if (skipTimer.current !== null) clearTimeout(skipTimer.current);
    skipTimer.current = null;
    setSkipNotice(notice);
    if (notice) skipTimer.current = setTimeout(() => setSkipNotice(null), undoVisibleMs);
  };

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    void (async () => {
      await saveDone.current;
      if (loadRequest.current !== controller) return;
      try {
        const data = await requestWithTimeout((signal) => api.fetchSchedules(signal), timeoutMs, controller);
        if (loadRequest.current === controller) setLoad({ status: 'ready', anchor: data.anchor, schedules: data.schedules });
      } catch {
        if (loadRequest.current === controller) setLoad({ status: 'error' });
      }
    })();
    return () => {
      loadRequest.current = null;
      controller.abort();
    };
  // attempt는 사용자가 재시도할 때 포커스 조회를 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, timeoutMs, attempt, enabled]));

  useEffect(() => {
    if (!enabled) return undefined;
    return sync.subscribe((result) => {
      if (result === 'sent') setAttempt((n) => n + 1);
    });
  }, [sync, enabled]);

  useEffect(() => () => {
    const pending = saveRequest.current;
    saveRequest.current = null;
    pending?.abort();
    if (skipTimer.current !== null) clearTimeout(skipTimer.current);
  }, []);

  useEffect(() => {
    if (saveIssue) AccessibilityInfo.announceForAccessibility(saveIssue === 'reload' ? strings.placeSearch.scheduleChanged : strings.fillPlaces.saveFailed);
  }, [saveIssue]);

  const save = (id: string, change: SchedulePlaceChange): Promise<void> => {
    if (saveRequest.current) return Promise.resolve();
    // [이동 없음]이면 이름을 기억하므로 제목과, 이미 기억하던 이름인지(되돌려도 기억은 그대로 둔다)를 저장 전에 본다. 다른 저장을 시작하면 이전 안내는 닫는다.
    const skipTitle = 'noTravel' in change ? schedulesRef.current.find((s) => s.id === id)?.title : undefined;
    const keepName = skipTitle !== undefined && skips.has(skipTitle);
    showSkipNotice(null);
    // 조회를 끝내기 전에 저장 응답이 오면 이전 조회가 덮어쓰지 않도록 취소한다.
    loadRequest.current?.abort();
    loadRequest.current = null;
    const controller = new AbortController();
    saveRequest.current = controller;
    retryLast.current = () => void save(id, change);
    setSavingId(id);
    setSaveIssue(null);
    const done = (async () => {
      try {
        const updated = await requestWithTimeout((signal) => api.savePlace(id, change, signal), timeoutMs, controller);
        if (saveRequest.current === controller) {
          setLoad((prev) => prev.status === 'ready'
            ? { ...prev, schedules: prev.schedules.map((s) => s.id === updated.id ? { ...s, ...updated } : s) } : prev);
          if (skipTitle !== undefined) showSkipNotice({ id, title: skipTitle, keepName });
        }
      } catch (error) {
        if (saveRequest.current === controller) {
          setSaveIssue(isClientError(error) ? 'reload' : 'retry');
          if (isClientError(error)) { retryLast.current = null; setAttempt((n) => n + 1); }
        }
      } finally {
        if (saveRequest.current === controller) { saveRequest.current = null; setSavingId(null); }
      }
    })();
    saveDone.current = done;
    void done.then(() => { if (saveDone.current === done) saveDone.current = null; });
    return done;
  };

  /** 방금 누른 [이동 없음]을 되돌린다: 일정별 이동 없음과 이름 기억을 함께 되돌린다. */
  const undoSkipNotice = (): Promise<void> => {
    if (!skipNotice || saveRequest.current) return Promise.resolve();
    const { id, title, keepName } = skipNotice;
    loadRequest.current?.abort();
    loadRequest.current = null;
    const controller = new AbortController();
    saveRequest.current = controller;
    retryLast.current = () => void undoSkipNotice();
    setSavingId(id);
    setSaveIssue(null);
    const done = (async () => {
      try {
        const updated = await requestWithTimeout((signal) => api.undoNoTravel(id, title, keepName, signal), timeoutMs, controller);
        if (saveRequest.current === controller) {
          setLoad((prev) => prev.status === 'ready'
            ? { ...prev, schedules: prev.schedules.map((s) => s.id === updated.id ? { ...s, ...updated } : s) } : prev);
          showSkipNotice(null);
        }
      } catch (error) {
        if (saveRequest.current === controller) {
          setSaveIssue(isClientError(error) ? 'reload' : 'retry');
          if (isClientError(error)) { retryLast.current = null; showSkipNotice(null); setAttempt((n) => n + 1); }
        }
      } finally {
        if (saveRequest.current === controller) { saveRequest.current = null; setSavingId(null); }
      }
    })();
    saveDone.current = done;
    void done.then(() => { if (saveDone.current === done) saveDone.current = null; });
    return done;
  };

  return {
    load,
    savingId,
    saving: savingId !== null,
    saveIssue,
    clearSaveIssue: () => setSaveIssue(null),
    save,
    /** 방금 누른 [이동 없음] 안내(없으면 null). 10초 뒤 저절로 사라진다. */
    skipNotice,
    undoSkipNotice,
    /** 서버가 기억 상한이라며 이름 기억을 거절했고 아직 확인하지 않았다. */
    memoryFull,
    dismissFull: skips.dismissFull,
    retrySave: () => retryLast.current?.(),
    /** 조회를 처음부터 다시 한다(오류 화면의 다시 시도, 일정이 달라진 뒤). */
    reload: () => setAttempt((n) => n + 1),
  };
}
