import { createSelectionStore, type SelectionStore } from './routes/calendars.js';
import { createEventsStore, type EventsStore } from './routes/events.js';
import { createFamilyStore, type FamilyStore } from './routes/family.js';
import { createFavoritesStore, type FavoritesStore } from './routes/places.js';
import { DEFAULT_SEAT_ID, type SeatEvent } from './seats.js';

/** 캘린더 원본과 분리한 일정별 보정값. */
export type Override = { placeId: string | null; noTravel: boolean };

/**
 * 운전자 자리 하나가 가진 데이터. 일정·캘린더 선택·자주 가는 곳·가족 요청·일정별 보정과 채비가 자리별로 따로 쌓인다.
 * 앞으로 생길 장소 기억·도착 횟수·이동 없음 기억 저장소도 여기에 붙인다(자리를 지우면 함께 지워진다).
 */
export type SeatData = {
  events: EventsStore;
  selection: SelectionStore;
  /** 자주 가는 곳(집·회사·단골). 폰을 바꿔도 같은 자리에 남는 기억이다. */
  favorites: FavoritesStore;
  family: FamilyStore;
  /** 일정 id → 장소 보정·이동 없음. 폰 일정이 바뀌어 사라진 일정의 보정은 버린다(픽스처 일정은 남긴다). */
  overrides: Map<string, Override>;
  /** 일정 id → 앱에서 적은 채비 한 줄. 캘린더에는 쓰지 않고 차곡 안에만 둔다. */
  cares: Map<string, string>;
};

export type SeatDataRegistry = {
  /** 자리의 데이터. 기본 자리는 늘 있고, 그 밖의 자리는 처음 부를 때 만든다(자리가 있는지는 부르는 쪽이 확인한다). */
  get(seatId: string): SeatData;
  /**
   * 기기 id 하나의 '연결 전 버킷'. 토큰 없이 기기 id만 가진 폰(첫 설정 중)의 데이터가 쌓인다.
   * create가 false면 있는 것만 돌려주고(읽기), true면 없을 때 만든다(쓰기). 버킷 수 상한에 막혀 못 만들면 null.
   * 쓴 지 TTL이 지난 버킷은 이때 정리한다.
   */
  bucket(deviceId: string, create: boolean): SeatData | null;
  /** 저장하지 않는 빈 데이터(버킷이 아직 없는 기기의 읽기용). */
  blank(): SeatData;
  /** 이 데이터(자리·버킷·기본 자리)의 일정을 bytes 크기로 바꿔도 서버 전체 일정 저장 용량 안인가. */
  fitsEvents(data: SeatData, bytes: number): boolean;
  /** 자리를 지운다. */
  remove(seatId: string): void;
  /** 자리 이벤트(생성·교체·삭제)를 데이터에 반영한다. 연결 상태를 가진 SeatStore를 구독시킨다. */
  apply(event: SeatEvent): void;
};

type Preset = Partial<Pick<SeatData, 'events' | 'selection' | 'favorites' | 'family'>>;

/** 연결 전 버킷은 이 개수까지만 둔다. 차면 새 버킷은 만들지 않는다(있는 폰의 데이터를 밀어내지 않는다). */
export const MAX_BUCKETS = 500;
/** 연결 전 버킷은 마지막으로 쓴 지 이 시간이 지나면 버린다(7일). */
export const BUCKET_TTL_MS = 7 * 24 * 60 * 60_000;
/** 서버 전체가 저장하는 일정의 크기 상한(바이트). 넘으면 PUT /events는 429 capacity. */
export const MAX_TOTAL_EVENT_BYTES = 32 * 1024 * 1024;

export type SeatDataOptions = {
  now: () => Date;
  /** 픽스처 일정 id. 픽스처 일정의 보정·채비는 폰 일정이 바뀌어도 남긴다. */
  fixtureIds: Set<string>;
  /** 기본 자리가 쓸 저장소(테스트가 직접 넘길 수 있다). 없으면 새로 만든다. */
  defaults?: Preset;
  maxBuckets?: number;
  bucketTtlMs?: number;
  maxTotalEventBytes?: number;
};

type Bucket = { data: SeatData; lastUsedAt: number };

