import { EXTERNAL_TIMEOUT_MS, OPINET_MAX_RADIUS_METERS } from './constants.js';
import { katecToWgs84, wgs84ToKatec } from './geo.js';
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
 * KATEC 변환식(geo.ts 주석), 브랜드 필드 철자(표는 POLL_DIV_CD, 예시는 POLL_DIV_CO라 둘 다 읽는다).
 */
export const OPINET_AROUND_URL = 'https://www.opinet.co.kr/api/aroundAll.do';

const PRODUCT_CODE: Record<PumpFuel, string> = { gasoline: 'B027', diesel: 'D047' };

/** 한반도와 그 둘레. 밖에서는 KATEC 변환이 의미가 없어 호출하지 않는다. */
const KOREA_BOUNDS = { latMin: 32.5, latMax: 39.5, lngMin: 123.5, lngMax: 132.5 };
const inKorea = (p: LatLng) => p.lat >= KOREA_BOUNDS.latMin && p.lat <= KOREA_BOUNDS.latMax && p.lng >= KOREA_BOUNDS.lngMin && p.lng <= KOREA_BOUNDS.lngMax;

/** aroundAll.do XML 응답을 주유소 목록으로. 가격·좌표가 숫자가 아닌 항목은 거른다. */
export function parseAroundXml(xml: string): FuelStation[] {
  const out: FuelStation[] = [];
  for (const r of xmlRecords(xml, 'OIL')) {
    const price = Number(r.PRICE);
    const x = Number(r.GIS_X_COOR);
    const y = Number(r.GIS_Y_COOR);
    if (!r.UNI_ID || !r.OS_NM || r.PRICE === undefined || r.GIS_X_COOR === undefined || r.GIS_Y_COOR === undefined) continue;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const { lat, lng } = katecToWgs84(x, y);
    out.push({ id: r.UNI_ID, name: r.OS_NM, brand: r.POLL_DIV_CD || r.POLL_DIV_CO || null, lat, lng, price });
  }
  return out;
}

export type OpinetOptions = { certKey: string; fetchImpl?: typeof fetch; timeoutMs?: number };

/** 오류 메시지에는 URL·키를 넣지 않는다. */
export function createOpinetSource({ certKey, fetchImpl = fetch, timeoutMs = EXTERNAL_TIMEOUT_MS }: OpinetOptions): FuelStationSource {
  return {
    kind: 'live',
    async findNear(center, radiusMeters, fuel) {
      if (!inKorea(center)) return [];
      const { x, y } = wgs84ToKatec(center);
      const params = new URLSearchParams({
        certkey: certKey,
        out: 'xml',
        x: x.toFixed(1),
        y: y.toFixed(1),
        radius: String(Math.min(OPINET_MAX_RADIUS_METERS, Math.round(radiusMeters))),
        prodcd: PRODUCT_CODE[fuel],
        sort: '1',
      });
      let res: Response;
      try {
        res = await fetchImpl(`${OPINET_AROUND_URL}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new Error('오피넷 API에 연결하지 못했습니다');
      }
      if (!res.ok) throw new Error(`오피넷 API가 오류를 돌려줬습니다(HTTP ${res.status})`);
      const text = await res.text();
      if (!text.includes('<RESULT')) throw new Error('오피넷 API 응답 형식을 읽지 못했습니다');
      return parseAroundXml(text);
    },
  };
}
