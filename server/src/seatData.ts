import { createArrivalsStore, type ArrivalsStore } from './arrivals.js';
import { createSelectionStore, type SelectionStore } from './routes/calendars.js';
import { createEventsStore, type EventsStore } from './routes/events.js';
import { createFamilyStore, type FamilyStore } from './routes/family.js';
import { createPlaceMemoryStore, type PlaceMemoryStore } from './placeMemory.js';
import type { StoredPlace } from './placeSnapshot.js';
import { MAX_BUCKET_MEMORIES, MAX_MEMORIES } from './placeSearch/limits.js';
import { createFavoritesStore, type FavoritesStore } from './routes/places.js';
import { DEFAULT_SEAT_ID, type SeatEvent } from './seats.js';

/** 캘린더 원본과 분리한 일정별 보정값. */
export type Override = { place: StoredPlace | null; noTravel: boolean };

/**
 * 운전자 자리 하나가 가진 데이터. 일정·캘린더 선택·자주 가는 곳·가족 요청·일정별 보정과 채비·장소 기억·도착 횟수가 자리별로 따로 쌓인다.
 * 앞으로 생길 이동 없음 기억 저장소도 여기에 붙인다(자리를 지우면 함께 지워진다).
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
  /** 장소 기억: 일정의 장소 칸 글자(또는 들은 이름) → 장소, 애매 여부. 폰을 바꿔도 남고 연결을 끊으면 자리와 함께 지워진다. */
  memory: PlaceMemoryStore;
  /** 장소별 도착 횟수(장소·횟수·마지막 날짜만). 폰을 바꿔도 같은 자리에 남는 기억이다. */
  arrivals: ArrivalsStore;
};

/**
 * 자리 데이터 항목마다 **폰 바꾸기(`replaced`) 때 어떻게 되는지** 선언한다. 자리를 지울 때(연결 끊기·차 초기화·무소식 정리)는 항목에 상관없이
 * 자리 데이터 전체가 한 번에 버려진다(`apply('removed')`가 `bySeat`에서 자리를 지움). 그래서 새 항목을 `SeatData`에 더하면
 * - 지우는 코드를 따로 짤 필요가 없고(자리 데이터 안에 두기만 하면 연결 끊기·초기화·정리에 자동으로 포함된다),
 * - 이 표에 폰 바꾸기 때의 처리를 **반드시** 적어야 한다(`Record<keyof SeatData, …>`라 빠뜨리면 타입 오류).
 * `keep`은 기억이라 폰을 바꿔도 남기고(정책서 10.1·10.9), `reset`은 옛 폰의 캘린더에서 온 것이라 비우고 새 폰의 연결 전 버킷으로 바꾼다.
 * `reset` 항목은 `apply('replaced')`가 직접 비운다(항목마다 비우는 방법이 달라 아래 구현을 같이 고친다).
 */
export const SEAT_DATA_POLICY: Record<keyof SeatData, 'keep' | 'reset'> = {
  events: 'reset',
  selection: 'reset',
  favorites: 'keep',
  family: 'keep',
  overrides: 'reset',
  cares: 'reset',
  memory: 'keep',
  arrivals: 'keep',
};

