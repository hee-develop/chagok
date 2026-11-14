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
  /** 자리를 지운다. */
  remove(seatId: string): void;
  /** 자리 이벤트(생성·교체·삭제)를 데이터에 반영한다. 연결 상태를 가진 SeatStore를 구독시킨다. */
  apply(event: SeatEvent): void;
};

type Preset = Partial<Pick<SeatData, 'events' | 'selection' | 'favorites' | 'family'>>;

export type SeatDataOptions = {
  now: () => Date;
  /** 픽스처 일정 id. 픽스처 일정의 보정·채비는 폰 일정이 바뀌어도 남긴다. */
  fixtureIds: Set<string>;
  /** 기본 자리가 쓸 저장소(테스트가 직접 넘길 수 있다). 없으면 새로 만든다. */
  defaults?: Preset;
};

export function createSeatDataRegistry({ now, fixtureIds, defaults = {} }: SeatDataOptions): SeatDataRegistry {
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
  const get = (seatId: string) => {
    let data = bySeat.get(seatId);
    if (!data) {
      data = create();
      bySeat.set(seatId, data);
    }
    return data;
  };
  return {
    get,
    remove: (seatId) => {
      if (seatId !== DEFAULT_SEAT_ID) bySeat.delete(seatId);
    },
    apply: (event) => {
      if (event.type === 'removed') {
        bySeat.delete(event.seatId);
      } else if (event.type === 'created') {
        // 연결 전에 폰이 기본 자리에 모아 둔 일정·선택·보정·채비·자주 가는 곳을 새 자리가 이어받고, 기본 자리는 처음 상태로 돌아간다.
        bySeat.set(event.seatId, get(DEFAULT_SEAT_ID));
        bySeat.set(DEFAULT_SEAT_ID, create());
      } else {
        // 폰 바꾸기: 옛 폰의 캘린더에서 온 일정·캘린더 선택은 버린다. 자주 가는 곳 같은 기억과 가족 요청은 둔다.
        const data = get(event.seatId);
        data.events.clear();
        data.selection = createSelectionStore();
      }
    },
  };
}
