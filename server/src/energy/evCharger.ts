import {
  EV_CACHE_TTL_MS,
  EV_CHARGER_OBJECT_BYTES,
  EV_FAILURE_BACKOFF_MAX_MS,
  EV_FAILURE_BACKOFF_MS,
  EV_LOAD_TIMEOUT_MS,
  EV_MAX_CACHED_BYTES,
  EV_MAX_CACHED_CHARGERS,
  EV_MAX_CONCURRENT_LOADS,
  EV_MAX_CONCURRENT_PAGES,
  EV_MAX_PAGE_BYTES,
  EV_MAX_STALE_MS,
  EV_REGION_MARGIN_METERS,
  EV_REGIONS_MAX_PER_QUERY,
  EXTERNAL_TIMEOUT_MS,
  FAST_CHARGER_MIN_KW,
} from './constants.js';
import { createGate, waitFor } from './flight.js';
import { haversineMeters, inSouthKorea } from './geo.js';
import { readTextCapped, withTimeout } from './http.js';
import { createInterner, type Interner } from './strings.js';
import type { Charger, ChargerSource, ChargerSpeed, ChargerState, LatLng, NearInfo } from './types.js';
import { xmlRecords, xmlValue } from './xml.js';

/**
 * 한국환경공단 전기자동차 충전소 정보(환경부) 어댑터. 근거는 공식 「한국환경공단_전기자동차 충전소 정보_OpenAPI활용가이드 v1.25」
 * (https://www.data.go.kr/data/15076352/openapi.do 의 참고문서, 2026-11-15에 내려받아 직접 확인)다.
 *
 * 가이드에서 확인한 것:
 * - 오퍼레이션 `getChargerInfo`(충전기 정보 조회). 요청 변수 serviceKey(인증키 URL Encode)·pageNo·numOfRows(10~9999)·
 *   zcode(시도 코드)·zscode(시군구 코드, 5자리)·kind·kindDetail·statId·chgerId·dataType(JSON|XML, 필수). 좌표·반경 조건 변수는 없다.
 * - 응답 XML 구조 response/header(resultCode·resultMsg·totalCount·pageNo·numOfRows)/body/items/item, 응답 필드
 *   statNm·statId·chgerId·chgerType·addr·lat·lng·stat·output(충전용량 kW, 예시 3·7·50·100·200)·zcode·zscode·parkingFree·limitYn·delYn 등,
 *   응답 예시의 powerType("급속(100kW동시)", 필드 표에는 없고 예시에만 있다).
 * - 코드표: stat 0 알수없음·1 통신이상·2 충전대기·3 충전중·4 운영중지·5 점검중·6 예약중·9 상태미확인, chgerType 01~11(11은 'DC콤보2(버스전용)'),
 *   zcode 11·12(전남광주통합특별시)·26·27·28·30·31·36·41·43·44·47·48·50·51(강원특별자치도)·52(전북특별자치도).
 * - 가이드의 운영환경 서비스 URL은 http://apis.data.go.kr/B552584/EvCharger 이고 포털 상세 페이지는 https로 적혀 있다. https를 쓴다.
 *
 * 가이드에 없거나 확인하지 못한 것(실제 키로 확인 필요): 실제 응답이 위 구조와 같은지, 광주·전남이 zcode 12로 합쳐진 뒤 옛 코드 29·46이
 * 아직 데이터를 주는지(그래서 12와 29·46을 함께 부르고 하나라도 받아지면 쓴다), 급속·완속을 가르는 kW 기준(constants.ts, 가안),
 * 시도 하나의 충전기 수(15쪽까지만 받음), 하루 호출 한도, 키 인코딩(디코딩 키를 쓰면 URLSearchParams가 한 번만 인코딩한다).
 *
 * 시군구(zscode)로 받는 범위를 좁히려면 좌표 → 시군구를 판정할 경계 자료가 필요한데 가이드·이 저장소에 없어, 시도 단위로 받는다.
 * 대신 호출 증폭과 메모리 폭주를 막으려고: 같은 시도의 동시 받기는 하나로 합치고, 서버 전체 동시 받기(시도 수·한꺼번에 받는 쪽 수)를 제한하고,
 * 쪽을 받는 즉시 필요한 필드만 읽어 원문을 버리고, 한 쪽 응답 바이트와 메모리에 두는 충전기 수·추정 바이트를 제한하고(가장 오래 안 쓴 시도부터 버림),
 * 오래된 시도 데이터를 지운다. 남한 영토 밖 좌표는 호출하지 않는다.
 */
