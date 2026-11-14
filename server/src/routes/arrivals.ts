import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import {
  FREQUENT_ARRIVALS_OVER,
  MAX_PLACE_ADDRESS_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  favoriteSpots,
  rankCandidates,
  withoutCurrentHome,
  type ArrivalPlace,
} from '../arrivals.js';
import type { MockPlace, PlacesCatalog } from '../fixture-types.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';
import { bearerOf, type SeatEnv, type SeatGuard } from '../seatScope.js';
import type { SeatStore } from '../seats.js';
import { DAY_MS, MINUTE_MS, parseAt } from '../time.js';

/** `POST /arrivals`의 `at`은 서버 시각보다 이만큼(시계 오차) 넘게 미래일 수 없다(가안). */
export const ARRIVAL_FUTURE_SKEW_MS = 10 * MINUTE_MS;
/** `POST /arrivals`의 `at`은 서버 시각보다 이만큼 넘게 과거일 수 없다. 차가 오프라인일 때 모았다 보내는 여유(가안). */
export const ARRIVAL_PAST_LIMIT_MS = 3 * DAY_MS;

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: `본문은 ${MAX_BODY_BYTES}바이트 이하여야 합니다` }, 413) });
const unauthorized = (c: Context, error: string) => c.json({ error, reason: 'unauthorized' as const }, 401);
const forbidden = (c: Context, error: string) => c.json({ error, reason: 'forbidden' as const }, 403);

/** 요청 주체: 차 토큰(`car`), 폰 토큰(`phone`), 토큰 없음(`none`). 모르는 토큰·이상한 형식은 자리 정하기 단계에서 이미 401로 걸러진다. */
const callerOf = (seats: SeatStore, c: Context): 'car' | 'phone' | 'none' => {
  const auth = bearerOf(c);
  if (auth.kind !== 'token') return 'none';
  return seats.seatByToken(auth.token) ? 'phone' : seats.carByToken(auth.token) ? 'car' : 'none';
};

const publicArrival = (p: ArrivalPlace) => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, count: p.count, lastDate: p.lastDate });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOnly = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));

type ParsedArrival = {
  scheduleId: string | null;
  place: { name: string; address: string | null; lat: number; lng: number };
  at: Date | null;
};
type Parsed = { ok: true; value: ParsedArrival } | { ok: false; error: string };

function parseArrival(raw: unknown): Parsed {
  if (!isObject(raw) || !hasOnly(raw, ['scheduleId', 'place', 'at'])) return { ok: false, error: '본문은 { scheduleId?, place, at? } 객체여야 합니다' };
  let scheduleId: string | null = null;
  if (raw.scheduleId !== undefined && raw.scheduleId !== null) {
    if (typeof raw.scheduleId !== 'string' || raw.scheduleId === '' || raw.scheduleId.length > MAX_ID_LENGTH) {
      return { ok: false, error: `scheduleId는 1~${MAX_ID_LENGTH}자 문자열이어야 합니다` };
    }
    scheduleId = raw.scheduleId;
  }
  const p = raw.place;
  if (!isObject(p) || !hasOnly(p, ['name', 'lat', 'lng', 'address'])) return { ok: false, error: 'place는 { name, lat, lng, address? } 객체여야 합니다' };
  const name = typeof p.name === 'string' ? p.name.trim().replace(/\s+/g, ' ') : '';
  if (name === '' || name.length > MAX_PLACE_NAME_LENGTH) return { ok: false, error: `place.name은 1~${MAX_PLACE_NAME_LENGTH}자 문자열이어야 합니다` };
  if (typeof p.lat !== 'number' || !Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90) return { ok: false, error: 'place.lat은 -90~90 숫자여야 합니다' };
  if (typeof p.lng !== 'number' || !Number.isFinite(p.lng) || p.lng < -180 || p.lng > 180) return { ok: false, error: 'place.lng는 -180~180 숫자여야 합니다' };
  let address: string | null = null;
  if (p.address !== undefined && p.address !== null) {
    if (typeof p.address !== 'string' || p.address.length > MAX_PLACE_ADDRESS_LENGTH) return { ok: false, error: `place.address는 ${MAX_PLACE_ADDRESS_LENGTH}자 이하 문자열이어야 합니다` };
    address = p.address.trim() === '' ? null : p.address.trim();
  }
  let at: Date | null = null;
  if (raw.at !== undefined && raw.at !== null) {
    at = typeof raw.at === 'string' ? parseAt(raw.at) : null;
    if (at === null) return { ok: false, error: 'at은 오프셋이 있는 ISO8601 시각이어야 합니다' };
  }
  return { ok: true, value: { scheduleId, place: { name, address, lat: p.lat, lng: p.lng }, at } };
}

/**
 * 도착 기록(정책서 API `POST /arrivals`, 차가 부름). 도착한 장소의 도착 횟수를 +1하고 마지막 날짜를 갱신한다.
 * 차 토큰 + `driver=<seatId>`가 필수다(옛 차 앱 호환 읽기 없음, `placeWrite`). 폰 토큰·기기 id·식별 없음(자리 있는 서버)은 거절한다.
 * 자리 있는 차가 하나도 없는 서버의 식별 없는 요청만 기본 자리(데모·E2E)에 기록한다.
 */
