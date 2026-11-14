import { useEffect, useState } from 'react';

import { deviceStore, type KeyValueStore } from '../../storage/keyValueStore';

/** 첫 설정을 끝냈거나 건너뛴 기기에 남기는 표시. 값을 바꾸면 모든 사용자가 첫 설정부터 다시 하게 되므로 올릴 때만 바꾼다. */
export const SETUP_DONE_KEY = 'chagok.firstSetupDone.v1';

/**
 * 이번 실행에서 끝냈거나 건너뛰었는가. 저장소에 쓰지 못해도(실패·느림) 곧바로 탭으로 갈 수 있게 메모리에도 둔다.
 * 저장이 실패하면 다음에 앱을 열 때 첫 설정이 한 번 더 보일 뿐이다.
 */
let doneThisRun = false;

/** 테스트가 실행 사이의 메모리 표시를 비운다. */
export const resetSetupDoneForTests = () => {
  doneThisRun = false;
};

/** 저장소를 읽지 못하면 처음인 것으로 본다(첫 설정으로 보내는 쪽이 안전하다). 이번 실행에서 끝냈으면 저장소를 읽지 않는다. */
export async function isSetupDone(store: KeyValueStore = deviceStore): Promise<boolean> {
  if (doneThisRun) return true;
  try {
    return (await store.get(SETUP_DONE_KEY)) === '1';
  } catch {
    return false;
  }
}

/** 메모리에 먼저 표시하고 저장소에 쓴다. 쓰지 못해도 던지지 않는다. */
export async function markSetupDone(store: KeyValueStore = deviceStore): Promise<void> {
  doneThisRun = true;
  try {
    await store.set(SETUP_DONE_KEY, '1');
  } catch {
    // 위 설명 참고
  }
}

export type SetupGate = 'loading' | 'done' | 'needed';

/** 앱을 열 때 탭으로 갈지 첫 설정으로 갈지. 마운트될 때 한 번만 읽는다. */
export function useSetupGate(store: KeyValueStore = deviceStore): SetupGate {
  const [gate, setGate] = useState<SetupGate>('loading');
  useEffect(() => {
    let cancelled = false;
    void isSetupDone(store).then((done) => {
      if (!cancelled) setGate(done ? 'done' : 'needed');
    });
    return () => { cancelled = true; };
  }, [store]);
  return gate;
}
