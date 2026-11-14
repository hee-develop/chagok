import { EXTERNAL_TIMEOUT_MS } from './constants.js';
import { haversineMeters } from './geo.js';
import type { Charger, ChargerSource, ChargerSpeed, ChargerState, LatLng } from './types.js';
import { xmlRecords, xmlValue } from './xml.js';

/**
 * 한국환경공단 전기자동차 충전소 정보(환경부) 어댑터. 확인한 공식 문서:
 * - https://www.data.go.kr/data/15076352/openapi.do (서비스 URL, 요청 변수, 응답 필드)
 * 문서에서 확인한 것: 서비스 URL `https://apis.data.go.kr/B552584/EvCharger`, 충전소 정보 요청 변수 serviceKey·pageNo·
 * numOfRows(10~9999)·zcode(시도 코드 2자리), 응답 필드(statNm·statId·chgerId·chgerType·addr·lat·lng·useTime·busiNm·
 * stat·statUpdDt·powerType·zcode·parkingFree·note). 좌표·반경 조건 요청 변수는 없어서 시도(zcode) 단위로 받아 서버에서 거른다.
 * 문서에 없어 미확인인 것: 오퍼레이션 이름 `getChargerInfo`(문서 표에는 이름이 없고 제목뿐, 공개된 활용 사례의 이름을 썼다),
 * 응답 XML 정확한 구조(header/body 위치 — 이 파일은 태그 이름만 보고 읽는다), 상태·충전기 타입 코드표(아래 값은
 * 활용 가이드를 옮긴 공개 자료 https://github.com/seungmin-park/PlugPass/pull/4 기준), 출력 용량 단위, 강원·전북 시도 코드
 * (2023년 개정 전후 42/51, 45/52 둘 다 시도한다), `limitYn`·`delYn` 필드 이름, 키 인코딩(디코딩 키 권장),
 * 하루 호출 한도. 실제 키로 확인한 것은 하나도 없다.
 */
export const EV_CHARGER_BASE_URL = 'https://apis.data.go.kr/B552584/EvCharger';
const PAGE_SIZE = 9999;
/** 시도 하나에서 받을 최대 페이지 수(9999건 x 15쪽). 넘는 지역은 앞쪽만 쓴다(미확인: 경기도 충전기 수). */
const MAX_PAGES_PER_REGION = 15;
/** 시도 데이터를 메모리에 두는 시간. 충전기 상태(stat)가 이 주기로 갱신된다. */
const CACHE_TTL_MS = 5 * 60_000;
/** 받기에 실패한 지역을 다시 시도하기 전 대기. */
const FAILURE_BACKOFF_MS = 30_000;
/** 시도 데이터 한 쪽을 받는 제한 시간. 호출자는 EXTERNAL_TIMEOUT_MS만 기다리고, 받기는 뒤에서 이어진다. */
const PAGE_TIMEOUT_MS = 30_000;

/** 시도 중심 좌표(가안, 가까운 시도를 고르는 데만 쓴다)와 환경부 시도 코드. */
type Region = { name: string; center: LatLng; zcodes: string[] };
export const REGIONS: Region[] = [
  { name: '서울', center: { lat: 37.5665, lng: 126.978 }, zcodes: ['11'] },
  { name: '부산', center: { lat: 35.1796, lng: 129.0756 }, zcodes: ['26'] },
  { name: '대구', center: { lat: 35.8714, lng: 128.6014 }, zcodes: ['27'] },
  { name: '인천', center: { lat: 37.4563, lng: 126.7052 }, zcodes: ['28'] },
  { name: '광주', center: { lat: 35.1595, lng: 126.8526 }, zcodes: ['29'] },
  { name: '대전', center: { lat: 36.3504, lng: 127.3845 }, zcodes: ['30'] },
  { name: '울산', center: { lat: 35.5384, lng: 129.3114 }, zcodes: ['31'] },
  { name: '세종', center: { lat: 36.48, lng: 127.289 }, zcodes: ['36'] },
  { name: '경기', center: { lat: 37.4138, lng: 127.5183 }, zcodes: ['41'] },
  { name: '강원', center: { lat: 37.8228, lng: 128.1555 }, zcodes: ['42', '51'] },
  { name: '충북', center: { lat: 36.6357, lng: 127.4917 }, zcodes: ['43'] },
  { name: '충남', center: { lat: 36.5184, lng: 126.8 }, zcodes: ['44'] },
  { name: '전북', center: { lat: 35.7175, lng: 127.153 }, zcodes: ['45', '52'] },
  { name: '전남', center: { lat: 34.8161, lng: 126.4629 }, zcodes: ['46'] },
  { name: '경북', center: { lat: 36.4919, lng: 128.8889 }, zcodes: ['47'] },
  { name: '경남', center: { lat: 35.4606, lng: 128.2132 }, zcodes: ['48'] },
  { name: '제주', center: { lat: 33.4996, lng: 126.5312 }, zcodes: ['50'] },
];