export const EV_CHARGER_BASE_URL = 'https://apis.data.go.kr/B552584/EvCharger';
const PAGE_SIZE = 9999;
/** 시도 하나에서 받을 최대 페이지 수(9999건 x 15쪽). 넘는 지역은 앞쪽만 쓴다(미확인: 경기도 충전기 수). */
const MAX_PAGES_PER_ZCODE = 15;
/** 시도 데이터 한 쪽을 받는 제한 시간. 호출자는 EXTERNAL_TIMEOUT_MS만 기다리고, 받기는 뒤에서 이어진다. */
const PAGE_TIMEOUT_MS = 30_000;

/** 시도 앵커 좌표(가안, 가까운 시도를 고르는 데만 쓴다)와 환경부 시도 코드. 큰 시도는 여러 도시를 앵커로 둔다. */
type Region = { name: string; anchors: LatLng[]; zcodes: string[] };
export const REGIONS: Region[] = [
  { name: '서울', anchors: [{ lat: 37.5665, lng: 126.978 }], zcodes: ['11'] },
  { name: '부산', anchors: [{ lat: 35.1796, lng: 129.0756 }, { lat: 35.2, lng: 128.95 }], zcodes: ['26'] },
  { name: '대구', anchors: [{ lat: 35.8714, lng: 128.6014 }], zcodes: ['27'] },
  { name: '인천', anchors: [{ lat: 37.4563, lng: 126.7052 }, { lat: 37.75, lng: 126.48 }], zcodes: ['28'] },
  // 광주와 전남은 가이드 v1.25에서 zcode 12로 합쳐졌다. 옛 코드 29(광주)·46(전남)도 함께 부른다(하나라도 받아지면 쓴다).
  {
    name: '광주·전남',
    anchors: [
      { lat: 35.1595, lng: 126.8526 },
      { lat: 34.8118, lng: 126.3922 },
      { lat: 34.7604, lng: 127.6622 },
      { lat: 34.9506, lng: 127.4875 },
      { lat: 34.5736, lng: 126.599 },
      { lat: 35.32, lng: 126.99 },
    ],
    zcodes: ['12', '29', '46'],
  },
  { name: '대전', anchors: [{ lat: 36.3504, lng: 127.3845 }], zcodes: ['30'] },
  { name: '울산', anchors: [{ lat: 35.5384, lng: 129.3114 }], zcodes: ['31'] },
  { name: '세종', anchors: [{ lat: 36.48, lng: 127.289 }], zcodes: ['36'] },
  {
    name: '경기',
    anchors: [
      { lat: 37.2636, lng: 127.0286 },
      { lat: 37.42, lng: 127.127 },
      { lat: 37.658, lng: 126.832 },
      { lat: 37.241, lng: 127.178 },
      { lat: 36.992, lng: 127.113 },
      { lat: 37.76, lng: 126.78 },
      { lat: 37.272, lng: 127.435 },
      { lat: 37.49, lng: 127.49 },
      { lat: 37.895, lng: 127.2 },
    ],
    zcodes: ['41'],
  },
  {
    name: '강원',
    anchors: [
      { lat: 37.8813, lng: 127.7298 },
      { lat: 37.7519, lng: 128.8761 },
      { lat: 37.3422, lng: 127.9202 },
      { lat: 38.207, lng: 128.5918 },
      { lat: 37.5247, lng: 129.1143 },
      { lat: 37.164, lng: 128.986 },
      { lat: 37.37, lng: 128.39 },
    ],
    zcodes: ['51'],
  },
  {
    name: '충북',
    anchors: [
      { lat: 36.6424, lng: 127.489 },
      { lat: 36.991, lng: 127.926 },
      { lat: 37.1326, lng: 128.191 },
      { lat: 36.175, lng: 127.7834 },
    ],
    zcodes: ['43'],
  },
  {
    name: '충남',
    anchors: [
      { lat: 36.8151, lng: 127.1139 },
      { lat: 36.4465, lng: 127.119 },
      { lat: 36.6013, lng: 126.66 },
      { lat: 36.7845, lng: 126.45 },
      { lat: 36.3333, lng: 126.6127 },
      { lat: 36.1872, lng: 127.0987 },
      { lat: 36.1087, lng: 127.4881 },
    ],
    zcodes: ['44'],
  },
  {
    name: '전북',
    anchors: [
      { lat: 35.8242, lng: 127.148 },
      { lat: 35.9676, lng: 126.7368 },
      { lat: 35.5699, lng: 126.8559 },
      { lat: 35.4164, lng: 127.3904 },
      { lat: 35.907, lng: 127.66 },
    ],
    zcodes: ['52'],
  },
  {
    name: '경북',
    anchors: [
      { lat: 36.019, lng: 129.3435 },
      { lat: 36.5684, lng: 128.7294 },
      { lat: 36.1195, lng: 128.3446 },
      { lat: 35.8562, lng: 129.2247 },
      { lat: 36.8057, lng: 128.624 },
      { lat: 36.4108, lng: 128.1589 },
      { lat: 36.993, lng: 129.4 },
      { lat: 35.6474, lng: 128.734 },
    ],
    zcodes: ['47'],
  },
  {
    name: '경남',
    anchors: [
      { lat: 35.2279, lng: 128.6811 },
      { lat: 35.18, lng: 128.1076 },
      { lat: 35.2285, lng: 128.8894 },
      { lat: 34.8806, lng: 128.6211 },
      { lat: 35.5038, lng: 128.7465 },
    ],
    zcodes: ['48'],
  },
  { name: '제주', anchors: [{ lat: 33.4996, lng: 126.5312 }, { lat: 33.2541, lng: 126.56 }], zcodes: ['50'] },
];

