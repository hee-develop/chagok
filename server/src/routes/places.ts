import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import type { MockPlace, PlacesCatalog } from '../fixture-types.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';

/** 응답에 내보내는 장소. 픽스처 전용 필드(fictional)는 뺀다. */
export type PublicPlace = Omit<MockPlace, 'fictional'>;

export const MAX_QUERY_LENGTH = 50;
export const MAX_SEARCH_RESULTS = 10;
export const MAX_OTHER_PLACES = 20;

/** 저장하는 건 장소 id뿐이고, 응답에서 목 장소 정보로 풀어 준다. revision은 저장이 바뀔 때마다 서버가 1씩 올린다. */
export type SavedFavorites = { home: string | null; work: string | null; others: string[]; revision: number };

export type AddOtherResult = { ok: true; saved: SavedFavorites } | { ok: false; reason: 'duplicate' | 'full' };

/**
 * 목 사용자 한 명의 자주 가는 곳을 메모리에 둔다. 연산은 자리 하나만 바꾸고,
 * 같은 장소가 다른 자리에 있으면 그 자리에서 빼고 옮긴다. 한 연산은 한 번에 적용된다.
 */
export type FavoritesStore = {
  get(): SavedFavorites;
  setHome(placeId: string | null): SavedFavorites;
  setWork(placeId: string | null): SavedFavorites;
  addOther(placeId: string): AddOtherResult;
};

export function createFavoritesStore(): FavoritesStore {
  let saved: SavedFavorites = { home: null, work: null, others: [], revision: 0 };
  const commit = (next: Omit<SavedFavorites, 'revision'>): SavedFavorites => {
    saved = { ...next, revision: saved.revision + 1 };
    return saved;
  };
  const without = (placeId: string | null) => ({
    home: saved.home === placeId ? null : saved.home,
    work: saved.work === placeId ? null : saved.work,
    others: saved.others.filter((id) => id !== placeId),
  });
  return {
    get: () => saved,
    setHome: (placeId) => commit({ ...(placeId === null ? saved : without(placeId)), home: placeId }),
    setWork: (placeId) => commit({ ...(placeId === null ? saved : without(placeId)), work: placeId }),
    addOther: (placeId) => {
      if (saved.others.includes(placeId)) return { ok: false, reason: 'duplicate' };
      if (saved.others.length >= MAX_OTHER_PLACES) return { ok: false, reason: 'full' };
      const rest = without(placeId);
      return { ok: true, saved: commit({ ...rest, others: [...rest.others, placeId] }) };
    },
  };
}

/** 앞뒤 공백을 지우고 안쪽 연속 공백을 하나로 줄인다. */
export const normalizeQuery = (raw: string) => raw.trim().replace(/\s+/g, ' ');

/** 공백으로 나눈 검색어가 모두 이름 또는 주소에 들어 있는 장소. 대소문자는 구분하지 않는다. */
export function searchPlaces<T extends Pick<MockPlace, 'name' | 'address'>>(places: T[], query: string): T[] {
  const tokens = normalizeQuery(query).toLowerCase().split(' ');
  return places
    .filter((p) => {
      const haystack = `${p.name} ${p.address}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    })
    .slice(0, MAX_SEARCH_RESULTS);
}

type ParsedPlaceId = { ok: true; placeId: string | null } | { ok: false; error: string };

function parsePlaceId(raw: unknown, known: Set<string>, nullable: boolean): ParsedPlaceId {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '본문이 객체가 아닙니다' };
  const { placeId } = raw as Record<string, unknown>;
  if (placeId === null && nullable) return { ok: true, placeId: null };
  if (typeof placeId !== 'string' || placeId.trim() === '') return { ok: false, error: 'placeId는 장소 id 문자열이어야 합니다' };
  if (placeId.length > MAX_ID_LENGTH) return { ok: false, error: `id는 ${MAX_ID_LENGTH}자 이하여야 합니다` };
  if (!known.has(placeId)) return { ok: false, error: '목 장소에 없는 id입니다' };
  return { ok: true, placeId };
}

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413),
});

// RPC 타입 추론을 위해 체이닝을 유지한다.
export const createPlacesRoute = (catalog: PlacesCatalog, store: FavoritesStore) => {
  // 검색 목록과 추천에 같은 id가 있으면 같은 장소이므로 한 번만 둔다.
  const toPlace = (p: MockPlace): PublicPlace => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng });
  const byId = new Map<string, PublicPlace>();
  for (const p of [...catalog.places, ...catalog.suggestions]) byId.set(p.id, toPlace(p));
  const known = new Set(byId.keys());
  const searchable = catalog.places.map(toPlace);
  const suggestions = catalog.suggestions.map((s) => ({ ...toPlace(s), hint: s.hint }));
  const resolve = (id: string): PublicPlace => byId.get(id) as PublicPlace;
  const view = (saved: SavedFavorites) => ({
    home: saved.home === null ? (null as PublicPlace | null) : resolve(saved.home),
    work: saved.work === null ? (null as PublicPlace | null) : resolve(saved.work),
    others: saved.others.map(resolve),
    revision: saved.revision,
  });
  const placeIdValidator = (nullable: boolean) =>
    validator('json', (value, c) => {
      const parsed = parsePlaceId(value, known, nullable);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      return { placeId: parsed.placeId };
    });

  return new Hono()
    .get(
      '/search',
      validator('query', (value, c) => {
        const raw = value.q;
        if (typeof raw !== 'string') return c.json({ error: 'q는 문자열 하나여야 합니다' }, 400);
        const q = normalizeQuery(raw);
        if (q === '') return c.json({ error: 'q가 비어 있습니다' }, 400);
        if (q.length > MAX_QUERY_LENGTH) return c.json({ error: `q는 ${MAX_QUERY_LENGTH}자 이하여야 합니다` }, 400);
        return { q };
      }),
      (c) => c.json({ places: searchPlaces(searchable, c.req.valid('query').q) }, 200),
    )
    .get('/suggestions', (c) => c.json({ suggestions }))
    .get('/favorites', (c) => c.json(view(store.get())))
    .put('/favorites/home', tooLarge, placeIdValidator(true), (c) => c.json(view(store.setHome(c.req.valid('json').placeId)), 200))
    .put('/favorites/work', tooLarge, placeIdValidator(true), (c) => c.json(view(store.setWork(c.req.valid('json').placeId)), 200))
    .post('/favorites/others', tooLarge, placeIdValidator(false), (c) => {
      const result = store.addOther(c.req.valid('json').placeId as string);
      if (!result.ok) {
        const error = result.reason === 'duplicate' ? '이미 추가한 장소입니다' : `추가한 장소는 ${MAX_OTHER_PLACES}개 이하여야 합니다`;
        return c.json({ error }, 400);
      }
      return c.json(view(result.saved), 200);
    });
};