export function createSeatDataRegistry({
  now,
  fixtureIds,
  defaults = {},
  maxBuckets = MAX_BUCKETS,
  bucketTtlMs = BUCKET_TTL_MS,
  maxTotalEventBytes = MAX_TOTAL_EVENT_BYTES,
}: SeatDataOptions): SeatDataRegistry {
  const create = (preset: Preset = {}): SeatData => {
    const data: SeatData = {
      events: preset.events ?? createEventsStore(now),
      selection: preset.selection ?? createSelectionStore(),
      favorites: preset.favorites ?? createFavoritesStore(),
      family: preset.family ?? createFamilyStore(now),
      overrides: new Map(),
      cares: new Map(),
    };
    // 폰 일정이 교체되거나 비워지면, 더는 없는 일정 id의 보정·채비를 버린다(픽스처 id의 것은 남긴다).
    data.events.subscribe((ids) => {
      for (const id of data.overrides.keys()) if (!ids.has(id) && !fixtureIds.has(id)) data.overrides.delete(id);
      for (const id of data.cares.keys()) if (!ids.has(id) && !fixtureIds.has(id)) data.cares.delete(id);
    });
    return data;
  };
  const bySeat = new Map<string, SeatData>([[DEFAULT_SEAT_ID, create(defaults)]]);
  const buckets = new Map<string, Bucket>();
  const get = (seatId: string) => {
    let data = bySeat.get(seatId);
    if (!data) {
      data = create();
      bySeat.set(seatId, data);
    }
    return data;
  };
  const purgeBuckets = () => {
    const at = now().getTime();
    for (const [id, b] of buckets) if (b.lastUsedAt + bucketTtlMs <= at) buckets.delete(id);
  };
  /** 버킷을 꺼내 버킷 표에서 지운다(새 자리가 이어받거나 바꾸기가 반영하면 끝). */
  const takeBucket = (deviceId: string | null) => {
    if (deviceId === null) return null;
    purgeBuckets();
    const found = buckets.get(deviceId);
    buckets.delete(deviceId);
    return found?.data ?? null;
  };
  return {
    get,
    blank: () => create(),
    bucket: (deviceId, createIfMissing) => {
      purgeBuckets();
      const found = buckets.get(deviceId);
      if (found) {
        found.lastUsedAt = now().getTime();
        return found.data;
      }
      if (!createIfMissing || buckets.size >= maxBuckets) return null;
      const data = create();
      buckets.set(deviceId, { data, lastUsedAt: now().getTime() });
      return data;
    },
    fitsEvents: (data, bytes) => {
      let total = 0;
      for (const d of bySeat.values()) total += d.events.bytes();
      for (const b of buckets.values()) total += b.data.events.bytes();
      return total - data.events.bytes() + bytes <= maxTotalEventBytes;
    },
    remove: (seatId) => {
      if (seatId !== DEFAULT_SEAT_ID) bySeat.delete(seatId);
    },
    apply: (event) => {
      if (event.type === 'removed') {
        bySeat.delete(event.seatId);
      } else if (event.type === 'created') {
        // 그 요청의 기기 id 버킷(연결 전에 이 폰이 모은 일정·선택·보정·채비·자주 가는 곳)을 새 자리가 이어받는다.
        // 기본 자리(픽스처·데모 경로)와 다른 폰의 버킷은 가져가지 않는다.
        bySeat.set(event.seatId, takeBucket(event.deviceId) ?? create());
      } else {
        // 폰 바꾸기: 옛 폰의 캘린더에서 온 일정·캘린더 선택·보정·채비는 버리고, 새 폰의 버킷이 있으면 그 일정·선택·보정을 반영한다
        // (없으면 '받았고 0건' 상태). 자주 가는 곳 같은 기억과 가족 요청은 둔다.
        const data = get(event.seatId);
        const bucket = takeBucket(event.deviceId);
        data.events.replace(bucket?.events.get()?.events ?? []);
        data.selection = bucket?.selection ?? createSelectionStore();
        data.overrides = new Map(bucket?.overrides);
        data.cares = new Map(bucket?.cares);
      }
    },
  };
}