const distanceToRegion = (p: LatLng, r: Region) => Math.min(...r.anchors.map((a) => haversineMeters(p, a)));

/**
 * 받을 시도. 가장 가까운 앵커까지의 거리에 `marginMeters`(기본 30km)를 더한 범위 안에 앵커가 있는 모든 시도를 가까운 순으로, 최대 `max`(기본 3)곳.
 * 시도 경계를 쓰지 않는 근사라서, 앵커가 시도 중심 도시에만 있으므로 경계 가까이의 충전기가 이웃 시도로 분류돼 있는 경우를 여유 거리로 덮는다.
 * 첫 번째(가장 가까운 시도)는 반드시 받아야 하고 나머지는 실패해도 첫 번째 결과로 답한다(`partial`).
 */
export function regionsNear(center: LatLng, marginMeters = EV_REGION_MARGIN_METERS, max = EV_REGIONS_MAX_PER_QUERY): Region[] {
  const ranked = REGIONS.map((r) => ({ r, d: distanceToRegion(center, r) })).sort((a, b) => a.d - b.d);
  return ranked.filter(({ d }) => d <= ranked[0].d + marginMeters).slice(0, max).map(({ r }) => r);
}

/** 충전기 타입 코드 11('DC콤보2(버스전용)')은 승용차가 쓸 수 없어 뺀다. */
const BUS_ONLY_TYPE = '11';
/** 타입 이름에 '완속'이 들어 있는 코드(02 AC완속, 08 DC콤보(완속)). output·powerType을 모를 때만 쓴다. */
const SLOW_TYPES = new Set(['02', '08']);

