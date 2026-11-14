import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES } from '../limits.js';
import type { MemoryPlace } from '../placeMemory.js';
import { displayEventName } from '../eventName.js';
import { normalizePlaceName } from '../placeMemory.js';
import { looksLikeAddress, parseCoordinateText } from '../placeSearch/address.js';
import { coarseLocation, externalQuery, scopedSearch } from '../placeSearch/scoped.js';
import { MAX_CANDIDATES, MAX_MEMORY_ADDRESS_LENGTH, MAX_MEMORY_NAME_LENGTH, MAX_MEMORY_PLACE_NAME_LENGTH } from '../placeSearch/limits.js';
import { isLat, isLng, type LatLng, type PlaceCandidate, type PlaceSearch, type SearchSource } from '../placeSearch/types.js';
import { openDenied, type SeatEnv, type SeatGuard } from '../seatScope.js';

/** 장소 검색(키워드·주소)을 부르는 라우트가 함께 쓰는 것: 검색 포트와 요청 주소별 속도 제한. */
export type PlaceSearchDeps = {
  search: PlaceSearch;
  /** 이 요청이 외부 검색을 불러도 되는가(요청 주소별 속도 제한). false면 429 rate-limited. */
  allow: (c: Context) => boolean;
  /** 이 요청이 `PUT /places/memory`로 저장해도 되는가(요청 주소별 속도 제한). false면 429 rate-limited. */
  allowMemoryWrite: (c: Context) => boolean;
};

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 보이는 이름 정리: 일정 이름과 같은 규칙(NFC·보이지 않는 글자 제거·공백 정리, `eventName.ts`). */
const clean = displayEventName;

/** 응답의 후보. memory의 place와 달리 id·거리가 있다. */
type PublicCandidate = PlaceCandidate;
type PublicMemoryPlace = MemoryPlace;

/** 어떻게 정했는가: coordinates(글자가 좌표)·address(정확한 주소)·memory(기억)·search(검색). */
export type ResolveVia = 'coordinates' | 'address' | 'memory' | 'search';

const rateLimited = (c: Context) => c.json({ error: '요청이 너무 많아요. 잠시 뒤 다시 해 주세요', reason: 'rate-limited' as const }, 429);

type ResolveInput = { query: string; key: string; near: LatLng | null };