/**
 * 가까운 시도 중심 순으로 최대 2곳. 두 번째는 첫 번째보다 1.5배 안쪽 거리일 때만 더한다(시도 경계 근처 보완).
 * 시도 경계를 쓰지 않는 근사이므로 경계 가까이의 충전기는 빠질 수 있다.
 */
export function regionsNear(center: LatLng): Region[] {
  const ranked = REGIONS.map((r) => ({ r, d: haversineMeters(center, r.center) })).sort((a, b) => a.d - b.d);
  const picked = [ranked[0].r];
  if (ranked[1].d <= ranked[0].d * 1.5) picked.push(ranked[1].r);
  return picked;
}

const SLOW_TYPES = new Set(['02', '07', '08']);

/**
 * 급속·완속 구분. powerType 글자에 '완속'/'급속'이 있으면 그것을, 없으면 충전기 타입 코드(02 AC완속·07 AC3상·08 DC콤보(완속)는 완속)를 쓴다.
 * 문서 예시 powerType은 "급속(100kWh동시)"이다. 코드는 커넥터 조합이라 용량을 단정하지 않는다(미확인).
 */
export function classifySpeed(chgerType: string, powerType: string): ChargerSpeed {
  if (powerType.includes('완속')) return 'slow';
  if (powerType.includes('급속')) return 'fast';
  return SLOW_TYPES.has(chgerType) ? 'slow' : 'fast';
}

