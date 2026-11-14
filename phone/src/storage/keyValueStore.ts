/**
 * 폰 안에만 두는 작은 값(첫 설정 완료 여부, '이동 일정이에요' 예외 이름, 알림함·알림 권한을 물었는지)을 읽고 쓰는 자리. 비밀 값은 두지 않는다(토큰은 expo-secure-store).
 * 메서드 이름은 AsyncStorage와 같다(`getItem`·`setItem`·`removeItem`). AsyncStorage를 부르는 곳은 이 파일 한 군데다.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// 네이티브 모듈은 처음 쓸 때 불러온다. 테스트는 이 모듈을 건드리지 않고 메모리 저장소를 넣는다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadAsyncStorage = () => (require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage')).default;

// async라서 모듈을 불러오지 못해도 던지지 않고 거부(reject)된다. 부르는 쪽은 catch로 다룬다.
export const deviceStore: KeyValueStore = {
  getItem: async (key) => loadAsyncStorage().getItem(key),
  setItem: async (key, value) => loadAsyncStorage().setItem(key, value),
  removeItem: async (key) => loadAsyncStorage().removeItem(key),
};

/** 메모리에만 두는 저장소(테스트·저장소가 막힌 환경). `dump()`로 지금 든 값을 본다. */
export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
    dump: () => Object.fromEntries(data),
  };
}