export type BucketDenied = 'rate-limited';
export type SeatDataRegistry = {
  /** 자리의 데이터. 기본 자리는 늘 있고, 그 밖의 자리는 처음 부를 때 만든다(자리가 있는지는 부르는 쪽이 확인한다). */
  get(seatId: string): SeatData;
  /**
   * 기기 id 하나의 '연결 전 버킷'을 **있을 때만, 쓰지 않고** 돌려준다(읽기용. TTL을 새로 시작하지 않는다). 쓴 지 TTL이 지난 버킷은 이때 정리한다.
   */
  peekBucket(deviceId: string): SeatData | null;
  /**
   * 쓰기용: 버킷을 열어 마지막으로 쓴 시각을 지금으로 한다(TTL은 쓰기만 새로 시작한다). 없으면 만든다. 만들 때는
   * 요청 주소(source)별 속도 제한을 보고(`rate-limited`), 버킷 수가 가득 차면 가장 오래 쓰지 않은 버킷(빈 버킷 먼저)을 밀어내고 만든다.
   * 본문 검증을 통과한 쓰기에서만 부른다(잘못된 요청이 버킷을 만들지 않도록).
   */
  openBucket(deviceId: string, source: string): { ok: true; data: SeatData } | { ok: false; reason: BucketDenied };
  /** 저장하지 않는 빈 데이터(버킷이 아직 없는 기기·읽을 자리를 정할 수 없는 읽기용). */
  blank(): SeatData;
  /**
   * 이 데이터의 일정을 bytes 크기로 바꿔도 되는지 확인하고, 연결 전 버킷이면 필요한 만큼 다른 버킷(가장 오래 쓰지 않은 것부터)을 밀어내
   * 자리를 낸다. 연결된 자리(기본 자리 포함)와 연결 전 버킷은 용량 예산이 따로라 서로 영향을 주지 않고, 연결된 자리는 밀어내지 않는다.
   * 버킷 하나의 크기 상한도 여기서 본다.
   */
  reserveEvents(data: SeatData, bytes: number): boolean;
  /** 자리를 지운다. */
  remove(seatId: string): void;
  /**
   * 만료된 것을 지금 정리한다(정기 작업): 모든 자리(기본 자리 포함)와 연결 전 버킷의 날짜 지난 일정을 버리고(일정이 바뀌면 그 일정에 딸린 보정·채비도 따라 지워진다),
   * TTL이 지난 연결 전 버킷과 오래된 버킷 생성 기록을 버린다. 일정이 날짜가 지나 지워질 때 그 일정에 붙은 가족 요청(`family`)과 낡은 도착 일정 id 기억(`arrivals`)도 함께 지운다.
   * 지운 일정·가족 요청·도착 일정 id 기억 수와 버린 버킷 수.
   */
  purgeExpired(): { eventsRemoved: number; bucketsDropped: number; familyRequestsRemoved: number; arrivalKeysForgotten: number };
  /** 자리 이벤트(생성·교체·삭제)를 데이터에 반영한다. 연결 상태를 가진 SeatStore를 구독시킨다. */
  apply(event: SeatEvent): void;
};

type Preset = Partial<Pick<SeatData, 'events' | 'selection' | 'favorites' | 'family'>>;

/** 연결 전 버킷은 이 개수까지만 둔다. 차면 가장 오래 쓰지 않은 버킷(빈 버킷 먼저)을 밀어내고 새로 만든다. */
export const MAX_BUCKETS = 500;
/** 연결 전 버킷은 마지막으로 **쓴** 지 이 시간이 지나면 버린다(7일). 읽기는 TTL을 새로 시작하지 않는다. */
export const BUCKET_TTL_MS = 7 * 24 * 60 * 60_000;
/** 연결된 자리(기본 자리 포함)가 저장하는 일정 크기의 서버 전체 상한(바이트). 넘으면 PUT /events는 429 capacity. */
export const MAX_SEAT_EVENT_BYTES = 32 * 1024 * 1024;
/** 연결 전 버킷이 저장하는 일정 크기의 서버 전체 상한(바이트). 연결된 자리 예산과 따로라 버킷이 가득 차도 연결된 자리의 저장은 막히지 않는다. */
export const MAX_BUCKET_EVENT_BYTES = 32 * 1024 * 1024;
/** 버킷 하나가 저장할 수 있는 일정 크기 상한(바이트). 하루·내일 일정으로는 충분히 크다. */
export const MAX_EVENT_BYTES_PER_BUCKET = 512 * 1024;
/** 한 요청 주소가 BUCKET_CREATE_WINDOW_MS 안에 새로 만들 수 있는 버킷 수(한 집 공유기 뒤의 폰 몇 대는 넉넉히 들어간다). */
export const BUCKET_CREATE_WINDOW_MS = 10 * 60_000;
export const MAX_BUCKET_CREATES_PER_SOURCE = 10;

