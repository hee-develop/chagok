/** 폰 안에만 두는 작은 값(첫 설정 완료 여부, 연결한 차 id)을 읽고 쓰는 자리. 비밀 값은 두지 않는다. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// 네이티브 모듈은 처음 쓸 때 불러온다. 테스트는 이 모듈을 건드리지 않고 메모리 저장소를 넣는다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadAsyncStorage = () => (require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage')).default;

export const deviceStore: KeyValueStore = {
  get: (key) => loadAsyncStorage().getItem(key),
  set: (key, value) => loadAsyncStorage().setItem(key, value),
  remove: (key) => loadAsyncStorage().removeItem(key),
};

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); },
    remove: async (key) => { data.delete(key); },
    dump: () => Object.fromEntries(data),
  };
}