const parseKw = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** powerType 글자(예: "급속(100kW동시)")에서 kW 숫자. */
const powerTypeKw = (powerType: string): number | null => {
  const m = /(\d+(?:\.\d+)?)\s*k?w/i.exec(powerType);
  return m ? Number(m[1]) : null;
};

/**
 * 급속·완속과 kW. 1순위 `output`(충전용량 kW): `FAST_CHARGER_MIN_KW` 이상이면 급속. 없으면 powerType 글자('완속'·'급속'과 그 안의 숫자),
 * 그것도 없으면 충전기 타입 코드(02·08은 이름이 '완속', 그 밖은 급속으로 본다. 07 AC3상은 이름에 속도가 없어 급속으로 두며 미확인이다).
 */
export function classifyCharger(chgerType: string, output: string | undefined, powerType: string): { speed: ChargerSpeed; powerKw: number | null } {
  const outputKw = parseKw(output);
  if (outputKw !== null) return { speed: outputKw >= FAST_CHARGER_MIN_KW ? 'fast' : 'slow', powerKw: outputKw };
  const powerKw = powerTypeKw(powerType);
  if (powerType.includes('완속')) return { speed: 'slow', powerKw };
  if (powerType.includes('급속')) return { speed: 'fast', powerKw };
  return { speed: SLOW_TYPES.has(chgerType) ? 'slow' : 'fast', powerKw };
}

/**
 * stat 코드(가이드): 2 충전대기=사용 가능, 3 충전중과 6 예약중=사용 중(자리 없음), 1 통신이상·4 운영중지·5 점검중=쓸 수 없음,
 * 0 알수없음·9 상태미확인과 그 밖은 알 수 없음.
 */
export function mapState(stat: string): ChargerState {
  switch (stat) {
    case '2':
      return 'available';
    case '3':
    case '6':
      return 'charging';
    case '1':
    case '4':
    case '5':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

export type ChargerPage = { resultCode: string | null; resultMsg: string | null; totalCount: number; chargers: Charger[] };

/** 충전기에 쓰는 요소만 읽는다(한 건에 40개 가까운 요소가 있는데 나머지는 만들지 않는다). */
const CHARGER_FIELDS = ['statId', 'chgerId', 'statNm', 'addr', 'busiNm', 'lat', 'lng', 'chgerType', 'stat', 'output', 'powerType', 'parkingFree', 'delYn', 'limitYn'] as const;

/**
 * 충전소 정보 XML 한 쪽을 읽는다. 좌표가 없거나 삭제·이용자 제한 표시가 있거나 버스 전용인 충전기는 거른다.
 * 결과는 캐시에 오래 남으므로 응답 원문을 붙잡지 않게 만든다: 숫자는 숫자로 바꾸고, 글자는 `intern`(기본: 새 표)으로 복사해 담는다.
 * 같은 시도의 여러 쪽을 읽을 때는 같은 `intern`을 넘기면 같은 충전소의 글자를 한 번만 둔다.
 */
export function parseChargerInfoXml(xml: string, intern: Interner = createInterner()): ChargerPage {
  const chargers: Charger[] = [];
  for (const r of xmlRecords(xml, 'item', CHARGER_FIELDS)) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!r.statId || !Number.isFinite(lat) || !Number.isFinite(lng) || r.lat === '' || r.lng === '') continue;
    if (r.delYn === 'Y' || r.limitYn === 'Y' || r.chgerType === BUS_ONLY_TYPE) continue;
    const { speed, powerKw } = classifyCharger(r.chgerType ?? '', r.output, r.powerType ?? '');
    chargers.push({
      stationId: intern(r.statId),
      chargerId: intern(r.chgerId ?? ''),
      name: intern(r.statNm ?? ''),
      address: r.addr ? intern(r.addr) : null,
      lat,
      lng,
      speed,
      state: mapState(r.stat ?? ''),
      powerKw,
      operator: r.busiNm ? intern(r.busiNm) : null,
      parkingFree: r.parkingFree === 'Y' ? true : r.parkingFree === 'N' ? false : null,
    });
  }
  const total = Number(xmlValue(xml, 'totalCount'));
  return {
    resultCode: xmlValue(xml, 'resultCode'),
    resultMsg: xmlValue(xml, 'resultMsg'),
    totalCount: Number.isFinite(total) ? total : chargers.length,
    chargers,
  };
}

