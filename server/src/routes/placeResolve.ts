import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES } from '../limits.js';
import type { MemoryPlace } from '../placeMemory.js';
import { normalizePlaceName } from '../placeMemory.js';
import { looksLikeAddress, parseCoordinateText } from '../placeSearch/address.js';
import { MAX_CANDIDATES, MAX_MEMORY_ADDRESS_LENGTH, MAX_MEMORY_NAME_LENGTH, MAX_MEMORY_PLACE_NAME_LENGTH } from '../placeSearch/limits.js';
import { isLat, isLng, type LatLng, type PlaceCandidate, type PlaceSearch, type SearchSource } from '../placeSearch/types.js';
import { openDenied, type SeatEnv, type SeatGuard } from '../seatScope.js';

/** 장소 검색(키워드·주소)을 부르는 라우트가 함께 쓰는 것: 검색 포트와 요청 주소별 속도 제한. */
export type PlaceSearchDeps = {
  search: PlaceSearch;
  /** 이 요청이 외부 검색을 불러도 되는가(요청 주소별 속도 제한). false면 429 rate-limited. */
  allow: (c: Context) => boolean;
};

const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413),
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clean = (text: string) => text.trim().replace(/\s+/g, ' ');

/** 응답의 후보. memory의 place와 달리 id·거리가 있다. */
type PublicCandidate = PlaceCandidate;
type PublicMemoryPlace = MemoryPlace;

/** 어떻게 정했는가: coordinates(글자가 좌표)·address(정확한 주소)·memory(기억)·search(검색). */
export type ResolveVia = 'coordinates' | 'address' | 'memory' | 'search';

const rateLimited = (c: Context) => c.json({ error: '요청이 너무 많아요. 잠시 뒤 다시 해 주세요', reason: 'rate-limited' as const }, 429);

type ResolveInput = { name: string; near: LatLng | null };

// RPC 타입 추론을 위해 체이닝을 유지한다. `/places` 아래에 `createPlacesRoute`와 함께 붙는다.
export const createPlaceResolveRoute = (guard: SeatGuard, deps: PlaceSearchDeps) =>
  new Hono<SeatEnv>()
    /**
     * 차가 부른다: 일정의 장소 칸 글자(또는 차에서 들은 이름) + 현재 위치 → 정책서 8장 순서를 서버가 돕는 만큼.
     * 좌표·정확한 주소면 검색 없이 그대로 → 기억이 있으면 memory(검색 안 함) → 검색(현재 위치 기준 가까운 순, 후보 최대 2개, total은 일치한 수).
     * 검색을 못 했으면(시간 초과·오류) 후보 없음 + source "unavailable"이고 이는 '0개(못 찾음)'와 다르다.
     */
    .post(
      '/resolve',
      guard.read,
      tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isRecord(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const keys = Object.keys(raw);
        if (keys.some((k) => k !== 'name' && k !== 'lat' && k !== 'lng')) return c.json({ error: 'name, lat, lng만 보낼 수 있습니다' }, 400);
        if (typeof raw.name !== 'string' || clean(raw.name) === '') return c.json({ error: 'name은 비어 있지 않은 문자열이어야 합니다' }, 400);
        const name = clean(raw.name);
        if (name.length > MAX_MEMORY_NAME_LENGTH) return c.json({ error: `name은 ${MAX_MEMORY_NAME_LENGTH}자 이하여야 합니다` }, 400);
        const hasLat = raw.lat !== undefined && raw.lat !== null;
        const hasLng = raw.lng !== undefined && raw.lng !== null;
        if (hasLat !== hasLng) return c.json({ error: 'lat과 lng는 함께 보내야 합니다' }, 400);
        if (hasLat && (!isLat(raw.lat) || !isLng(raw.lng))) return c.json({ error: 'lat은 -90~90, lng는 -180~180 숫자여야 합니다' }, 400);
        const input: ResolveInput = { name, near: hasLat ? { lat: raw.lat as number, lng: raw.lng as number } : null };
        return input;
      }),
      async (c) => {
        const { name, near } = c.req.valid('json');
        const d = c.var.seat.data;
        let allowed: boolean | null = null;
        const gate = () => (allowed ??= deps.allow(c));
        const body = (
          via: ResolveVia,
          source: SearchSource | 'none',
          candidates: PublicCandidate[],
          total: number,
          memory: { place: PublicMemoryPlace; ambiguous: boolean } | null = null,
        ) => c.json({ memory, candidates, total, source, via }, 200);

        // 1. 좌표가 있으면 그대로(글자가 좌표), 정확한 주소면 주소 → 좌표(검색하지 않는다).
        const coords = parseCoordinateText(name);
        if (coords) {
          const here = { id: `coord:${coords.lat},${coords.lng}`, name: '지정한 위치', address: '', ...coords, distanceMeters: null };
          return body('coordinates', 'none', [here], 1);
        }
        if (looksLikeAddress(name)) {
          if (!gate()) return rateLimited(c);
          const geo = await deps.search.geocodeAddress(name);
          if (geo.place) {
            const { lat, lng } = geo.place;
            return body('address', geo.source, [{ id: `addr:${lat},${lng}`, ...geo.place, distanceMeters: null }], 1);
          }
        }
        // 2. 기억(이름 → 장소)이 있으면 1순위 후보. 검색하지 않는다. 애매한 이름이면 차가 매번 확인한다.
        const remembered = d.memory.get(name);
        if (remembered) return body('memory', 'none', [], 0, { place: remembered.place, ambiguous: remembered.ambiguous });
        // 3. 검색(현재 위치 기준 가까운 순). 가까운 2개만 후보로 내고 total로 0개·1개·2개 이상을 가른다.
        if (!gate()) return rateLimited(c);
        const found = await deps.search.searchKeyword({ query: name, near: near ?? undefined, limit: MAX_CANDIDATES });
        return body('search', found.source, found.places.slice(0, MAX_CANDIDATES), found.total);
      },
    )
    /**
     * 차가 부른다(정책서 11장 `PUT /places/memory`): '이름 → 장소, 애매 여부'를 그 자리에 저장한다. 같은 이름(정규화해서 같은 것)은 덮어쓴다.
     * 자리는 차 토큰 + `driver=`로 정한다(옛 호환: driver 없으면 그 차의 지난번 고른 자리, 식별 없으면 기본 자리).
     */
    .put(
      '/memory',
      guard.carWrite,
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
        const opened = c.var.seat.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        return c.json(opened.data.memory.put(c.req.valid('json')), 200);
      },
    )
    /** 폰: 이 자리가 기억한 장소 목록(최근에 쓴 것부터). 차 토큰 + driver도 읽을 수 있다. */
    .get('/memory', guard.read, (c) => c.json({ memories: c.var.seat.data.memory.list() }, 200))
    /** 폰: 기억 하나 지우기(정책서 10.8 '기억한 장소 지우기'). 이름은 URL 인코딩해서 보낸다. 없으면 404. */
    .delete('/memory/:name', guard.write, (c) => {
      const name = c.req.param('name');
      if (normalizePlaceName(name) === '' || name.length > MAX_MEMORY_NAME_LENGTH) return c.json({ error: '지울 기억의 이름이 올바르지 않습니다' }, 400);
      // 지우기는 버킷을 만들지 않는다(없으면 비어 있는 읽기용 데이터라 404).
      if (!c.var.seat.data.memory.delete(name)) return c.json({ error: '그 이름으로 기억한 장소가 없습니다' }, 404);
      return c.json({ name: clean(name) }, 200);
    });
