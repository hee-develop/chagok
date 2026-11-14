import {
  FUEL_DETOUR_MAX_METERS,
  FUEL_SAMPLE_SPACING_METERS,
  FUEL_SCAN_MAX_METERS,
  LONG_STAY_MINUTES,
  MAX_CANDIDATES,
  MAX_REST_STOPS_LOOKUP,
  MEAL_WINDOWS_SEOUL_MINUTES,
  OPINET_MAX_RADIUS_METERS,
  REST_STOP_CHARGER_RADIUS_METERS,
  REST_STOP_CORRIDOR_METERS,
  SLOW_CHARGER_RADIUS_METERS,
  TOTAL_TIMEOUT_MS,
} from './constants.js';
import { distanceToSegment, haversineMeters, pointAlong } from './geo.js';
import type { Charger, ChargerSpeed, EnergySources, FuelKind, FuelStation, LatLng, PumpFuel } from './types.js';

export type EnergyRequest = {
  fuel: FuelKind;
  origin: LatLng;
  destination: LatLng;
  /** 대상 일정이 머무는 시간(분). 모르면 null. */
  stayMinutes: number | null;
  /** 제안 시점(식사 시간대 판단에 쓴다). */
  at: Date;
};

export type CandidateKind = 'slow_charger' | 'fast_charger' | 'gas_station';

export type Candidate = {
  id: string;
  kind: CandidateKind;
  /** 충전 후보는 목적지 충전소 이름 또는 휴게소 이름, 주유소는 주유소 이름. */
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** stage가 destination이면 목적지에서, route이면 출발→목적지 선분에서 떨어진 거리(m, 직선 근사). */
  detourMeters: number;
  /** 출발→목적지 선분에서 가장 가까운 점의 위치(0=출발, 1=도착). destination 단계는 null. */
  routeProgress: number | null;
  charger: {
    stationName: string;
    status: 'available' | 'busy' | 'unknown';
    availableCount: number;
    totalCount: number;
    powerKw: number | null;
    parkingFree: boolean | null;
  } | null;
  price: { fuel: PumpFuel; won: number } | null;
  brand: string | null;
  /** 휴게소 식사 가능 여부. 휴게소 후보가 아니면 null. */
  hasFood: boolean | null;
};

export type EnergyOptions = {
  fuel: FuelKind;
  /** unavailable이면 외부 조회가 실패해 candidates가 비어 있다(후보가 없어서 빈 것이 아니다). */
  source: 'fixture' | 'live' | 'unavailable';
  /** destination 목적지 근처 완속, route 경로상(휴게소 급속·주유소), none 후보 없음 또는 조회 실패. */
  stage: 'destination' | 'route' | 'none';
  /** 식사 시간대이고 후보 중 식사할 수 있는 휴게소가 있으면 true. 차가 '휴게소 식사 + 충전' 한 제안으로 묶을지 판단한다. */
  mealBundle: boolean;
  candidates: Candidate[];
};

const SEOUL_OFFSET_MS = 9 * 60 * 60_000;

