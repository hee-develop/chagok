export type FuelKind = 'ev' | 'gasoline' | 'diesel' | 'hybrid';
/** 오피넷에서 가격을 보는 연료. 하이브리드는 휘발유로 본다. */
export type PumpFuel = 'gasoline' | 'diesel';

export type LatLng = { lat: number; lng: number };

export type ChargerSpeed = 'slow' | 'fast';
/** available 사용 가능, charging 충전 중(자리 없음), unavailable 운영중지·점검·통신이상, unknown 알 수 없음. */
export type ChargerState = 'available' | 'charging' | 'unavailable' | 'unknown';

/** 충전기 한 대. 같은 stationId가 한 충전소다. */
export type Charger = {
  stationId: string;
  chargerId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  speed: ChargerSpeed;
  state: ChargerState;
  powerKw: number | null;
  operator: string | null;
  parkingFree: boolean | null;
};

export type FuelStation = {
  id: string;
  name: string;
  brand: string | null;
  lat: number;
  lng: number;
  /** 원/L */
  price: number;
};

export type RestStop = { id: string; name: string; lat: number; lng: number; hasFood: boolean };

/** 충전소 조회가 결과 말고 돌려주는 정보. 호출자가 빈 객체를 넘기면 포트 구현이 채운다(안 채우면 해당 없음). */
export type NearInfo = {
  /** 이웃 시도처럼 '있으면 더 좋은' 조회가 실패해 결과에서 일부가 빠졌을 수 있다. */
  partial?: boolean;
  /** 새로 받지 못해 `EV_CACHE_TTL_MS`보다 낡은 캐시로 답했을 때, 그 가운데 가장 낡은 데이터를 받은 시각(ms). */
  staleSince?: number;
};

/**
 * 환경부 전기차 충전소 포트. 실패하면 throw한다(서비스가 `unavailable`로 바꾼다).
 * `signal`이 중단되면 기다리던 조회를 그만둔다(요청 전체 제한 시간이 지났을 때). `info`는 결과의 품질(일부 빠짐·낡음)을 돌려받는 자리다.
 */
export interface ChargerSource {
  readonly kind: 'fixture' | 'live';
  findNear(center: LatLng, radiusMeters: number, signal?: AbortSignal, info?: NearInfo): Promise<Charger[]>;
}

/** 오피넷 주유소 포트. 실패하면 throw한다. `signal`이 중단되면 나가던 호출을 멈춘다. */
export interface FuelStationSource {
  readonly kind: 'fixture' | 'live';
  findNear(center: LatLng, radiusMeters: number, fuel: PumpFuel, signal?: AbortSignal): Promise<FuelStation[]>;
}

/** 휴게소 목록 포트. 이번에는 픽스처만 있다(실제 목록 출처는 정하지 않았다, docs/energy.md). */
export interface RestStopSource {
  list(): RestStop[];
}

export type EnergySources = { chargers: ChargerSource; fuelStations: FuelStationSource; restStops: RestStopSource };
