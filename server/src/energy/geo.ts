import type { LatLng } from './types.js';

const EARTH_RADIUS_METERS = 6_371_000;
const RAD = Math.PI / 180;

/** 두 점 사이 대원 거리(m). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 선분 위 점 p에서 선분 a→b까지의 거리(m)와, 가장 가까운 점이 선분 위 어디쯤인지(0=출발, 1=도착). */
export type SegmentDistance = { meters: number; progress: number };

/**
 * 점에서 선분 a→b까지의 수직(끝은 끝점) 거리. 경로 모양을 모르는 상태에서 '경로에서 벗어난 거리'를 근사하는 가안이다.
 * 선분 중간 위도를 기준으로 등장방형 평면에 펴서 계산한다(수백 km 안에서 오차 1% 안쪽).
 */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): SegmentDistance {
  const midLat = (a.lat + b.lat) / 2;
  const kx = Math.cos(midLat * RAD) * EARTH_RADIUS_METERS * RAD;
  const ky = EARTH_RADIUS_METERS * RAD;
  const ax = a.lng * kx;
  const ay = a.lat * ky;
  const dx = b.lng * kx - ax;
  const dy = b.lat * ky - ay;
  const px = p.lng * kx - ax;
  const py = p.lat * ky - ay;
  const len2 = dx * dx + dy * dy;
  const progress = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
  return { meters: Math.hypot(px - progress * dx, py - progress * dy), progress };
}

/** a→b 선분 위 progress(0~1) 지점. */
export const pointAlong = (a: LatLng, b: LatLng, progress: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * progress,
  lng: a.lng + (b.lng - a.lng) * progress,
});

// --- KATEC <-> WGS84 -------------------------------------------------------
// 오피넷 aroundAll.do는 기준 좌표(x, y)를 KATEC으로 받고 응답 좌표(GIS_X_COOR, GIS_Y_COOR)도 KATEC이다
// (https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=3). 문서에는 좌표계 이름만 있고 변환식은 없다.
// KATEC은 EPSG 코드가 없는 비공식 좌표계라, 아래 변환 값은 널리 쓰이는 정의(Bessel 1841 + TM, 위도 38도·경도 128도,
// 축척 0.9999, 가산 400000/600000, towgs84 = -146.43, 507.89, 681.46)이며 오피넷이 공식으로 밝힌 값은 아니다(미확인).
// 문서의 예시 좌표(서울 강남, x=314681.8 y=544837)가 강남 일대로 변환되는지만 테스트로 확인했다.

type Ellipsoid = { a: number; e2: number };
const ellipsoid = (a: number, invF: number): Ellipsoid => {
  const f = 1 / invF;
  return { a, e2: f * (2 - f) };
};
const WGS84 = ellipsoid(6_378_137, 298.257223563);
const BESSEL = ellipsoid(6_377_397.155, 299.1528128);
const SHIFT = { dx: -146.43, dy: 507.89, dz: 681.46 }; // WGS84 = Bessel + SHIFT

const KATEC = { lat0: 38 * RAD, lng0: 128 * RAD, k0: 0.9999, x0: 400_000, y0: 600_000 };

function toEcef(latDeg: number, lngDeg: number, e: Ellipsoid): [number, number, number] {
  const lat = latDeg * RAD;
  const lng = lngDeg * RAD;
  const n = e.a / Math.sqrt(1 - e.e2 * Math.sin(lat) ** 2);
  return [n * Math.cos(lat) * Math.cos(lng), n * Math.cos(lat) * Math.sin(lng), n * (1 - e.e2) * Math.sin(lat)];
}

function fromEcef(x: number, y: number, z: number, e: Ellipsoid): LatLng {
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e.e2));
  for (let i = 0; i < 8; i++) {
    const n = e.a / Math.sqrt(1 - e.e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + e.e2 * n * Math.sin(lat), p);
  }
  return { lat: lat / RAD, lng: Math.atan2(y, x) / RAD };
}

const meridianArc = (lat: number, e: Ellipsoid) => {
  const { a, e2 } = e;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  return (
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * lat -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * lat) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * lat) -
      ((35 * e6) / 3072) * Math.sin(6 * lat))
  );
};

/** WGS84 위경도(도) → KATEC (x, y). 한반도 밖 값은 의미가 없다. */
export function wgs84ToKatec(p: LatLng): { x: number; y: number } {
  const [wx, wy, wz] = toEcef(p.lat, p.lng, WGS84);
  const b = fromEcef(wx - SHIFT.dx, wy - SHIFT.dy, wz - SHIFT.dz, BESSEL);
  const lat = b.lat * RAD;
  const lng = b.lng * RAD;
  const { a, e2 } = BESSEL;
  const ep2 = e2 / (1 - e2);
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const t = Math.tan(lat) ** 2;
  const c = ep2 * Math.cos(lat) ** 2;
  const aa = (lng - KATEC.lng0) * Math.cos(lat);
  const x =
    KATEC.x0 +
    KATEC.k0 * n * (aa + ((1 - t + c) * aa ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa ** 5) / 120);
  const y =
    KATEC.y0 +
    KATEC.k0 *
      (meridianArc(lat, BESSEL) -
        meridianArc(KATEC.lat0, BESSEL) +
        n * Math.tan(lat) * ((aa * aa) / 2 + ((5 - t + 9 * c + 4 * c * c) * aa ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa ** 6) / 720));
  return { x, y };
}

/** KATEC (x, y) → WGS84 위경도(도). */
export function katecToWgs84(x: number, y: number): LatLng {
  const { a, e2 } = BESSEL;
  const ep2 = e2 / (1 - e2);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const m = meridianArc(KATEC.lat0, BESSEL) + (y - KATEC.y0) / KATEC.k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const c1 = ep2 * Math.cos(phi1) ** 2;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = (x - KATEC.x0) / (n1 * KATEC.k0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lng =
    KATEC.lng0 +
    (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(phi1);
  const [bx, by, bz] = toEcef(lat / RAD, lng / RAD, BESSEL);
  return fromEcef(bx + SHIFT.dx, by + SHIFT.dy, bz + SHIFT.dz, WGS84);
}