/** stat 코드: 2 사용가능, 3 충전중, 1 통신이상·4 운영중지·5 점검중, 0과 그 밖은 알 수 없음. */
export function mapState(stat: string): ChargerState {
  switch (stat) {
    case '2':
      return 'available';
    case '3':
      return 'charging';
    case '1':
    case '4':
    case '5':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

const parsePower = (powerType: string): number | null => {
  const m = /(\d+(?:\.\d+)?)\s*k?w/i.exec(powerType);
  return m ? Number(m[1]) : null;
};

export type ChargerPage = { resultCode: string | null; resultMsg: string | null; totalCount: number; chargers: Charger[] };

/** 충전소 정보 XML 한 쪽을 읽는다. 좌표가 없거나 삭제·이용자 제한 표시가 있는 충전기는 거른다. */
export function parseChargerInfoXml(xml: string): ChargerPage {
  const chargers: Charger[] = [];
  for (const r of xmlRecords(xml, 'item')) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!r.statId || !Number.isFinite(lat) || !Number.isFinite(lng) || r.lat === '' || r.lng === '') continue;
    if (r.delYn === 'Y' || r.limitYn === 'Y') continue;
    const powerType = r.powerType ?? '';
    chargers.push({
      stationId: r.statId,
      chargerId: r.chgerId ?? '',
      name: r.statNm ?? '',
      address: r.addr ? r.addr : null,
      lat,
      lng,
      speed: classifySpeed(r.chgerType ?? '', powerType),
      state: mapState(r.stat ?? ''),
      powerKw: parsePower(powerType),
      operator: r.busiNm ? r.busiNm : null,
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

/**
 * 시도 단위로 받아 메모리에 두고(5분) 반경으로 거른다. 첫 호출은 오래 걸릴 수 있어(수 MB x 여러 쪽) 호출자는
 * waitMs까지만 기다리고 실패(unavailable)로 답하며, 받기는 뒤에서 계속되어 다음 호출부터 캐시를 쓴다.
 * 오류 메시지에는 URL·키를 넣지 않는다.
 */
export function createEvChargerSource({ serviceKey, fetchImpl = fetch, now = Date.now, waitMs = EXTERNAL_TIMEOUT_MS }: EvChargerOptions): ChargerSource {
  const key = normalizeKey(serviceKey);
  const cache = new Map<string, { at: number; chargers: Charger[] }>();
  const inflight = new Map<string, Promise<Charger[]>>();
  const failedAt = new Map<string, number>();

  async function fetchPage(zcode: string, pageNo: number): Promise<ChargerPage> {
    const params = new URLSearchParams({ serviceKey: key, pageNo: String(pageNo), numOfRows: String(PAGE_SIZE), zcode });
    let res: Response;
    try {
      res = await fetchImpl(`${EV_CHARGER_BASE_URL}/getChargerInfo?${params}`, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    } catch {
      throw new Error('충전소 API에 연결하지 못했습니다');
    }
    if (!res.ok) throw new Error(`충전소 API가 오류를 돌려줬습니다(HTTP ${res.status})`);
    const page = parseChargerInfoXml(await res.text());
    if (page.resultCode !== '00') throw new Error(`충전소 API 결과 코드 ${page.resultCode ?? '없음'}`);
    return page;
  }

  async function loadZcode(zcode: string): Promise<Charger[]> {
    const first = await fetchPage(zcode, 1);
    const pages = Math.min(MAX_PAGES_PER_REGION, Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE)));
    const all = [...first.chargers];
    for (let start = 2; start <= pages; start += 3) {
      const batch = [];
      for (let p = start; p < Math.min(start + 3, pages + 1); p++) batch.push(fetchPage(zcode, p));
      for (const page of await Promise.all(batch)) all.push(...page.chargers);
    }
    return all;
  }

  /** 시도 하나(코드가 여럿이면 하나라도 받아지면 성공). */
  function loadRegion(region: Region): Promise<Charger[]> {
    const existing = inflight.get(region.name);
    if (existing) return existing;
    const p = (async () => {
      const settled = await Promise.allSettled(region.zcodes.map(loadZcode));
      const ok = settled.filter((s): s is PromiseFulfilledResult<Charger[]> => s.status === 'fulfilled');
      if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
      const chargers = ok.flatMap((s) => s.value);
      cache.set(region.name, { at: now(), chargers });
      failedAt.delete(region.name);
      return chargers;
    })();
    inflight.set(region.name, p);
    p.then(
      () => inflight.delete(region.name),
      () => {
        inflight.delete(region.name);
        failedAt.set(region.name, now());
      },
    );
    return p;
  }

  async function regionChargers(region: Region): Promise<Charger[]> {
    const hit = cache.get(region.name);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.chargers;
    const failed = failedAt.get(region.name);
    if (failed !== undefined && now() - failed < FAILURE_BACKOFF_MS) throw new Error('충전소 API를 잠시 쉬는 중입니다');
    const load = loadRegion(region);
    load.catch(() => undefined); // 호출자가 이미 떠난 뒤의 실패가 처리되지 않은 거절이 되지 않게 한다
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('충전소 API 응답이 늦습니다')), waitMs);
    });
    try {
      return await Promise.race([load, timeout]);
    } catch (e) {
      // 오래된 캐시가 있으면 새로 받는 동안 그것을 쓴다.
      if (hit) return hit.chargers;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'live',
    async findNear(center, radiusMeters) {
      // 가장 가까운 시도는 꼭 받아야 하고, 경계 보완용 두 번째 시도는 실패해도 첫 번째 결과만으로 답한다.
      const [primary, ...rest] = await Promise.allSettled(regionsNear(center).map(regionChargers));
      if (primary.status === 'rejected') throw primary.reason;
      const lists = [primary.value, ...rest.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))];
      return lists.flat().filter((c) => haversineMeters(center, c) <= radiusMeters);
    },
  };
}
