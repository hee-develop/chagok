import { useEffect, useRef, useState } from 'react';

import { markTravelByTitle, undoMarkTravel, type TravelMarkResult } from './travelMark';

/** 바꾼 직후 '되돌리기'를 보이는 시간. */
export const UNDO_VISIBLE_MS = 10_000;

export type TravelMarkIssue = 'mark' | 'undo';

export type TravelMarkOptions = {
  mark?: (title: string) => Promise<TravelMarkResult>;
  undo?: (title: string) => Promise<TravelMarkResult>;
  undoVisibleMs?: number;
  /** 바꾸기·되돌리기가 서버 일정에 반영된 뒤(화면이 서버 목록을 다시 불러오는 자리). */
  onChanged?: () => void;
};

/**
 * 거른 일정을 "이동 일정이에요"로 바꾸는 흐름: 누르면 확인(`confirming`) → [바꾸기]로 저장 → `UNDO_VISIBLE_MS` 동안 '되돌리기'(`undoable`).
 * 화면은 `FilteredEventCard`(줄+확인)와 `TravelMarkNotice`(되돌리기·실패 안내)에 이 값을 그대로 넘기면 된다.
 */
export function useTravelMark({
  mark = markTravelByTitle,
  undo = undoMarkTravel,
  undoVisibleMs = UNDO_VISIBLE_MS,
  onChanged,
}: TravelMarkOptions = {}) {
  const [confirming, setConfirming] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoable, setUndoable] = useState<{ title: string } | null>(null);
  const [issue, setIssue] = useState<TravelMarkIssue | null>(null);
  const busyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimer();
    };
  }, []);

  const run = async (action: () => Promise<TravelMarkResult>): Promise<TravelMarkResult> => {
    busyRef.current = true;
    setBusy(true);
    setIssue(null);
    clearTimer();
    let result: TravelMarkResult = 'failed';
    try {
      result = await action();
    } catch {
      // 실패로 본다.
    }
    busyRef.current = false;
    if (alive.current) setBusy(false);
    return result;
  };

  return {
    /** 확인을 기다리는 줄(없으면 null). */
    confirming,
    /** 저장·되돌리는 중. 이 동안 다른 저장 버튼을 막는다. */
    busy,
    /** 방금 바꾼 이름. `UNDO_VISIBLE_MS` 동안 '되돌리기'를 보인다. */
    undoable,
    issue,
    ask(id: string, title: string) {
      if (busyRef.current) return;
      setIssue(null);
      setConfirming({ id, title });
    },
    cancel() {
      setConfirming(null);
    },
    async confirm() {
      if (!confirming || busyRef.current) return;
      const { title } = confirming;
      setUndoable(null);
      const result = await run(() => mark(title));
      if (!alive.current) return;
      setConfirming(null);
      if (result === 'failed') {
        setIssue('mark');
        return;
      }
      setUndoable({ title });
      timer.current = setTimeout(() => setUndoable(null), undoVisibleMs);
      onChangedRef.current?.();
    },
    async undoNow() {
      if (!undoable || busyRef.current) return;
      const { title } = undoable;
      const result = await run(() => undo(title));
      if (!alive.current) return;
      setUndoable(null);
      if (result === 'failed') setIssue('undo');
      onChangedRef.current?.();
    },
  };
}
