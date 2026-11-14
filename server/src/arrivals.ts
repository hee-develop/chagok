import type { MockPlace } from './fixture-types.js';
import { DAY_MS, MINUTE_MS, formatSeoulDate, seoulDay } from './time.js';

/**
 * 장소 도착 횟수와 '자주 가는 곳' 후보 계산(정책서 6장 '도착', 8장 끝 문단, 11장 '도착 횟수', 12장 '자주 가는 곳 기준').
 * 저장하는 것은 **장소·횟수·마지막 날짜뿐**이다(이동 경로·도착 시각 이력은 저장하지 않는다). 자리별이고(`SeatData.arrivals`), 사용자가 지우거나 자리가 지워질 때까지 남는다.
 */

/** '같은 곳' 판정: 이름 정규화가 같고 좌표가 이 거리(미터) 이내(가안, 정책서에 없음). */
export const SAME_PLACE_METERS = 100;
/** 자주 가는 곳 후보로 올리는 도착 횟수 기준: **이 값을 넘어야**(4회부터) 올린다(정책서 12장 '도착 3회 넘게', 가안). */
export const FREQUENT_ARRIVALS_OVER = 3;
/** 집 반경(미터): 지금 집 안이면 후보에서 집을 뺀다(정책서 12장 '집 반경' 300m, 가안). */
export const HOME_RADIUS_METERS = 300;
/** 자리당 도착 횟수를 기억하는 장소 수 상한(가안). 넘으면 가장 오래 안 간 곳부터 지운다. */
export const MAX_ARRIVAL_PLACES = 100;
/** `POST /arrivals`의 `at`은 서버 시각보다 이만큼(시계 오차) 넘게 미래일 수 없다(가안). */
export const ARRIVAL_FUTURE_SKEW_MS = 10 * MINUTE_MS;
/** `POST /arrivals`의 `at`은 서버 시각보다 이만큼 넘게 과거일 수 없다. 차가 오프라인일 때 모았다 보내는 여유(가안). */
export const ARRIVAL_PAST_LIMIT_MS = 3 * DAY_MS;
/** 같은 일정의 도착을 한 번만 세려고 기억해 두는 일정 id 수 상한(가안). 넘으면 가장 오래된 것부터 잊는다. */
export const MAX_ARRIVAL_KEYS = 500;
/**
 * 일정 id 기억은 **처음 센 `at`의 서울 날짜**가 이 일수만큼 지나면 버린다. `at`을 받는 범위(`ARRIVAL_PAST_LIMIT_MS`, 3일 전)에 서울 날짜 경계 하루를 더한 값이라,
 * 3일 전 `at`으로 센 도착도 같은 `at`으로 다시 와 있는 동안은 중복으로 센다(기억이 받는 범위보다 일찍 사라지지 않는다).
 */
export const ARRIVAL_KEY_DAYS = Math.ceil(ARRIVAL_PAST_LIMIT_MS / DAY_MS) + 1;
export const MAX_PLACE_NAME_LENGTH = 100;
export const MAX_PLACE_ADDRESS_LENGTH = 200;

/** 이름 정규화: 앞뒤 공백 제거, 안쪽 연속 공백을 하나로, 대소문자 무시(NFC). */
export const normalizeName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 두 좌표의 거리(미터, 하버사인). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Spot = { name: string; lat: number; lng: number };
/** 같은 곳인가: 이름 정규화가 같고 좌표가 SAME_PLACE_METERS 이내. */
export const samePlace = (a: Spot, b: Spot) => normalizeName(a.name) === normalizeName(b.name) && distanceMeters(a, b) <= SAME_PLACE_METERS;

/** 도착 횟수를 센 장소 하나. 횟수와 마지막 날짜(서울 'YYYY-MM-DD')만 가진다. */
export type ArrivalPlace = { id: string; name: string; address: string | null; lat: number; lng: number; count: number; lastDate: string };

