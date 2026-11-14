import { useEffect, useState } from 'react';

import { deviceStore, type KeyValueStore } from '../../storage/keyValueStore';

/** 첫 설정을 끝냈거나 건너뛴 기기에 남기는 표시. 값을 바꾸면 모든 사용자가 첫 설정부터 다시 하게 되므로 올릴 때만 바꾼다. */
export const SETUP_DONE_KEY = 'chagok.firstSetupDone.v1';

/** 저장소를 읽지 못하면 처음인 것으로 본다(첫 설정으로 보내는 쪽이 안전하다). */
export async function isSetupDone(store: KeyValueStore = deviceStore): Promise<boolean> {
  try {
    return (await store.get(SETUP_DONE_KEY)) === '1';
  } catch {
    return false;
  }
}

/** 쓰지 못해도 앱은 계속 쓸 수 있다. 다음에 열 때 첫 설정이 한 번 더 보일 뿐이다. */
export async function markSetupDone(store: KeyValueStore = deviceStore): Promise<void> {
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