export type EvChargerOptions = {
  serviceKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** 호출자가 응답을 기다리는 시간(ms). 기본 EXTERNAL_TIMEOUT_MS. */
  waitMs?: number;
  /** 메모리에 두는 충전기 수 상한(기본 EV_MAX_CACHED_CHARGERS)·추정 바이트 상한(기본 EV_MAX_CACHED_BYTES)과 서버 전체 동시 받기 수(시도, 기본 EV_MAX_CONCURRENT_LOADS)·동시에 받는 쪽 수(기본 EV_MAX_CONCURRENT_PAGES). 테스트에서 바꾼다. */
  maxCachedChargers?: number;
  maxCachedBytes?: number;
  maxConcurrentLoads?: number;
  maxConcurrentPages?: number;
  /** 한 쪽 응답 바이트 상한(기본 EV_MAX_PAGE_BYTES). 테스트에서 바꾼다. */
  maxPageBytes?: number;
  /** 시도 하나를 받는 전체 제한 시간(ms, 기본 EV_LOAD_TIMEOUT_MS). 테스트에서 바꾼다. */
  loadTimeoutMs?: number;
};

/** 인코딩된 키(%)가 들어오면 풀어서 쓴다. 쿼리에 넣을 때 한 번만 인코딩된다. */
const normalizeKey = (key: string) => {
  if (!key.includes('%')) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};

const METERS_PER_DEGREE = 111_194.93;

type CacheEntry = { at: number; chargers: Charger[]; bytes: number };
type RegionResult = { chargers: Charger[]; at: number };

/** 연속 실패 횟수에 따른 쉬는 시간: 30초, 60초, 120초…(상한 있음). */
const backoffMs = (streak: number) => Math.min(EV_FAILURE_BACKOFF_MAX_MS, EV_FAILURE_BACKOFF_MS * 2 ** Math.min(streak - 1, 16));

/**
 * 시도 단위로 받아 메모리에 두고(5분) 반경으로 거른다. 첫 호출은 오래 걸릴 수 있어(수 MB x 여러 쪽) 호출자는
 * waitMs까지만 기다리고 실패(unavailable)로 답하며, 받기는 뒤에서 계속되어(전체 제한 시간 있음) 다음 호출부터 캐시를 쓴다.
 * 받기는 호출자 한 명의 signal에 묶지 않는다(그러면 큰 시도는 영영 캐시가 안 채워진다). 대신 서버 전체 동시 받기 수를 제한한다.
 * 받기에 실패하면 쉬고(30초에서 시작해 연속 실패마다 두 배, 상한 10분), 그동안·그 뒤에도 30분 안의 오래된 캐시가 있으면 그것으로 답한다
 * (이때 `info.staleSince`에 그 데이터의 시각을 채운다). 오류 메시지에는 URL·키를 넣지 않는다.
 */