// RPC 타입 추론을 위해 체이닝을 유지한다. `/places` 아래에 `createPlacesRoute`와 함께 붙는다.
export const createPlaceResolveRoute = (guard: SeatGuard, deps: PlaceSearchDeps) =>
  new Hono<SeatEnv>()
    /**
     * 차가 부른다: 검색어(`query`: 일정의 장소 칸 글자 또는 차에서 들은 이름) + 기억 키(`key`, 기본은 `query`) + 현재 위치 → 정책서 8장 순서를 서버가 돕는 만큼.
     * 좌표·정확한 주소(`query`)면 검색 없이 그대로 → 기억(`key`)이 있으면 memory(검색 안 함) → 검색(`query`만 외부로 나감, 현재 위치 기준 가까운 순, 후보 최대 2개, total은 일치한 수).
     * 검색을 못 했으면(시간 초과·오류·키 없음) 후보 없음 + source "unavailable"이고 이는 '0개(못 찾음)'와 다르다.
     * **일정 제목은 외부 검색으로 보내지 않는다**: 장소 칸이 빈 일정은 차가 들은 이름을 `query`로, 제목은 `key`로만 보낸다.
     * 자리는 `guard.placeRead`(옛 호환 없음): 차 토큰이면 `driver=<자리 id>` 필수.
     */
    .post(
      '/resolve',
      guard.placeRead,
      tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isRecord(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const keys = Object.keys(raw);
        if (keys.some((k) => k !== 'query' && k !== 'name' && k !== 'key' && k !== 'lat' && k !== 'lng')) return c.json({ error: 'query, key, lat, lng만 보낼 수 있습니다' }, 400);
        if (raw.query !== undefined && raw.name !== undefined) return c.json({ error: 'name은 query의 옛 이름입니다. 하나만 보내 주세요' }, 400);
        const rawQuery = raw.query ?? raw.name;
        if (typeof rawQuery !== 'string' || clean(rawQuery) === '') return c.json({ error: 'query는 비어 있지 않은 문자열이어야 합니다' }, 400);
        const query = clean(rawQuery);
        if (query.length > MAX_MEMORY_NAME_LENGTH) return c.json({ error: `query는 ${MAX_MEMORY_NAME_LENGTH}자 이하여야 합니다` }, 400);
        let key = query;
        if (raw.key !== undefined && raw.key !== null) {
          if (typeof raw.key !== 'string' || clean(raw.key) === '') return c.json({ error: 'key는 비어 있지 않은 문자열이어야 합니다' }, 400);
          if (clean(raw.key).length > MAX_MEMORY_NAME_LENGTH) return c.json({ error: `key는 ${MAX_MEMORY_NAME_LENGTH}자 이하여야 합니다` }, 400);
          key = clean(raw.key);
        }
        const hasLat = raw.lat !== undefined && raw.lat !== null;
        const hasLng = raw.lng !== undefined && raw.lng !== null;
        if (hasLat !== hasLng) return c.json({ error: 'lat과 lng는 함께 보내야 합니다' }, 400);
        if (hasLat && (!isLat(raw.lat) || !isLng(raw.lng))) return c.json({ error: 'lat은 -90~90, lng는 -180~180 숫자여야 합니다' }, 400);
        const input: ResolveInput = { query, key, near: hasLat ? { lat: raw.lat as number, lng: raw.lng as number } : null };
        return input;
      }),
      async (c) => {
        const { query, key, near } = c.req.valid('json');
        const scope = c.var.seat;
        const d = scope.data;
        // 실제 자리에서는 목 검색 결과를 쓰지 않는다(기본 자리와 FIXTURE_SEATS=1에서만 목).
        const search = scopedSearch(deps.search, scope.fixture);
        let allowed: boolean | null = null;
        const gate = () => (allowed ??= deps.allow(c));
        const body = (
          via: ResolveVia,
          source: SearchSource | 'none',
          candidates: PublicCandidate[],
          total: number,
          memory: { place: PublicMemoryPlace; ambiguous: boolean } | null = null,
        ) => c.json({ memory, candidates, total, source, via }, 200);

        // 1. 글자가 좌표(소수 3자리 이상 두 수, 한국 범위)면 그대로, 정확한 주소면 주소 → 좌표(키워드 검색은 하지 않는다).
        const coords = parseCoordinateText(query);
        if (coords) {
          const here = { id: `coord:${coords.lat},${coords.lng}`, name: '지정한 위치', address: '', ...coords, distanceMeters: null };
          return body('coordinates', 'none', [here], 1);
        }
        if (looksLikeAddress(query)) {
          if (!gate()) return rateLimited(c);
          const geo = await search.geocodeAddress(externalQuery(query));
          if (geo.place) {
            const { lat, lng } = geo.place;
            return body('address', geo.source, [{ id: `addr:${lat},${lng}`, ...geo.place, distanceMeters: null }], 1);
          }
        }
        // 2. 기억(이름 → 장소)이 있으면 1순위 후보. 검색하지 않는다. 애매한 이름이면 차가 매번 확인한다.
        const remembered = d.memory.get(key);
        if (remembered) return body('memory', 'none', [], 0, { place: remembered.place, ambiguous: remembered.ambiguous });
        // 3. 검색(현재 위치 기준 가까운 순). 가까운 2개만 후보로 내고 total로 0개·1개·2개 이상을 가른다.
        //    밖으로 나가는 것은 검색어 50자 이내와 소수 3자리로 줄인 현재 위치뿐이다.
        if (!gate()) return rateLimited(c);
        const found = await search.searchKeyword({ query: externalQuery(query), near: near ? coarseLocation(near) : undefined, limit: MAX_CANDIDATES });
        return body('search', found.source, found.places.slice(0, MAX_CANDIDATES), found.total);
      },
    )
    /**
     * 차가 부른다(정책서 11장 `PUT /places/memory`): '이름 → 장소, 애매 여부'를 그 자리에 저장한다. 같은 이름(정규화해서 같은 것)은 덮어쓴다.
     * 자리는 폰 토큰(그 자리), 차 토큰 + `driver=<seatId>`(필수, 없으면 400), 기기 id(연결 전 버킷)로 정한다. 식별이 없으면 서버에 자리 있는 차가
     * 하나도 없을 때만 기본 자리이고 그 밖에는 저장하지 않는 범위라 거절한다(옛 차 앱 호환 규칙은 적용하지 않는다).
     * 요청 주소별 속도 제한(분당 30회)이 있다.
     */
    .put(
      '/memory',
      guard.placeWrite,
      tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isRecord(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        if (Object.keys(raw).some((k) => k !== 'name' && k !== 'place' && k !== 'ambiguous')) return c.json({ error: 'name, place, ambiguous만 보낼 수 있습니다' }, 400);
        if (typeof raw.name !== 'string' || clean(raw.name) === '') return c.json({ error: 'name은 비어 있지 않은 문자열이어야 합니다' }, 400);
        if (clean(raw.name).length > MAX_MEMORY_NAME_LENGTH) return c.json({ error: `name은 ${MAX_MEMORY_NAME_LENGTH}자 이하여야 합니다` }, 400);
        if (typeof raw.ambiguous !== 'boolean') return c.json({ error: 'ambiguous는 true 또는 false여야 합니다' }, 400);
        const p = raw.place;
        if (!isRecord(p)) return c.json({ error: 'place는 객체여야 합니다' }, 400);
        if (Object.keys(p).some((k) => k !== 'name' && k !== 'lat' && k !== 'lng' && k !== 'address')) return c.json({ error: 'place는 name, lat, lng, address만 가질 수 있습니다' }, 400);
        if (typeof p.name !== 'string' || clean(p.name) === '' || clean(p.name).length > MAX_MEMORY_PLACE_NAME_LENGTH) {
          return c.json({ error: `place.name은 1~${MAX_MEMORY_PLACE_NAME_LENGTH}자 문자열이어야 합니다` }, 400);
        }
        if (!isLat(p.lat) || !isLng(p.lng)) return c.json({ error: 'place.lat은 -90~90, place.lng는 -180~180 숫자여야 합니다' }, 400);
        let address: string | null = null;
        if (p.address !== undefined && p.address !== null) {
          if (typeof p.address !== 'string' || clean(p.address).length > MAX_MEMORY_ADDRESS_LENGTH) {
            return c.json({ error: `place.address는 ${MAX_MEMORY_ADDRESS_LENGTH}자 이하 문자열이어야 합니다` }, 400);
          }
          address = clean(p.address) === '' ? null : clean(p.address);
        }
        return { name: raw.name, place: { name: clean(p.name), address, lat: p.lat, lng: p.lng }, ambiguous: raw.ambiguous };
      }),
      (c) => {
        if (!deps.allowMemoryWrite(c)) return rateLimited(c);
        const opened = c.var.seat.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        return c.json(opened.data.memory.put(c.req.valid('json')), 200);
      },
    )
    /** 폰: 이 자리가 기억한 장소 목록(최근에 쓴 것부터). 차 토큰 + `driver=`도 읽을 수 있다(옛 호환 없음). */
    .get('/memory', guard.placeRead, (c) => c.json({ memories: c.var.seat.data.memory.list() }, 200))
    /**
     * 폰: 기억 하나 지우기(정책서 10.8 '기억한 장소 지우기'). 이름은 **쿼리 `name`**으로 보낸다(`/`·`#`·`?`가 든 이름도 안전하다). 없으면 404.
     * 지우기는 버킷을 만들지 않는다.
     */
    .delete(
      '/memory',
      guard.placeWrite,
      validator('query', (value, c) => {
        const name = value.name;
        if (typeof name !== 'string' || normalizePlaceName(name) === '' || name.length > MAX_MEMORY_NAME_LENGTH) {
          return c.json({ error: '지울 기억의 이름(name)이 올바르지 않습니다' }, 400);
        }
        return { name };
      }),
      (c) => {
        const { name } = c.req.valid('query');
        if (!c.var.seat.data.memory.delete(name)) return c.json({ error: '그 이름으로 기억한 장소가 없습니다' }, 404);
        return c.json({ name: clean(name) }, 200);
      },
    );