export type ArrivalInput = {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** 있으면 이 일정 id의 도착은 (기억이 살아 있는 동안) **`at`의 날짜가 달라도** 한 번만 센다. 없으면 부를 때마다 센다. */
  scheduleId: string | null;
  /** 도착한 시각(마지막 날짜를 정하는 데만 쓴다. 저장하지 않는다). */
  at: Date;
};
/** `counted`가 false면 같은 일정 id의 도착이 이미 세어져 있어 횟수를 올리지 않은 것이다(그때 `place`는 처음 센 장소, 지워졌으면 null). */
export type ArrivalRecord = { counted: boolean; place: ArrivalPlace | null };

export type ArrivalsStore = {
  /** 도착 하나를 센다(멱등 규칙은 `ArrivalInput.scheduleId`). 상한을 넘으면 가장 오래 안 간 장소를 먼저 지운다. */
  record(input: ArrivalInput): ArrivalRecord;
  /** 도착 횟수가 많은 순, 같으면 마지막 날짜가 가까운 순, 같으면 이름순. */
  list(): ArrivalPlace[];
  /** 사용자가 장소 하나의 도착 횟수를 지운다. 있었으면 true. */
  remove(id: string): boolean;
  /** 낡은 일정 id 기억을 지금 버린다(정기 작업 `purge-expired`). 버린 수. 도착 횟수 자체(장소·횟수)는 사용자가 지울 때까지 남긴다. */
  purgeExpired(): number;
  /** 개발·데모용 초기화: 장소별 도착 횟수와 일정 id 기억을 모두 비운다(기본 자리만 쓴다, `DELETE /events`). */
  clear(): void;
};

const byRank = (a: ArrivalPlace, b: ArrivalPlace) =>
  b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

export function createArrivalsStore(now: () => Date = () => new Date()): ArrivalsStore {
  const places = new Map<string, ArrivalPlace>();
  /** 일정 id → { 처음 센 `at`의 서울 날짜 번호, 처음 센 장소 id }. 같은 일정의 도착을 두 번 세지 않으려는 기억이다(`at`의 날짜가 달라도 한 번). */
  const counted = new Map<string, { day: number; placeId: string }>();
  let seq = 0;

  /** 처음 센 날짜가 `ARRIVAL_KEY_DAYS`보다 오래된 기억과 상한을 넘는 오래된 기억을 버린다. 버린 수. */
  const forgetOldKeys = () => {
    const oldest = seoulDay(now().getTime()) - ARRIVAL_KEY_DAYS;
    let forgotten = 0;
    for (const [key, v] of counted) {
      if (v.day >= oldest) continue;
      counted.delete(key);
      forgotten += 1;
    }
    while (counted.size > MAX_ARRIVAL_KEYS) {
      counted.delete(counted.keys().next().value as string);
      forgotten += 1;
    }
    return forgotten;
  };
  /**
   * 상한을 넘을 때 지울 곳. **자주 가는 곳 기준(`FREQUENT_ARRIVALS_OVER`)을 넘은 곳은 한 번만 간 곳(기준 이하)보다 나중에** 밀려난다:
   * 기준 이하인 곳이 있으면 그중에서, 없을 때만 기준을 넘은 곳에서 고른다. 고르는 순서는 마지막 날짜가 이른 것, 같으면 횟수가 적은 것, 같으면 먼저 만든 것.
   */
  const evictOne = () => {
    const older = (a: ArrivalPlace, b: ArrivalPlace) => a.lastDate < b.lastDate || (a.lastDate === b.lastDate && a.count < b.count);
    let victim: ArrivalPlace | null = null;
    for (const p of places.values()) {
      if (victim === null) victim = p;
      else if (p.count > FREQUENT_ARRIVALS_OVER !== victim.count > FREQUENT_ARRIVALS_OVER) {
        if (p.count <= FREQUENT_ARRIVALS_OVER) victim = p;
      } else if (older(p, victim)) victim = p;
    }
    if (victim) places.delete(victim.id);
  };

  return {
    record: (input) => {
      forgetOldKeys();
      const day = seoulDay(input.at.getTime());
      const date = formatSeoulDate(day);
      const key = input.scheduleId;
      if (key !== null) {
        const seen = counted.get(key);
        if (seen) return { counted: false, place: places.get(seen.placeId) ?? null };
      }
      const name = normalizeName(input.name);
      let match: ArrivalPlace | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const p of places.values()) {
        if (normalizeName(p.name) !== name) continue;
        const d = distanceMeters(p, input);
        if (d <= SAME_PLACE_METERS && d < best) {
          match = p;
          best = d;
        }
      }
      let place: ArrivalPlace;
      if (match) {
        place = { ...match, count: match.count + 1, lastDate: date > match.lastDate ? date : match.lastDate, address: match.address ?? input.address };
      } else {
        while (places.size >= MAX_ARRIVAL_PLACES) evictOne();
        seq += 1;
        place = { id: `a${seq}`, name: input.name, address: input.address, lat: input.lat, lng: input.lng, count: 1, lastDate: date };
      }
      places.set(place.id, place);
      if (key !== null) counted.set(key, { day, placeId: place.id });
      forgetOldKeys();
      return { counted: true, place };
    },
    list: () => [...places.values()].sort(byRank),
    remove: (id) => places.delete(id),
    purgeExpired: forgetOldKeys,
    clear: () => {
      places.clear();
      counted.clear();
    },
  };
}

