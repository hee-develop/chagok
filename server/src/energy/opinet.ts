import {
  EXTERNAL_TIMEOUT_MS,
  OPINET_CACHE_MAX_ENTRIES,
  OPINET_CACHE_TTL_MS,
  OPINET_GRID_DEGREES,
  OPINET_MAX_CONCURRENT,
  OPINET_MAX_QUEUE,
  OPINET_MAX_RADIUS_METERS,
  OPINET_MAX_RESPONSE_BYTES,
} from './constants.js';
import { createGate, joinFlight, type Flight } from './flight.js';
import { inSouthKorea, katecToWgs84, wgs84ToKatec } from './geo.js';
import { readTextCapped, withTimeout } from './http.js';
import { detach } from './strings.js';
import type { FuelStation, FuelStationSource, LatLng, PumpFuel } from './types.js';
import { xmlRecords } from './xml.js';

/**
 * 오피넷(한국석유공사) 반경 내 주유소 어댑터. 확인한 공식 문서:
 * - https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=3 (반경 내 주유소: aroundAll.do)
 * 문서에서 확인한 것: 요청 URL `https://www.opinet.co.kr/api/aroundAll.do`, 변수 certkey·out(xml|json)·x·y(KATEC)·
 * radius(m, 최대 5000)·prodcd(B027 휘발유, D047 경유 등)·sort(1 가격순, 2 거리순)가 모두 필수, 응답 필드 UNI_ID·
 * POLL_DIV_CD·OS_NM·PRICE·DISTANCE·GIS_X_COOR·GIS_Y_COOR(KATEC)와 XML 예시. 그래서 요청 좌표를 WGS84 → KATEC으로,
 * 응답 좌표를 KATEC → WGS84로 바꾼다(geo.ts).
 * 문서에 없어 미확인인 것: JSON 응답 구조(XML만 쓴다), 한 번에 돌려주는 개수 상한, 오류 응답 모양, 호출 한도,
 * KATEC 변환식(geo.ts 주석, 정밀도 미검증), 브랜드 필드 철자(표는 POLL_DIV_CD, 예시는 POLL_DIV_CO라 둘 다 읽는다).
 *
 * 호출 증폭 방지: (반올림한 좌표, 반경, 연료) 키로 짧게 캐시하고, 같은 키의 동시 호출은 하나로 합치고,
 * 서버 전체 동시 호출 수와 대기열을 제한한다. 요청 전체 제한 시간이 지나면(signal) 아직 나가지 않은 호출은 나가지 않는다.
 */
export const OPINET_AROUND_URL = 'https://www.opinet.co.kr/api/aroundAll.do';

const PRODUCT_CODE: Record<PumpFuel, string> = { gasoline: 'B027', diesel: 'D047' };

const OIL_FIELDS = ['UNI_ID', 'POLL_DIV_CD', 'POLL_DIV_CO', 'OS_NM', 'PRICE', 'GIS_X_COOR', 'GIS_Y_COOR'] as const;

/**
 * aroundAll.do XML 응답을 주유소 목록으로. 가격·좌표가 숫자가 아닌 항목은 거른다.
 * 결과는 캐시에 5분 동안 남으므로 글자는 응답 원문을 붙잡지 않게 복사해 담는다.
 */
export function parseAroundXml(xml: string): FuelStation[] {
  const out: FuelStation[] = [];
  for (const r of xmlRecords(xml, 'OIL', OIL_FIELDS)) {
    const price = Number(r.PRICE);
    const x = Number(r.GIS_X_COOR);
    const y = Number(r.GIS_Y_COOR);
    if (!r.UNI_ID || !r.OS_NM || r.PRICE === undefined || r.GIS_X_COOR === undefined || r.GIS_Y_COOR === undefined) continue;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const { lat, lng } = katecToWgs84(x, y);
    const brand = r.POLL_DIV_CD || r.POLL_DIV_CO;
    out.push({ id: detach(r.UNI_ID), name: detach(r.OS_NM), brand: brand ? detach(brand) : null, lat, lng, price });
  }
  return out;
}

export type OpinetOptions = {
  certKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  maxConcurrent?: number;
  maxQueue?: number;
  /** 캐시 항목 수 상한(기본 OPINET_CACHE_MAX_ENTRIES). 테스트에서 바꾼다. */
  cacheMaxEntries?: number;
};

const snap = (v: number) => Math.round(v / OPINET_GRID_DEGREES) * OPINET_GRID_DEGREES;

/** 오류 메시지에는 URL·키를 넣지 않는다. */
export function createOpinetSource({
  certKey,
  fetchImpl = fetch,
  timeoutMs = EXTERNAL_TIMEOUT_MS,
  now = Date.now,
  maxConcurrent = OPINET_MAX_CONCURRENT,
  maxQueue = OPINET_MAX_QUEUE,
  cacheMaxEntries = OPINET_CACHE_MAX_ENTRIES,
}: OpinetOptions): FuelStationSource {
  const cache = new Map<string, { at: number; stations: FuelStation[] }>();
  const flights = new Map<string, Flight<FuelStation[]>>();
  const gate = createGate(maxConcurrent, maxQueue);

  async function request(center: LatLng, radius: number, fuel: PumpFuel, signal: AbortSignal): Promise<FuelStation[]> {
    const { x, y } = wgs84ToKatec(center);
    const params = new URLSearchParams({
      certkey: certKey,
      out: 'xml',
      x: x.toFixed(1),
      y: y.toFixed(1),
      radius: String(radius),
      prodcd: PRODUCT_CODE[fuel],
      sort: '1',
    });
    let res: Response;
    try {
      res = await fetchImpl(`${OPINET_AROUND_URL}?${params}`, { signal: withTimeout(timeoutMs, signal) });
    } catch {
      throw new Error('오피넷 API에 연결하지 못했습니다');
    }
    if (!res.ok) throw new Error(`오피넷 API가 오류를 돌려줬습니다(HTTP ${res.status})`);
    let text: string;
    try {
      text = await readTextCapped(res, OPINET_MAX_RESPONSE_BYTES);
    } catch (e) {
      throw new Error(e instanceof Error && e.message.includes('너무 큽니다') ? e.message : '오피넷 API 응답을 읽지 못했습니다');
    }
    if (!text.includes('<RESULT')) throw new Error('오피넷 API 응답 형식을 읽지 못했습니다');
    return parseAroundXml(text);
  }

  /** 오래된 항목을 지우고, 항목 수가 상한을 넘으면 가장 오래 안 쓴 것부터 버린다. */
  function prune(t: number) {
    for (const [k, v] of cache) if (t - v.at >= OPINET_CACHE_TTL_MS) cache.delete(k);
    while (cache.size > cacheMaxEntries) cache.delete(cache.keys().next().value as string);
  }

  return {
    kind: 'live',
    async findNear(center, radiusMeters, fuel, signal) {
      if (!inSouthKorea(center)) return [];
      const grid = { lat: snap(center.lat), lng: snap(center.lng) };
      const radius = Math.min(OPINET_MAX_RADIUS_METERS, Math.max(1, Math.round(radiusMeters)));
      const key = `${fuel}|${grid.lat.toFixed(3)}|${grid.lng.toFixed(3)}|${radius}`;
      const t = now();
      prune(t);
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key); // 최근에 쓴 것으로 옮긴다
        cache.set(key, hit);
        return hit.stations;
      }
      return joinFlight(
        flights,
        key,
        (sig) =>
          gate.run(sig, async () => {
            const stations = await request(grid, radius, fuel, sig);
            cache.set(key, { at: now(), stations });
            prune(now());
            return stations;
          }),
        signal,
      );
    },
  };
}
