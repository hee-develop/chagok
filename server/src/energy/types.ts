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

/** 환경부 전기차 충전소 포트. 실패하면 throw한다(서비스가 `unavailable`로 바꾼다). */
export interface ChargerSource {
  readonly kind: 'fixture' | 'live';
  findNear(center: LatLng, radiusMeters: number): Promise<Charger[]>;
}

/** 오피넷 주유소 포트. 실패하면 throw한다. */
export interface FuelStationSource {
  readonly kind: 'fixture' | 'live';
  findNear(center: LatLng, radiusMeters: number, fuel: PumpFuel): Promise<FuelStation[]>;
}

/** 휴게소 목록 포트. 이번에는 픽스처만 있다(실제 목록 출처는 정하지 않았다, docs/energy.md). */
export interface RestStopSource {
  list(): RestStop[];
}

export type EnergySources = { chargers: ChargerSource; fuelStations: FuelStationSource; restStops: RestStopSource };