export const createArrivalsRoute = (guard: SeatGuard, seats: SeatStore, { now = () => new Date() }: { now?: () => Date } = {}) =>
  new Hono<SeatEnv>().post(
    '/',
    guard.placeWrite,
    tooLarge,
    validator('json', (raw: unknown, c) => {
      const parsed = parseArrival(raw);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const { at, ...rest } = parsed.value;
      const t = now().getTime();
      if (at !== null && (at.getTime() > t + ARRIVAL_FUTURE_SKEW_MS || at.getTime() < t - ARRIVAL_PAST_LIMIT_MS)) {
        return c.json({ error: 'at은 지금 기준 3일 전 ~ 10분 뒤 사이여야 합니다', reason: 'at-out-of-range' as const }, 400);
      }
      return { ...rest, at: at ?? new Date(t) };
    }),
    (c) => {
      const sc = c.var.seat;
      const caller = callerOf(seats, c);
      if (caller === 'phone') return forbidden(c, '도착 기록은 차(차 토큰 + driver)만 보낼 수 있습니다');
      // 차 토큰이 없으면 자리 있는 차가 없는 서버의 기본 자리(데모·차량 E2E)만 받는다.
      if (caller === 'none' && sc.kind !== 'default') return unauthorized(c, '도착 기록에는 차 토큰과 driver=<자리 id>가 필요합니다');
      const opened = sc.open();
      if (!opened.ok) return unauthorized(c, '도착 기록에는 차 토큰과 driver=<자리 id>가 필요합니다');
      const { scheduleId, place, at } = c.req.valid('json');
      const result = opened.data.arrivals.record({ ...place, scheduleId, at });
      return c.json({ counted: result.counted, place: result.place === null ? null : publicArrival(result.place) }, 200);
    },
  );

/**
 * `/places` 아래의 도착 횟수·자주 가는 곳 후보 API(`/places`에 두 번째로 붙인다).
 * - `GET /places/frequent`(차): 자주 가는 곳 후보. 차 토큰이면 `driver=<seatId>`가 필수다(옛 호환 없음). 선택 `lat`·`lng`(둘 다)가 집 반경 안이면 집을 뺀다.
 * - `GET /places/arrivals`(폰): 도착 횟수 목록(횟수 많은 순). 폰 토큰·기기 id(빈 목록)·기본 자리만, 차 토큰은 403.
 * - `DELETE /places/arrivals/:id`(폰): 장소 하나의 도착 횟수를 지운다('사용자가 지울 때까지' 보관하는 항목, 정책서 11장).
 */
export const createFrequentRoute = (catalog: PlacesCatalog, guard: SeatGuard, seats: SeatStore) => {
  const places = new Map<string, MockPlace>([...catalog.places, ...catalog.suggestions].map((p) => [p.id, p]));
  const phoneOnly = (c: Context) => (callerOf(seats, c) === 'car' ? forbidden(c, '도착 횟수 목록은 폰에서만 보고 지울 수 있습니다') : null);
  return new Hono<SeatEnv>()
    .get(
      '/frequent',
      guard.placeRead,
      validator('query', (value: { lat?: string | string[]; lng?: string | string[] }, c) => {
        const { lat, lng } = value;
        if (lat === undefined && lng === undefined) return { here: null as { lat: number; lng: number } | null };
        if (typeof lat !== 'string' || typeof lng !== 'string' || lat.trim() === '' || lng.trim() === '') return c.json({ error: 'lat와 lng는 함께 숫자 하나씩 보내야 합니다' }, 400);
        const here = { lat: Number(lat), lng: Number(lng) };
        if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng) || Math.abs(here.lat) > 90 || Math.abs(here.lng) > 180) {
          return c.json({ error: 'lat는 -90~90, lng는 -180~180 숫자여야 합니다' }, 400);
        }
        return { here: here as { lat: number; lng: number } | null };
      }),
      (c) => {
        const d = c.var.seat.data;
        const ranked = rankCandidates(favoriteSpots(places, d.favorites.get()), d.arrivals.list());
        const { here } = c.req.valid('query');
        const { candidates, homeExcluded } = here === null ? { candidates: ranked, homeExcluded: false } : withoutCurrentHome(ranked, here);
        return c.json({ candidates, threshold: FREQUENT_ARRIVALS_OVER, homeExcluded }, 200);
      },
    )
    .get('/arrivals', guard.placeRead, (c) => {
      const denied = phoneOnly(c);
      if (denied) return denied;
      const arrivals = c.var.seat.data.arrivals.list().map((p) => ({ ...publicArrival(p), qualifies: p.count > FREQUENT_ARRIVALS_OVER }));
      return c.json({ arrivals, threshold: FREQUENT_ARRIVALS_OVER }, 200);
    })
    .delete('/arrivals/:id', guard.placeWrite, (c) => {
      const denied = phoneOnly(c);
      if (denied) return denied;
      const id = c.req.param('id');
      // 기기 id만 있는 폰의 연결 전 버킷은 만들지 않는다(읽기만 하므로 `open()`을 부르지 않는다). 없는 id는 404.
      if (!c.var.seat.data.arrivals.remove(id)) return c.json({ error: '그 도착 횟수 기록이 없습니다' }, 404);
      return c.json({ removed: true as const, id }, 200);
    });
};
