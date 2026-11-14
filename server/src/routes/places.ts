import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import type { MockPlace, PlacesCatalog } from '../fixture-types.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';
import { MAX_SEARCH_RESULTS } from '../placeSearch/limits.js';
import { normalizeQuery, searchPlaces } from '../placeSearch/match.js';
import { coarseLocation, externalQuery, scopedSearch } from '../placeSearch/scoped.js';
import { isLat, isLng, type LatLng } from '../placeSearch/types.js';
import { parsePlaceSnapshot, type PlaceSnapshotInput, type StoredPlace } from '../placeSnapshot.js';
import type { PlaceSearchDeps } from './placeResolve.js';
import { openDenied, type SeatEnv, type SeatGuard } from '../seatScope.js';

/** 응답에 내보내는 장소. 픽스처 전용 필드(fictional)는 뺀다. */
export type PublicPlace = Omit<MockPlace, 'fictional'>;

export const MAX_QUERY_LENGTH = 50;
export { MAX_SEARCH_RESULTS, normalizeQuery, searchPlaces };
export const MAX_OTHER_PLACES = 20;

/**
 * 저장하는 건 장소 스냅숏(`StoredPlace`: id·이름·주소·좌표)이다. 목 장소 id로 저장하면 그 목 장소의 정보를, 폰이 장소 스냅숏을 실어 보내면(외부 검색 결과)
 * 그 값을 그대로 담는다. revision은 저장이 바뀔 때마다 서버가 1씩 올린다.
 */
export type SavedFavorites = { home: StoredPlace | null; work: StoredPlace | null; others: StoredPlace[]; revision: number };

export type AddOtherResult = { ok: true; saved: SavedFavorites } | { ok: false; reason: 'duplicate' | 'full' };

/**
 * 운전자 자리 하나의 자주 가는 곳을 메모리에 둔다. 연산은 자리 하나만 바꾸고,
 * 같은 장소가 다른 자리에 있으면 그 자리에서 빼고 옮긴다. 한 연산은 한 번에 적용된다.
 */
export type FavoritesStore = {
  get(): SavedFavorites;
  setHome(place: StoredPlace | null): SavedFavorites;
  setWork(place: StoredPlace | null): SavedFavorites;
  addOther(place: StoredPlace): AddOtherResult;
};

export function createFavoritesStore(): FavoritesStore {
  let saved: SavedFavorites = { home: null, work: null, others: [], revision: 0 };
  const commit = (next: Omit<SavedFavorites, 'revision'>): SavedFavorites => {
    saved = { ...next, revision: saved.revision + 1 };
    return saved;
  };
  const without = (id: string | null) => ({
    home: saved.home?.id === id ? null : saved.home,
    work: saved.work?.id === id ? null : saved.work,
    others: saved.others.filter((p) => p.id !== id),
  });
  return {
    get: () => saved,
    setHome: (place) => commit({ ...(place === null ? saved : without(place.id)), home: place }),
    setWork: (place) => commit({ ...(place === null ? saved : without(place.id)), work: place }),
    addOther: (place) => {
      if (saved.others.some((p) => p.id === place.id)) return { ok: false, reason: 'duplicate' };
      if (saved.others.length >= MAX_OTHER_PLACES) return { ok: false, reason: 'full' };
      const rest = without(place.id);
      return { ok: true, saved: commit({ ...rest, others: [...rest.others, place] }) };
    },
  };
}

/** 쿼리 문자열 lat·lng를 기준 좌표로 읽는다. 숫자 하나씩이 아니거나 범위를 벗어나면 null. */
function nearOf(lat: unknown, lng: unknown): LatLng | null {
  const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const parsed = { lat: num(lat), lng: num(lng) };
  return isLat(parsed.lat) && isLng(parsed.lng) ? parsed : null;
}

/** 저장 요청 본문: 목 장소 `placeId`(기존) 또는 장소 스냅숏 `place`(외부 검색 결과). 둘 중 하나만 보낸다(RPC 클라이언트의 입력 모양이다). */
export type PlaceChoice = { placeId: string | null } | { place: PlaceSnapshotInput };
type ParsedPlaceChoice = { ok: true; choice: PlaceChoice } | { ok: false; error: string };

function parsePlaceChoice(raw: unknown, byId: Map<string, StoredPlace>, nullable: boolean): ParsedPlaceChoice {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '본문이 객체가 아닙니다' };
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== 1 || (keys[0] !== 'placeId' && keys[0] !== 'place')) return { ok: false, error: 'placeId(목 장소 id) 또는 place(장소 스냅숏) 하나가 필요합니다' };
  if (keys[0] === 'place') {
    const parsed = parsePlaceSnapshot(value.place);
    return parsed.ok ? { ok: true, choice: { place: value.place as PlaceSnapshotInput } } : { ok: false, error: parsed.error };
  }
  const { placeId } = value;
  if (placeId === null && nullable) return { ok: true, choice: { placeId: null } };
  if (typeof placeId !== 'string' || placeId.trim() === '') return { ok: false, error: 'placeId는 장소 id 문자열이어야 합니다' };
  if (placeId.length > MAX_ID_LENGTH) return { ok: false, error: `id는 ${MAX_ID_LENGTH}자 이하여야 합니다` };
  if (!byId.has(placeId)) return { ok: false, error: '목 장소에 없는 id입니다' };
  return { ok: true, choice: { placeId } };
}