export function createEvChargerSource({
  serviceKey,
  fetchImpl = fetch,
  now = Date.now,
  waitMs = EXTERNAL_TIMEOUT_MS,
  maxCachedChargers = EV_MAX_CACHED_CHARGERS,
  maxCachedBytes = EV_MAX_CACHED_BYTES,
  maxConcurrentLoads = EV_MAX_CONCURRENT_LOADS,
  maxConcurrentPages = EV_MAX_CONCURRENT_PAGES,
  maxPageBytes = EV_MAX_PAGE_BYTES,
  loadTimeoutMs = EV_LOAD_TIMEOUT_MS,
}: EvChargerOptions): ChargerSource {
  const key = normalizeKey(serviceKey);
  /** Map의 순서가 곧 최근 사용 순서다(맨 앞이 가장 오래 안 쓴 것). */
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<CacheEntry>>();
  const failures = new Map<string, { at: number; streak: number }>();
  /** 서버 전체에서 응답 원문을 들고 있는 쪽 수를 제한한다(받기 시작부터 파싱이 끝나 원문을 버릴 때까지). 기다리는 쪽 수는 제한하지 않는다(시도 수가 이미 제한). */
  const pageGate = createGate(maxConcurrentPages, Number.MAX_SAFE_INTEGER);

  /** 한 쪽을 받아 바로 읽고 원문을 버린다. 돌려주는 충전기는 원문을 붙잡지 않는다. */
  function fetchPage(zcode: string, pageNo: number, signal: AbortSignal, intern: Interner): Promise<ChargerPage> {
    return pageGate.run(signal, async () => {
      const params = new URLSearchParams({ serviceKey: key, pageNo: String(pageNo), numOfRows: String(PAGE_SIZE), zcode, dataType: 'XML' });
      let res: Response;
      try {
        res = await fetchImpl(`${EV_CHARGER_BASE_URL}/getChargerInfo?${params}`, { signal: withTimeout(PAGE_TIMEOUT_MS, signal) });
      } catch {
        throw new Error('충전소 API에 연결하지 못했습니다');
      }
      if (!res.ok) throw new Error(`충전소 API가 오류를 돌려줬습니다(HTTP ${res.status})`);
      let text: string;
      try {
        text = await readTextCapped(res, maxPageBytes);
      } catch (e) {
        throw new Error(e instanceof Error && e.message.includes('너무 큽니다') ? e.message : '충전소 API 응답을 읽지 못했습니다');
      }
      const page = parseChargerInfoXml(text, intern);
      if (page.resultCode !== '00') throw new Error(`충전소 API 결과 코드 ${page.resultCode ?? '없음'}`);
      return page;
    });
  }

  /** 시도 코드 하나의 모든 쪽을 받아 쪽마다 `add`에 넘긴다(쪽을 모아 두지 않는다). */
  async function loadZcode(zcode: string, signal: AbortSignal, intern: Interner, add: (chargers: Charger[]) => void): Promise<void> {
    const first = await fetchPage(zcode, 1, signal, intern);
    add(first.chargers);
    const pages = Math.min(MAX_PAGES_PER_ZCODE, Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE)));
    for (let start = 2; start <= pages; start += 2) {
      const batch = [];
      for (let p = start; p < Math.min(start + 2, pages + 1); p++) batch.push(fetchPage(zcode, p, signal, intern));
      for (const page of await Promise.all(batch)) add(page.chargers);
    }
  }

  /**
   * 시도 하나(코드가 여럿이면 하나라도 받아지면 성공). 같은 충전기가 여러 코드·쪽에서 오면 한 번만 둔다. 쪽이 오는 대로 중복을 버리므로
   * 옛 코드가 새 코드와 같은 데이터를 줘도 두 벌을 들고 있지 않는다. 일부 쪽만 받고 실패한 코드의 충전기는(다른 코드가 성공했다면) 그대로 둔다.
   */
  async function loadRegionData(region: Region): Promise<CacheEntry> {
    const signal = AbortSignal.timeout(loadTimeoutMs);
    const intern = createInterner();
    const seen = new Set<string>();
    const chargers: Charger[] = [];
    const add = (list: Charger[]) => {
      for (const c of list) {
        const id = `${c.stationId}|${c.chargerId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        chargers.push(c);
      }
    };
    const settled = await Promise.allSettled(region.zcodes.map((z) => loadZcode(z, signal, intern, add)));
    if (settled.every((s) => s.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason;
    return { at: now(), chargers, bytes: chargers.length * EV_CHARGER_OBJECT_BYTES + intern.bytes };
  }

  /** 만료(최대 오래된 한도 초과)된 시도를 지운다. */
  function prune(t: number) {
    for (const [k, v] of cache) if (t - v.at >= EV_MAX_STALE_MS) cache.delete(k);
  }

  /** 방금 둔 시도를 빼고, 충전기 수와 추정 바이트가 상한 안에 들 때까지 가장 오래 안 쓴 시도부터 버린다. */
  function store(name: string, entry: CacheEntry) {
    cache.delete(name);
    cache.set(name, entry);
    let count = 0;
    let bytes = 0;
    for (const v of cache.values()) {
      count += v.chargers.length;
      bytes += v.bytes;
    }
    for (const [k, v] of cache) {
      if ((count <= maxCachedChargers && bytes <= maxCachedBytes) || cache.size <= 1 || k === name) break;
      count -= v.chargers.length;
      bytes -= v.bytes;
      cache.delete(k);
    }
  }

  function loadRegion(region: Region): Promise<CacheEntry> {
    const existing = inflight.get(region.name);
    if (existing) return existing;
    if (inflight.size >= maxConcurrentLoads) return Promise.reject(new Error('충전소 API 동시 받기 한도를 넘었습니다'));
    const p = loadRegionData(region).then((entry) => {
      store(region.name, entry);
      failures.delete(region.name);
      return entry;
    });
    inflight.set(region.name, p);
    p.then(
      () => inflight.delete(region.name),
      () => {
        inflight.delete(region.name);
        failures.set(region.name, { at: now(), streak: (failures.get(region.name)?.streak ?? 0) + 1 });
      },
    );
    return p;
  }

  async function regionChargers(region: Region, signal?: AbortSignal): Promise<RegionResult> {
    const t = now();
    prune(t);
    const hit = cache.get(region.name);
    if (hit && t - hit.at < EV_CACHE_TTL_MS) {
      cache.delete(region.name); // 최근에 쓴 것으로 옮긴다
      cache.set(region.name, hit);
      return hit;
    }
    const failed = failures.get(region.name);
    if (failed !== undefined && t - failed.at < backoffMs(failed.streak)) {
      if (hit) return hit; // 쉬는 동안에는 오래된 캐시라도 쓴다
      throw new Error('충전소 API를 잠시 쉬는 중입니다');
    }
    const load = loadRegion(region);
    load.catch(() => undefined); // 호출자가 이미 떠난 뒤의 실패가 처리되지 않은 거절이 되지 않게 한다
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('충전소 API 응답이 늦습니다')), waitMs);
    });
    try {
      return await waitFor(Promise.race([load, timeout]), signal);
    } catch (e) {
      // 오래된 캐시가 있으면 새로 받는 동안 그것을 쓴다.
      if (hit) return hit;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'live',
    async findNear(center, radiusMeters, signal, info) {
      if (!inSouthKorea(center)) return [];
      // 가장 가까운 시도는 꼭 받아야 하고, 여유 거리 안의 이웃 시도는 실패해도 가까운 쪽 결과만으로 답한다(info.partial).
      const [primary, ...rest] = await Promise.allSettled(regionsNear(center).map((r) => regionChargers(r, signal)));
      if (primary.status === 'rejected') throw primary.reason;
      const loaded = [primary.value, ...rest.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))];
      if (info) {
        if (loaded.length < rest.length + 1) info.partial = true;
        const t = now();
        for (const r of loaded) if (t - r.at >= EV_CACHE_TTL_MS) info.staleSince = Math.min(info.staleSince ?? r.at, r.at);
      }
      const dLat = radiusMeters / METERS_PER_DEGREE;
      const dLng = dLat / Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
      const found: Charger[] = [];
      for (const { chargers } of loaded) {
        for (const c of chargers) {
          if (Math.abs(c.lat - center.lat) > dLat || Math.abs(c.lng - center.lng) > dLng) continue;
          if (haversineMeters(center, c) <= radiusMeters) found.push(c);
        }
      }
      return found;
    },
  };
}
