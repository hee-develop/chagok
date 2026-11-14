import { MAX_MEMORIES } from './placeSearch/limits.js';

/** 이름 비교용 정규화: 앞뒤 공백 제거, 연속 공백 하나로, 소문자. 목 장소 이름의 '완전 일치' 판정과 장소 기억의 이름 키가 같은 규칙을 쓴다. */
export const normalizePlaceName = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** 기억한 장소. 주소는 모를 수 있다. */
export type MemoryPlace = { name: string; address: string | null; lat: number; lng: number };

/** 자리 하나의 장소 기억 한 줄: 이름 → 장소, 애매 여부(처음 고를 때 후보가 둘 이상이었으면 true). 정책서 11장 '장소 기억'. */
export type PlaceMemoryEntry = { name: string; place: MemoryPlace; ambiguous: boolean; updatedAt: string };

export type PlaceMemoryStore = {
  get(name: string): PlaceMemoryEntry | null;
  /** 같은 이름(정규화해서 같은 것)이 있으면 덮어쓴다. 가득 차면 가장 오래 전에 쓴 기억부터 버린다. */
  put(input: { name: string; place: MemoryPlace; ambiguous: boolean }): PlaceMemoryEntry;
  /** 지웠으면 true. */
  delete(name: string): boolean;
  /** 최근에 쓴 것부터. */
  list(): PlaceMemoryEntry[];
  size(): number;
};

/** 운전자 자리 하나의 장소 기억(메모리). SeatData에 붙어 자리를 지우면 함께 지워지고, 폰을 바꿔도 같은 자리에 남는다. */
export function createPlaceMemoryStore(now: () => Date, max: number = MAX_MEMORIES): PlaceMemoryStore {
  // Map의 삽입 순서 = 쓴 순서(다시 쓰면 맨 뒤로).
  const entries = new Map<string, PlaceMemoryEntry>();
  return {
    get: (name) => entries.get(normalizePlaceName(name)) ?? null,
    put: ({ name, place, ambiguous }) => {
      const key = normalizePlaceName(name);
      const entry: PlaceMemoryEntry = {
        name: name.trim().replace(/\s+/g, ' '),
        place: { ...place },
        ambiguous,
        updatedAt: now().toISOString(),
      };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > Math.max(1, max)) entries.delete(entries.keys().next().value as string);
      return entry;
    },
    delete: (name) => entries.delete(normalizePlaceName(name)),
    list: () => [...entries.values()].reverse(),
    size: () => entries.size,
  };
}