export type SeatDataOptions = {
  now: () => Date;
  /** 픽스처 일정 id. 픽스처 일정의 보정·채비는 폰 일정이 바뀌어도 남긴다. */
  fixtureIds: Set<string>;
  /** 기본 자리가 쓸 저장소(테스트가 직접 넘길 수 있다). 없으면 새로 만든다. */
  defaults?: Preset;
  maxBuckets?: number;
  bucketTtlMs?: number;
  maxSeatEventBytes?: number;
  maxBucketEventBytes?: number;
  maxEventBytesPerBucket?: number;
  bucketCreateWindowMs?: number;
  maxBucketCreatesPerSource?: number;
};

type Bucket = { data: SeatData; lastWrittenAt: number };

export function createSeatDataRegistry({
  now,
  fixtureIds,
  defaults = {},
  maxBuckets = MAX_BUCKETS,
  bucketTtlMs = BUCKET_TTL_MS,
  maxSeatEventBytes = MAX_SEAT_EVENT_BYTES,
  maxBucketEventBytes = MAX_BUCKET_EVENT_BYTES,
  maxEventBytesPerBucket = MAX_EVENT_BYTES_PER_BUCKET,
  bucketCreateWindowMs = BUCKET_CREATE_WINDOW_MS,
  maxBucketCreatesPerSource = MAX_BUCKET_CREATES_PER_SOURCE,
}: SeatDataOptions): SeatDataRegistry {
  const create = (preset: Preset = {}, memoryMax: number = MAX_MEMORIES): SeatData => {
    const data: SeatData = {
      events: preset.events ?? createEventsStore(now),
      selection: preset.selection ?? createSelectionStore(),
      favorites: preset.favorites ?? createFavoritesStore(),
      family: preset.family ?? createFamilyStore(now),
      overrides: new Map(),
      cares: new Map(),
      memory: createPlaceMemoryStore(now, memoryMax),
      arrivals: createArrivalsStore(now),
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
  const bucketCreates = new Map<string, number[]>();
  const purgeBuckets = () => {
    const at = now().getTime();
    let dropped = 0;
    for (const [id, b] of buckets) {
      if (b.lastWrittenAt + bucketTtlMs > at) continue;
      buckets.delete(id);
      dropped += 1;
    }
    for (const [source, list] of bucketCreates) {
      const recent = list.filter((t) => t > at - bucketCreateWindowMs);
      if (recent.length === 0) bucketCreates.delete(source);
      else bucketCreates.set(source, recent);
    }
    return dropped;
  };
  /** 버킷을 꺼내 버킷 표에서 지운다(새 자리가 이어받거나 바꾸기가 반영하면 끝). */
  const takeBucket = (deviceId: string | null) => {
    if (deviceId === null) return null;
    purgeBuckets();
    const found = buckets.get(deviceId);
    buckets.delete(deviceId);
    return found?.data ?? null;
  };
  /** 아무것도 모으지 않은 데이터인가(일정이 없고 선택·보정·채비·자주 가는 곳·가족 요청이 없다). 밀어낼 때 먼저 고른다. */
  const isEmpty = (d: SeatData) => {
    const saved = d.favorites.get();
    return (
      (d.events.get()?.events.length ?? 0) === 0 &&
      d.selection.get() === null &&
      d.overrides.size === 0 &&
      d.cares.size === 0 &&
      d.memory.size() === 0 &&
      d.arrivals.list().length === 0 &&
      saved.home === null &&
      saved.work === null &&
      saved.others.length === 0 &&
      d.family.list().length === 0
    );
  };
  /** 밀어낼 버킷: 가장 오래 쓰지 않은 것, 빈 버킷이 있으면 그중 가장 오래된 것. except는 지금 쓰는 버킷. */
  const evictable = (except: string | null, needBytes: boolean) => {
    let pick: [string, Bucket, boolean] | null = null;
    for (const [id, b] of buckets) {
      if (id === except) continue;
      if (needBytes && b.data.events.bytes() === 0) continue;
      const empty = isEmpty(b.data);
      if (pick === null || (empty && !pick[2]) || (empty === pick[2] && b.lastWrittenAt < pick[1].lastWrittenAt)) pick = [id, b, empty];
    }
    return pick?.[0] ?? null;
  };
  const bucketBytes = () => {
    let total = 0;
    for (const b of buckets.values()) total += b.data.events.bytes();
    return total;
  };
  const bucketIdOf = (data: SeatData) => {
    for (const [id, b] of buckets) if (b.data === data) return id;
    return null;
  };
  return {
    get,
    peekBucket: (deviceId) => {
      purgeBuckets();
      return buckets.get(deviceId)?.data ?? null;
    },
    openBucket: (deviceId, source) => {
      purgeBuckets();
      const at = now().getTime();
      const found = buckets.get(deviceId);
      if (found) {
        found.lastWrittenAt = at;
        return { ok: true, data: found.data };
      }
      const recent = bucketCreates.get(source) ?? [];
      if (recent.length >= maxBucketCreatesPerSource) return { ok: false, reason: 'rate-limited' };
      bucketCreates.set(source, [...recent, at]);
      // 가득 차면 새 기기를 거절하기 전에 가장 오래 쓰지 않은 버킷(빈 버킷 먼저)을 밀어낸다.
      while (buckets.size >= Math.max(1, maxBuckets)) {
        const victim = evictable(null, false);
        if (victim === null) break;
        buckets.delete(victim);
      }
      const data = create({}, MAX_BUCKET_MEMORIES);
      buckets.set(deviceId, { data, lastWrittenAt: at });
      return { ok: true, data };
    },
    blank: () => create(),
    reserveEvents: (data, bytes) => {
      const own = bucketIdOf(data);
      if (own === null) {
        // 연결된 자리(기본 자리 포함). 기본 자리가 아닌 버킷 밖의 데이터(저장하지 않는 빈 데이터)는 쓰지 못한다.
        let total = 0;
        let known = false;
        for (const d of bySeat.values()) {
          if (d === data) known = true;
          total += d.events.bytes();
        }
        return known && total - data.events.bytes() + bytes <= maxSeatEventBytes;
      }
      if (bytes > maxEventBytesPerBucket || bytes > maxBucketEventBytes) return false; // 혼자서 상한을 넘으면 다른 버킷을 밀어내지 않는다
      // 버킷 예산이 모자라면 다른 버킷을 오래 쓰지 않은 순으로 밀어내 자리를 낸다(연결된 자리는 건드리지 않는다).
      while (bucketBytes() - data.events.bytes() + bytes > maxBucketEventBytes) {
        const victim = evictable(own, true);
        if (victim === null) return false;
        buckets.delete(victim);
      }
      return true;
    },
    remove: (seatId) => {
      if (seatId !== DEFAULT_SEAT_ID) bySeat.delete(seatId);
    },
    purgeExpired: () => {
      const bucketsDropped = purgeBuckets();
      let eventsRemoved = 0;
      let familyRequestsRemoved = 0;
      let arrivalKeysForgotten = 0;
      for (const d of [...bySeat.values(), ...[...buckets.values()].map((b) => b.data)]) {
        eventsRemoved += d.events.purgeExpired();
        familyRequestsRemoved += d.family.purgeExpired();
        arrivalKeysForgotten += d.arrivals.purgeExpired();
      }
      return { eventsRemoved, bucketsDropped, familyRequestsRemoved, arrivalKeysForgotten };
    },
    apply: (event) => {
      if (event.type === 'removed') {
        bySeat.delete(event.seatId);
      } else if (event.type === 'created') {
        // 그 요청의 기기 id 버킷(연결 전에 이 폰이 모은 일정·선택·보정·채비·자주 가는 곳)을 새 자리가 이어받는다.
        // 기본 자리(픽스처·데모 경로)와 다른 폰의 버킷은 가져가지 않는다.
        const data = takeBucket(event.deviceId) ?? create();
        data.memory.setMax(MAX_MEMORIES); // 버킷의 낮은 기억 상한은 자리가 되면 풀린다
        bySeat.set(event.seatId, data);
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