/** 후보 한 곳. `kind`는 폰 앱에서 등록한 집·회사·단골(`home`·`work`·`other`)이고 도착 횟수로만 올라온 곳은 `other`다. */
export type CandidateKind = 'home' | 'work' | 'other';
export type FavoriteSpot = { kind: CandidateKind; name: string; address: string; lat: number; lng: number };
export type FrequentCandidate = FavoriteSpot & {
  /** 이 곳의 도착 횟수(같은 곳으로 합쳐진 장소의 횟수 합. 센 적 없으면 0). */
  arrivalCount: number;
  /** `favorite` 폰 앱에서 등록한 곳, `arrivals` 도착 횟수로만 올라온 곳, `both` 등록한 곳이 도착 횟수도 가진 경우. */
  source: 'favorite' | 'arrivals' | 'both';
};

/** 저장된 자주 가는 곳 한 칸: 목 장소 id(문자열, `places`에서 풂) 또는 이미 풀린 장소(스냅숏). 저장소가 어느 쪽을 들고 있어도 쓸 수 있게 둘 다 받는다. */
type SavedSlot = string | Pick<MockPlace, 'name' | 'address' | 'lat' | 'lng'>;

/** 저장된 자주 가는 곳(집 → 회사 → 추가한 순서)을 장소 정보로 푼 목록. */
export function favoriteSpots(
  places: ReadonlyMap<string, Pick<MockPlace, 'name' | 'address' | 'lat' | 'lng'>>,
  saved: { home: SavedSlot | null; work: SavedSlot | null; others: SavedSlot[] },
): FavoriteSpot[] {
  const slots: { kind: CandidateKind; slot: SavedSlot }[] = [
    ...(saved.home === null ? [] : [{ kind: 'home' as const, slot: saved.home }]),
    ...(saved.work === null ? [] : [{ kind: 'work' as const, slot: saved.work }]),
    ...saved.others.map((slot) => ({ kind: 'other' as const, slot })),
  ];
  return slots.map(({ kind, slot }) => {
    const p = typeof slot === 'string' ? places.get(slot)! : slot;
    return { kind, name: p.name, address: p.address, lat: p.lat, lng: p.lng };
  });
}

