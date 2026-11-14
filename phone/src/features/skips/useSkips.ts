import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { appEventSync } from '../calendar-sync/eventSync';
import { appSkipMemory, type SkipItem, type SkipMemory } from './skipMemory';

export type UseSkipsOptions = {
  memory?: Pick<SkipMemory, 'load' | 'list' | 'subscribe' | 'sync' | 'add' | 'remove'> & Partial<Pick<SkipMemory, 'full' | 'dismissFull'>>;
  /** 이름을 지워 차에 보내는 일정이 달라졌을 때(일정을 다시 읽어 보낸다). */
  onChanged?: () => void;
};

export type SkipsStatus = 'loading' | 'ready';

const never = () => false;

/**
 * '이동 없음' 목록 화면용 훅(정책서 10.8). 폰에 받아 둔 목록을 바로 보이고(오프라인이어도 캐시), 열 때 서버와 맞춘다.
 * 지우기는 바로 목록에서 빠지고 서버에 올린다. 올리지 못하면 되살리고 `removeFailed`를 알린다.
 */
export function useSkips({ memory = appSkipMemory, onChanged = () => void appEventSync.run() }: UseSkipsOptions = {}) {
  const skips: readonly SkipItem[] = useSyncExternalStore(memory.subscribe, memory.list, memory.list);
  /** 서버가 상한이라며 이름 기억을 거절했다(아직 확인하지 않음). */
  const full = useSyncExternalStore(memory.subscribe, memory.full ?? never, memory.full ?? never);
  const [status, setStatus] = useState<SkipsStatus>('loading');
  /** 서버에서 새 목록을 받지 못했다(저장해 둔 목록을 보이는 중). */
  const [stale, setStale] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 폰에 받아 둔 목록을 읽고 서버와 맞춘다(상태 반영은 끝난 뒤에 한다). */
  const load = useCallback(async () => {
    await memory.load();
    const result = await memory.sync();
    if (!alive.current) return;
    setStale(!result.refreshed);
    setStatus('ready');
  }, [memory]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 다시 시도: 목록을 새로 받는다. */
  const refresh = useCallback(async () => {
    setStatus('loading');
    await load();
  }, [load]);

  const remove = useCallback(
    async (name: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setRemoveFailed(false);
      let failed = false;
      try {
        await memory.remove(name);
        failed = (await memory.sync()).pendingFailed;
        // 서버에 닿지 않았으면 지우지 않은 것으로 되돌린다(서버에는 아직 이름이 있다).
        if (failed) await memory.add(name);
      } catch {
        failed = true;
      }
      busyRef.current = false;
      if (!alive.current) return;
      setBusy(false);
      setRemoveFailed(failed);
      if (!failed) onChangedRef.current();
    },
    [memory],
  );

  return { skips, status, stale, busy, removeFailed, remove, refresh, full, dismissFull: memory.dismissFull ?? (() => undefined) };
}