/** 검증을 통과한 본문을 저장할 장소로 바꾼다. null이면 비운다. */
const placeOf = (choice: PlaceChoice, byId: Map<string, StoredPlace>): StoredPlace | null => {
  if ('place' in choice) return (parsePlaceSnapshot(choice.place) as { ok: true; place: StoredPlace }).place;
  return choice.placeId === null ? null : (byId.get(choice.placeId) as StoredPlace);
};

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413),
});

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createPlacesRoute = (catalog: PlacesCatalog, guard: SeatGuard, deps: PlaceSearchDeps) => {
  // 검색 목록과 추천에 같은 id가 있으면 같은 장소이므로 한 번만 둔다.
  const toPlace = (p: MockPlace): PublicPlace => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng });
  const byId = new Map<string, PublicPlace>();
  for (const p of [...catalog.places, ...catalog.suggestions]) byId.set(p.id, toPlace(p));
  const suggestions = catalog.suggestions.map((s) => ({ ...toPlace(s), hint: s.hint }));
  const view = (saved: SavedFavorites) => ({
    home: saved.home as PublicPlace | null,
    work: saved.work as PublicPlace | null,
    others: saved.others as PublicPlace[],
    revision: saved.revision,
  });
  const placeValidator = (nullable: boolean) =>
    validator('json', (value, c) => {
      const parsed = parsePlaceChoice(value, byId, nullable);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      return parsed.choice;
    });

  return new Hono<SeatEnv>()
    // 자리를 정하는 가드를 거치는 이유: 실제 자리(연결된 자리·연결 전 버킷)에서는 목 검색 결과를 쓰지 않는다(기본 자리와 FIXTURE_SEATS=1만 목).
    .get(
      '/search',
      guard.placeRead,
      validator('query', (value, c) => {
        const raw = value.q;
        if (typeof raw !== 'string') return c.json({ error: 'q는 문자열 하나여야 합니다' }, 400);
        const q = normalizeQuery(raw);
        if (q === '') return c.json({ error: 'q가 비어 있습니다' }, 400);
        if (q.length > MAX_QUERY_LENGTH) return c.json({ error: `q는 ${MAX_QUERY_LENGTH}자 이하여야 합니다` }, 400);
        // 선택: 기준 좌표(lat·lng 함께). 있으면 가까운 순으로 돌려준다.
        const { lat, lng } = value;
        if ((lat === undefined) !== (lng === undefined)) return c.json({ error: 'lat과 lng는 함께 보내야 합니다' }, 400);
        if (lat !== undefined && nearOf(lat, lng) === null) return c.json({ error: 'lat은 -90~90, lng는 -180~180 숫자 하나여야 합니다' }, 400);
        // 반환 타입이 RPC 클라이언트의 쿼리 입력 모양이 된다(lat·lng는 선택).
        return { q, lat, lng } as { q: string; lat?: string; lng?: string };
      }),
      async (c) => {
        const { q, lat, lng } = c.req.valid('query');
        const near = lat === undefined ? null : nearOf(lat, lng);
        if (!deps.allow(c)) return c.json({ error: '요청이 너무 많아요. 잠시 뒤 다시 해 주세요', reason: 'rate-limited' as const }, 429);
        const search = scopedSearch(deps.search, c.var.seat.fixture);
        const found = await search.searchKeyword({ query: externalQuery(q), near: near ? coarseLocation(near) : undefined, limit: MAX_SEARCH_RESULTS });
        const places = found.places.map((p): PublicPlace => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng }));
        // 기존 응답({ places })과 같게 두고, 목이 아닌 출처(kakao·unavailable)일 때만 source를 덧붙인다.
        return found.source === 'mock' ? c.json({ places }, 200) : c.json({ places, source: found.source }, 200);
      },
    )
    .get('/suggestions', (c) => c.json({ suggestions }))
    .get('/favorites', guard.read, (c) => c.json(view(c.var.seat.data.favorites.get())))
    .put('/favorites/home', guard.write, tooLarge, placeValidator(true), (c) => {
      const opened = c.var.seat.open();
      if (!opened.ok) return c.json(openDenied(opened.reason), 429);
      return c.json(view(opened.data.favorites.setHome(placeOf(c.req.valid('json'), byId))), 200);
    })
    .put('/favorites/work', guard.write, tooLarge, placeValidator(true), (c) => {
      const opened = c.var.seat.open();
      if (!opened.ok) return c.json(openDenied(opened.reason), 429);
      return c.json(view(opened.data.favorites.setWork(placeOf(c.req.valid('json'), byId))), 200);
    })
    .post('/favorites/others', guard.write, tooLarge, placeValidator(false), (c) => {
      const opened = c.var.seat.open();
      if (!opened.ok) return c.json(openDenied(opened.reason), 429);
      const result = opened.data.favorites.addOther(placeOf(c.req.valid('json'), byId) as StoredPlace);
      if (!result.ok) {
        const error = result.reason === 'duplicate' ? '이미 추가한 장소입니다' : `추가한 장소는 ${MAX_OTHER_PLACES}개 이하여야 합니다`;
        return c.json({ error }, 400);
      }
      return c.json(view(result.saved), 200);
    });
};