/**
 * 자주 가는 곳 후보(정책서 8장): ① 폰 앱에서 등록한 집·회사·단골, ② 도착 횟수가 `FREQUENT_ARRIVALS_OVER`를 **넘은**(4회부터) 장소. 같은 곳(이름 정규화 같음 + 100m 이내)은 합친다.
 * **1순위는 도착 횟수가 가장 많은 곳**이다: 도착 횟수가 기준을 넘은 곳을 횟수 많은 순(같으면 마지막 날짜가 가까운 순)으로 앞에 두고, 그 뒤에 나머지 등록한 곳을 집 → 회사 → 추가한 순서로 둔다.
 * 기준을 넘은 곳이 없으면 결과는 등록한 곳의 기존 순서 그대로다(응답이 도착 횟수 기능 이전과 같다). 내비 즐겨찾기·최근 목적지는 차가 NaviHelper에서 합친다.
 */
export function rankCandidates(favorites: readonly FavoriteSpot[], arrivals: readonly ArrivalPlace[]): FrequentCandidate[] {
  type Entry = FrequentCandidate & { lastDate: string; order: number };
  const entries: Entry[] = favorites.map((f, order) => ({ ...f, arrivalCount: 0, source: 'favorite', lastDate: '', order }));
  for (const a of arrivals) {
    const hit = entries.filter((e) => samePlace(e, a)).sort((x, y) => distanceMeters(x, a) - distanceMeters(y, a))[0];
    if (hit) {
      hit.arrivalCount += a.count;
      hit.lastDate = a.lastDate > hit.lastDate ? a.lastDate : hit.lastDate;
      hit.source = 'both';
    } else if (a.count > FREQUENT_ARRIVALS_OVER) {
      entries.push({ kind: 'other', name: a.name, address: a.address ?? '', lat: a.lat, lng: a.lng, arrivalCount: a.count, source: 'arrivals', lastDate: a.lastDate, order: entries.length });
    }
  }
  const over = entries
    .filter((e) => e.arrivalCount > FREQUENT_ARRIVALS_OVER)
    .sort((x, y) => y.arrivalCount - x.arrivalCount || y.lastDate.localeCompare(x.lastDate) || x.order - y.order);
  const rest = entries.filter((e) => e.arrivalCount <= FREQUENT_ARRIVALS_OVER).sort((x, y) => x.order - y.order);
  return [...over, ...rest].map(({ lastDate: _lastDate, order: _order, ...c }) => c);
}

/**
 * `GET /schedules/today`의 `favorites`: 등록한 집·회사·단골 목록에 도착 횟수를 반영한다(`rankCandidates`). 도착 횟수가 3회를 넘은 곳(4회부터)이 있으면 횟수 많은 순으로 앞에
 * 올라오고(1순위는 최다 도착, `kind: 'other'`, 등록한 곳과 같은 곳은 합쳐짐), 없으면 받은 목록 그대로다. 항목 모양은 그대로 `{ kind, name, address, lat, lng }`다(`arrivalCount`·`source`는 뺀다).
 * 현재 위치를 모르므로 집을 빼지 않는다(`GET /places/frequent`가 `lat`·`lng`로 뺀다).
 */
export const favoritesWithArrivals = (favorites: readonly FavoriteSpot[], arrivals: readonly ArrivalPlace[]): FavoriteSpot[] =>
  rankCandidates(favorites, arrivals).map(({ kind, name, address, lat, lng }) => ({ kind, name, address, lat, lng }));

/** 현재 위치가 집 반경(300m) 안이면 집을 뺀다(지금 집이면 '집으로'를 묻지 않는다). 뺐는지도 알려 준다. */
export function withoutCurrentHome(list: readonly FrequentCandidate[], here: { lat: number; lng: number }): { candidates: FrequentCandidate[]; homeExcluded: boolean } {
  const candidates = list.filter((c) => !(c.kind === 'home' && distanceMeters(c, here) <= HOME_RADIUS_METERS));
  return { candidates, homeExcluded: candidates.length !== list.length };
}