/** 서울 시각이 식사 시간대인지. */
export function isMealTimeSeoul(at: Date): boolean {
  const minutes = Math.floor((((at.getTime() + SEOUL_OFFSET_MS) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000);
  return MEAL_WINDOWS_SEOUL_MINUTES.some(([from, to]) => minutes >= from && minutes < to);
}

type StationSummary = {
  stationId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  available: number;
  charging: number;
  unknown: number;
  total: number;
  powerKw: number | null;
  parkingFree: boolean | null;
};

/** 충전기 목록을 충전소별로 묶는다(주어진 속도의 충전기만). */
function summarize(chargers: Charger[], speed: ChargerSpeed): StationSummary[] {
  const byStation = new Map<string, StationSummary>();
  for (const c of chargers) {
    if (c.speed !== speed) continue;
    let s = byStation.get(c.stationId);
    if (!s) {
      s = { stationId: c.stationId, name: c.name, address: c.address, lat: c.lat, lng: c.lng, available: 0, charging: 0, unknown: 0, total: 0, powerKw: null, parkingFree: c.parkingFree };
      byStation.set(c.stationId, s);
    }
    s.total += 1;
    if (c.state === 'available') s.available += 1;
    else if (c.state === 'charging') s.charging += 1;
    else if (c.state === 'unknown') s.unknown += 1;
    if (c.powerKw !== null && (s.powerKw === null || c.powerKw > s.powerKw)) s.powerKw = c.powerKw;
  }
  return [...byStation.values()];
}

const statusOf = (s: StationSummary): 'available' | 'busy' | 'unknown' | 'unavailable' =>
  s.available > 0 ? 'available' : s.charging > 0 ? 'busy' : s.unknown > 0 ? 'unknown' : 'unavailable';
const STATUS_RANK = { available: 0, busy: 1, unknown: 2 } as const;

const chargerBlock = (s: StationSummary, status: 'available' | 'busy' | 'unknown'): NonNullable<Candidate['charger']> => ({
  stationName: s.name,
  status,
  availableCount: s.available,
  totalCount: s.total,
  powerKw: s.powerKw,
  parkingFree: s.parkingFree,
});

/** 동시에 limit개까지만 실행해 순서대로 결과를 모은다. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const empty = (fuel: FuelKind, source: EnergyOptions['source']): EnergyOptions => ({ fuel, source, stage: 'none', mealBundle: false, candidates: [] });

async function evOptions(req: EnergyRequest, sources: EnergySources): Promise<EnergyOptions> {
  const source = sources.chargers.kind;

  if (req.stayMinutes !== null && req.stayMinutes >= LONG_STAY_MINUTES) {
    const near = await sources.chargers.findNear(req.destination, SLOW_CHARGER_RADIUS_METERS);
    const candidates = summarize(near, 'slow')
      .filter((s) => s.available > 0)
      .map((s) => ({ s, d: haversineMeters(req.destination, s) }))
      .filter(({ d }) => d <= SLOW_CHARGER_RADIUS_METERS)
      .sort((a, b) => a.d - b.d || a.s.stationId.localeCompare(b.s.stationId))
      .slice(0, MAX_CANDIDATES)
      .map(({ s, d }): Candidate => ({
        id: s.stationId,
        kind: 'slow_charger',
        name: s.name,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        detourMeters: Math.round(d),
        routeProgress: null,
        charger: chargerBlock(s, 'available'),
        price: null,
        brand: null,
        hasFood: null,
      }));
    if (candidates.length > 0) return { fuel: req.fuel, source, stage: 'destination', mealBundle: false, candidates };
  }

  const stops = sources.restStops
    .list()
    .map((stop) => ({ stop, seg: distanceToSegment(stop, req.origin, req.destination) }))
    .filter(({ seg }) => seg.meters <= REST_STOP_CORRIDOR_METERS)
    .sort((a, b) => a.seg.meters - b.seg.meters)
    .slice(0, MAX_REST_STOPS_LOOKUP);

  const found = await mapLimit(stops, 4, async ({ stop, seg }) => {
    const near = await sources.chargers.findNear(stop, REST_STOP_CHARGER_RADIUS_METERS);
    const best = summarize(near, 'fast')
      .map((s) => ({ s, status: statusOf(s) }))
      .filter((x): x is { s: StationSummary; status: 'available' | 'busy' | 'unknown' } => x.status !== 'unavailable')
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.s.available - a.s.available || a.s.stationId.localeCompare(b.s.stationId))[0];
    if (!best) return null;
    return {
      id: best.s.stationId,
      kind: 'fast_charger',
      name: stop.name,
      address: best.s.address,
      lat: stop.lat,
      lng: stop.lng,
      detourMeters: Math.round(seg.meters),
      routeProgress: Math.round(seg.progress * 1000) / 1000,
      charger: chargerBlock(best.s, best.status),
      price: null,
      brand: null,
      hasFood: stop.hasFood,
    } satisfies Candidate;
  });

  const unique = new Map<string, Candidate>();
  for (const c of found) if (c && !unique.has(c.id)) unique.set(c.id, c);
  const all = [...unique.values()];
  const mealBundle = isMealTimeSeoul(req.at) && all.some((c) => c.hasFood === true);
  const rank = (c: Candidate) => STATUS_RANK[c.charger!.status];
  all.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (mealBundle ? Number(b.hasFood === true) - Number(a.hasFood === true) : 0) ||
      a.detourMeters - b.detourMeters ||
      (a.routeProgress ?? 0) - (b.routeProgress ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const candidates = all.slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return empty(req.fuel, source);
  return { fuel: req.fuel, source, stage: 'route', mealBundle, candidates };
}

async function fuelOptions(req: EnergyRequest, sources: EnergySources): Promise<EnergyOptions> {
  const source = sources.fuelStations.kind;
  const fuel: PumpFuel = req.fuel === 'diesel' ? 'diesel' : 'gasoline';
  const length = haversineMeters(req.origin, req.destination);
  const scan = Math.min(length, FUEL_SCAN_MAX_METERS);
  const count = Math.ceil(scan / FUEL_SAMPLE_SPACING_METERS) + 1;
  const points: LatLng[] = length === 0 ? [req.origin] : Array.from({ length: count }, (_, i) => pointAlong(req.origin, req.destination, ((i / (count - 1)) * scan) / length));

  const lists = await mapLimit(points, 4, (p) => sources.fuelStations.findNear(p, OPINET_MAX_RADIUS_METERS, fuel));
  const unique = new Map<string, FuelStation>();
  for (const s of lists.flat()) if (!unique.has(s.id)) unique.set(s.id, s);

  const candidates = [...unique.values()]
    .map((s) => ({ s, seg: distanceToSegment(s, req.origin, req.destination) }))
    .filter(({ seg }) => seg.meters <= FUEL_DETOUR_MAX_METERS)
    .sort((a, b) => a.s.price - b.s.price || a.seg.meters - b.seg.meters || a.s.id.localeCompare(b.s.id))
    .slice(0, MAX_CANDIDATES)
    .map(({ s, seg }): Candidate => ({
      id: s.id,
      kind: 'gas_station',
      name: s.name,
      address: null,
      lat: s.lat,
      lng: s.lng,
      detourMeters: Math.round(seg.meters),
      routeProgress: Math.round(seg.progress * 1000) / 1000,
      charger: null,
      price: { fuel, won: s.price },
      brand: s.brand,
      hasFood: null,
    }));
  if (candidates.length === 0) return empty(req.fuel, source);
  return { fuel: req.fuel, source, stage: 'route', mealBundle: false, candidates };
}

export type FindOptions = { onError?: (error: unknown) => void; totalTimeoutMs?: number };

/**
 * 에너지 후보를 찾는다. 외부 조회가 실패하거나 제한 시간을 넘기면 던지지 않고 빈 후보 + `source: "unavailable"`로 답한다.
 */
export async function findEnergyOptions(req: EnergyRequest, sources: EnergySources, { onError, totalTimeoutMs = TOTAL_TIMEOUT_MS }: FindOptions = {}): Promise<EnergyOptions> {
  const work = req.fuel === 'ev' ? evOptions(req, sources) : fuelOptions(req, sources);
  work.catch(() => undefined); // 제한 시간이 먼저 끝난 뒤의 실패가 처리되지 않은 거절이 되지 않게 한다
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('에너지 후보 조회 제한 시간을 넘겼습니다')), totalTimeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (e) {
    onError?.(e);
    return empty(req.fuel, 'unavailable');
  } finally {
    clearTimeout(timer);
  }
}
