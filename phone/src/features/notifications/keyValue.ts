/** 알림함 같은 작은 값을 폰에 오래 두는 곳. 기본은 AsyncStorage이고 테스트가 바꾼다. 실패는 호출하는 쪽이 삼킨다(저장이 안 돼도 이번 실행 동안은 메모리로 동작). */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// 네이티브 모듈은 처음 쓸 때 불러온다(가져오는 것만으로 던지는 환경 — jest 등 — 에서 이 파일을 안전하게 가져오려고).
const native = async () => (await import('@react-native-async-storage/async-storage')).default;

export const asyncKeyValueStorage: KeyValueStorage = {
  getItem: async (key) => (await native()).getItem(key),
  setItem: async (key, value) => (await native()).setItem(key, value),
  removeItem: async (key) => (await native()).removeItem(key),
};

/** 메모리에만 두는 저장소(테스트·저장소가 막힌 환경). */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => void map.set(key, value),
    removeItem: async (key) => void map.delete(key),
  };
}
