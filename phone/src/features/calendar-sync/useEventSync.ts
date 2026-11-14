import { useEffect } from 'react';
import { AppState } from 'react-native';

import { appEventSync, type EventSync } from './eventSync';

/** 앱을 열 때와 앱이 앞으로 올 때(AppState active) 일정을 서버에 보낸다. */
export function useEventSync(sync: EventSync = appEventSync) {
  useEffect(() => {
    void sync.run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync.run();
    });
    return () => {
      subscription.remove();
      sync.stop();
    };
  }, [sync]);
}
