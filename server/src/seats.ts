/** 연결 코드가 살아 있는 시간(정책서 12장 기준값 5분). 차는 만료되면 새 코드를 받는다. */
export const CODE_TTL_MS = 5 * 60_000;
/** 틀린 코드를 한 요청 주소가 FAILURE_WINDOW_MS 안에 MAX_FAILURES번 넣으면 그 주소의 claim을 CLAIM_LOCK_MS 동안 막는다. */
export const FAILURE_WINDOW_MS = 60_000;
export const MAX_FAILURES = 5;
export const CLAIM_LOCK_MS = 60_000;
/**
 * 요청 주소별 실패 기록은 이만큼까지만 둔다. 표가 차면 **새 주소의 시도를 잠금으로 본다**(fail-closed): 주소를 많이 만들어 표를 채워도
 * 실패가 세지지 않는 새 주소로 코드를 무한히 찍어 보는 우회가 생기지 않는다.
 */
export const MAX_TRACKED_SOURCES = 100;
/** 서버 전체에서 FAILURE_WINDOW_MS 안에 틀린 코드가 이만큼 쌓이면 모든 주소의 claim을 창이 지날 때까지 막는다(주소를 바꿔 가며 찍는 공격). */
export const MAX_GLOBAL_FAILURES = 120;
/** 어떤 잠금이든 한 번에 이 시간을 넘기지 않는다(Retry-After 상한). */
export const MAX_LOCK_MS = 60_000;
/** 자리가 없는 차는 마지막 활동(코드 발급) 뒤 코드가 만료되고도 이 시간이 지나면 지운다(토큰은 잃으면 새 carId로 다시 등록). */
export const SEATLESS_CAR_TTL_MS = 60 * 60_000;
/** 한 요청 주소가 CAR_CREATE_WINDOW_MS 안에 새로 만들 수 있는 차 수. */
export const CAR_CREATE_WINDOW_MS = 10 * 60_000;
export const MAX_CAR_CREATES_PER_SOURCE = 10;
/** 한 차에 연결할 수 있는 운전자 자리 수와 서버가 아는 차 수의 상한. */
export const MAX_SEATS_PER_CAR = 8;
export const MAX_CARS = 200;
/** 자리 이름(폰 기기 이름)과 블루투스·프로필 id 길이 상한(글자). */
export const MAX_SEAT_NAME_LENGTH = 40;
export const DEFAULT_SEAT_NAME = '내 폰';

/**
 * 식별이 전혀 없는 요청(토큰도 기기 id도 없음)이 읽고 쓰는 '기본 자리'. 픽스처·데모·차량 E2E 경로이고 어떤 새 자리도 이 데이터를 이어받지 않는다.
 * (연결 전 폰의 데이터는 기기 id별 '연결 전 버킷'에 쌓이고 claim할 때 그 폰의 버킷만 새 자리로 옮긴다.)
 */
export const DEFAULT_SEAT_ID = 'default';

export type CodeMode = { kind: 'new' } | { kind: 'replace'; seatId: string };
export type Presence = 'connected' | 'disconnected';

/** 차 하나. carToken은 차만 알고, 차 쪽 API(코드 발급·자리 목록·초기화)를 부를 때 쓴다. 토큰은 다시 내주지 않는다(잃으면 새 carId로 등록). */
export type Car = { carId: string; carToken: string; lastSelectedSeatId: string | null; createdAt: string; lastActiveAt: string };

/** 운전자 자리 하나 = 폰 한 대. 토큰은 밖으로 내보내지 않는다(PublicSeat). */
export type Seat = {
  seatId: string;
  carId: string;
  /** 폰 기기 이름. 같은 차에 같은 이름이 있으면 " 2"를 붙인다. */
  name: string;
  phoneId: string;
  phoneToken: string;
  pleosProfileId: string | null;
  btDeviceId: string | null;
  pairedAt: string;
  lastEventsAt: string | null;
  lastPresenceAt: string | null;
  presence: Presence | null;
};
export type PublicSeat = Omit<Seat, 'phoneToken' | 'carId'>;

export type CodeBinding = { btDeviceId?: string | null; pleosProfileId?: string | null };
export type IssuedCode = { code: string; expiresAt: string; mode: CodeMode };
export type IssueResult =
  | { ok: true; issued: IssuedCode }
  | { ok: false; reason: 'unknown-seat' | 'seat-limit' };

export type CodeState = 'none' | 'waiting' | 'claimed' | 'expired';
export type CodeStatus = { state: CodeState; expiresAt: string | null; mode: CodeMode | null; seatId: string | null };

export type ClaimInput = {
  code: string;
  /** 요청 주소(실패 횟수를 주소별로 센다). */
  source: string;
  /** 이 폰의 기기 id(`X-Chagok-Device`). 있으면 그 폰의 연결 전 버킷만 새 자리로 옮긴다. */
  deviceId?: string | null;
  /** 폰 기기 이름. 없으면 '내 폰'. */
  name?: string;
  /**
   * 요청에 실려 온 폰 토큰. 이 차의 같은 자리 토큰이면 새 자리를 만들지 않고 그 자리를 다시 연결한다.
   * 다른 자리(다른 차 포함)의 토큰이면 그 폰은 예전 자리를 끊고(그 자리 삭제) 새 자리로 옮긴다.
   */
  phoneToken?: string | null;
};
export type ClaimResult =
  | { ok: true; seat: PublicSeat; phoneToken: string; mode: 'new' | 'replace' }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'seat-limit' }
  | { ok: false; reason: 'locked'; retryAfterMs: number };

/** 자리 데이터(일정·선택·자주 가는 곳…)를 가진 쪽이 자리 생명 주기를 따라가도록 알린다. */
export type SeatEvent =
  /** 새 자리. 그 요청의 기기 id 버킷(연결 전 데이터)이 있으면 이어받는다. 기본 자리는 건드리지 않는다. */
  | { type: 'created'; seatId: string; deviceId: string | null }
  /** 폰 바꾸기. 같은 자리를 이어받는다(옛 폰의 일정·캘린더 선택은 비워 '받았고 0건'으로 두고 기억은 둔다. 새 폰의 버킷이 있으면 일정·선택·보정만 반영한다). */
  | { type: 'replaced'; seatId: string; deviceId: string | null }
  /** 연결 끊기·차 초기화·자리 정리. 그 자리 데이터를 모두 지운다. */
  | { type: 'removed'; seatId: string };

export type DriversView = {
  carId: string;
  seats: PublicSeat[];
  /** 지금 차 블루투스에 붙어 있다고 알려 온 폰의 자리. 최근에 알린 순. 10분 안인지는 serverTime과 at으로 차가 판단한다. */
  present: { seatId: string; at: string }[];
  /** 지난번 고른 자리. 고른 적이 없으면 가장 최근에 연결한 자리, 자리가 없으면 null. */
  lastSelectedSeatId: string | null;
  serverTime: string;
};

/**
 * 차·운전자 자리·연결 코드를 메모리에 둔다(서버를 다시 켜면 사라진다). 토큰은 WebCrypto 난수다.
 * 코드는 6자리 숫자이고 5분 안에 한 번만 쓸 수 있다.
 */
export type CreateCarResult =
  | { ok: true; car: Car }
  | { ok: false; reason: 'exists' | 'too-many-cars' | 'rate-limited' };

export type SeatStore = {
  carByToken(token: string): Car | null;
  car(carId: string): Car | null;
  /**
   * 차를 만든다. carId를 주지 않으면 서버가 정한다. 이미 있는 id면 'exists', 차가 너무 많으면 'too-many-cars',
   * 한 요청 주소가 짧은 시간에 너무 많이 만들면 'rate-limited'. 자리 없는 오래된 차는 이때 먼저 지운다.
   */
  createCar(source: string, carId?: string): CreateCarResult;
  /** 차 하나에 새 코드를 낸다. 그 차의 이전 코드는 버린다. */
  issueCode(carId: string, mode: CodeMode, binding?: CodeBinding): IssueResult;
  /** 이 차가 마지막으로 낸 코드의 상태. */
  codeStatus(carId: string): CodeStatus;
  claim(input: ClaimInput): ClaimResult;
  seat(seatId: string): PublicSeat | null;
  /** 폰 토큰이 가리키는 자리(없거나 이미 바뀐·끊긴 토큰이면 null). */
  seatByToken(phoneToken: string): { seat: PublicSeat; carId: string } | null;
  seatsOf(carId: string): PublicSeat[];
  /** 그 자리가 연결된 차의 id(없으면 null). 가족 요청의 '우리 차' 전달이 쓴다. 차 id는 서버 안에서만 쓰고 폰에는 주지 않는다. */
  carIdOfSeat(seatId: string): string | null;
  /** 서버가 아는 모든 자리(차 구분 없이, 정기 작업이 훑는다). */
  allSeats(): PublicSeat[];
  /** 그 차의 '지난번 고른 자리'(없거나 지워졌으면 가장 최근에 연결한 자리). 자리가 없으면 null. */
  preferredSeat(carId: string): PublicSeat | null;
  /**
   * 자리를 모르는 옛 차 앱의 읽기를 위한 호환: **자리가 있는 차가 정확히 하나일 때만** 그 차의 preferredSeat, 그 밖에는 null(읽을 자리를 정할 수 없음).
   * 차가 둘 이상이면 어느 차의 읽기인지 알 수 없어 다른 사람의 자리로 보내지 않는다.
   */
  soleCarSeat(): PublicSeat | null;
  /** 자리가 하나라도 있는 차의 수. 0이면 서버에 실제 사용자가 없어 식별 없는 읽기가 기본 자리(픽스처)를 본다. */
  seatedCarCount(): number;
  drivers(carId: string): DriversView;
  /** 그 차의 자리인지 확인하고 '지난번 고른 자리'로 기억한다. 아니면 false. */
  select(carId: string, seatId: string): boolean;
  /** 폰이 차 블루투스에 붙었다·떨어졌다고 알린다. 토큰이 맞으면 갱신한 자리. */
  presence(phoneToken: string, connected: boolean): PublicSeat | null;
  /** 그 자리가 일정을 받았다. */
  markEvents(seatId: string): void;
  /** 폰의 연결 끊기: 토큰이 맞으면 그 자리를 지우고 true. */
  disconnect(phoneToken: string): boolean;
  /**
   * 자리 id로 자리를 지운다(연결 끊기·차 초기화와 같은 삭제 경로: `removed` 이벤트로 자리 데이터·알림이 함께 지워진다). 정기 작업의 무소식 자리 정리가 쓴다.
   * 있었으면 true. 마지막 자리가 지워진 차는 그 시점부터 자리 없는 차의 TTL 동안 토큰이 유효하다.
   */
  removeSeat(seatId: string): boolean;
  /** 만료된 항목(코드·코드 시도 기록·차 생성 기록·자리 없이 오래된 차)을 지금 정리한다. 평소에는 요청이 올 때 같이 정리하고, 정기 작업이 한 번 더 비운다. */
  purgeExpired(): void;
  /** 차곡 초기화: 그 차의 모든 자리·코드를 지운다(차 id·토큰은 남긴다). 지운 자리 수. */
  resetCar(carId: string): number;
  /** 연결 상태가 바뀔 때 알림을 받는다. 구독 해제 함수를 돌려준다. */
  subscribe(listener: (event: SeatEvent) => void): () => void;
};

// 암호학적 난수는 WebCrypto(Node 20+의 전역 crypto)를 쓴다. 폰 쪽 타입 검사가 이 파일을 함께 읽어 node:crypto를 import하지 않는다.
declare const crypto: { getRandomValues<T extends Uint8Array | Uint32Array>(array: T): T };

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
/** 256비트 난수 토큰(64자 16진수). */
const newToken = () => hex(32);
/** 공개해도 되는 64비트 식별자. */
const newId = () => hex(8);
/** [0, 1) 난수. 코드 6자리를 뽑는 데만 쓰고 테스트가 바꿀 수 있다. */
const secureRandom = () => (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32;

type CodeRecord = {
  code: string;
  carId: string;
  mode: CodeMode;
  binding: CodeBinding;
  expiresAt: number;
  claimedSeatId: string | null;
};

const toPublic = (seat: Seat): PublicSeat => {
  const { phoneToken: _token, carId: _carId, ...rest } = seat;
  return rest;
};

export function createSeatStore(now: () => Date = () => new Date(), random: () => number = secureRandom): SeatStore {
  const cars = new Map<string, Car>();
  const carTokens = new Map<string, string>(); // 차 토큰 → carId
  const seats = new Map<string, Seat>();
  const phoneTokens = new Map<string, string>(); // 폰 토큰 → seatId
  const liveCodes = new Map<string, CodeRecord>(); // 코드 → 기록(안 쓴 것만)
  const lastCodeOfCar = new Map<string, CodeRecord>();
  const failures = new Map<string, number[]>();
  const lockedUntil = new Map<string, number>();
  let globalFailures: number[] = [];
  const carCreates = new Map<string, number[]>();
  const listeners = new Set<(event: SeatEvent) => void>();

  const t = () => now().getTime();
  const emit = (event: SeatEvent) => {
    for (const listener of listeners) listener(event);
  };
  const purge = () => {
    const at = t();
    for (const [code, rec] of liveCodes) if (rec.expiresAt <= at) liveCodes.delete(code);
    for (const [k, until] of lockedUntil) if (until <= at) lockedUntil.delete(k);
    for (const [k, list] of failures) {
      const recent = list.filter((f) => f > at - FAILURE_WINDOW_MS);
      if (recent.length === 0) failures.delete(k);
      else failures.set(k, recent);
    }
    globalFailures = globalFailures.filter((f) => f > at - FAILURE_WINDOW_MS);
    for (const [k, list] of carCreates) {
      const recent = list.filter((f) => f > at - CAR_CREATE_WINDOW_MS);
      if (recent.length === 0) carCreates.delete(k);
      else carCreates.set(k, recent);
    }
    // 자리가 없는 차는 마지막 활동(코드 발급) 뒤 코드가 만료되고도 SEATLESS_CAR_TTL_MS가 지나면 지운다.
    for (const car of [...cars.values()]) {
      if (!stale(car)) continue;
      cars.delete(car.carId);
      carTokens.delete(car.carToken);
      lastCodeOfCar.delete(car.carId);
      dropCodesOf(car.carId);
    }
  };
  const trackFailure = (source: string, at: number) => {
    globalFailures.push(at);
    const list = (failures.get(source) ?? []).filter((f) => f > at - FAILURE_WINDOW_MS);
    list.push(at);
    if (list.length >= MAX_FAILURES) {
      lockedUntil.set(source, at + CLAIM_LOCK_MS);
      failures.delete(source);
    } else {
      failures.set(source, list);
    }
  };
  /** claim을 막아야 하면 남은 시간(ms, 1초~MAX_LOCK_MS), 아니면 null. 주소별 잠금 → 서버 전체 상한 → 실패 표가 찬 상태의 새 주소(fail-closed) 순. */
  const claimBlockedFor = (source: string, at: number): number | null => {
    const cap = (ms: number) => Math.min(MAX_LOCK_MS, Math.max(1000, ms));
    const until = lockedUntil.get(source);
    if (until !== undefined && at < until) return cap(until - at);
    if (globalFailures.length >= MAX_GLOBAL_FAILURES) return cap((globalFailures[0] as number) + FAILURE_WINDOW_MS - at);
    if (!failures.has(source) && failures.size >= MAX_TRACKED_SOURCES) {
      const oldest = Math.min(...[...failures.values()].map((list) => list[0] as number));
      return cap(oldest + FAILURE_WINDOW_MS - at);
    }
    return null;
  };
  /** 자리가 없고 마지막 활동(코드 발급) 뒤 코드가 만료되고도 SEATLESS_CAR_TTL_MS가 지난 차. */
  const stale = (car: Car) =>
    Date.parse(car.lastActiveAt) + CODE_TTL_MS + SEATLESS_CAR_TTL_MS <= t() && !hasSeat(car.carId);
  const hasSeat = (carId: string) => [...seats.values()].some((s) => s.carId === carId);
  const seatsOf = (carId: string) =>
    [...seats.values()].filter((s) => s.carId === carId).sort((a, b) => a.pairedAt.localeCompare(b.pairedAt) || a.seatId.localeCompare(b.seatId));
  /** 같은 차의 다른 자리와 이름이 겹치면 " 2", " 3"…을 붙인다. */
  const uniqueName = (carId: string, wanted: string, selfId: string | null) => {
    const taken = new Set(seatsOf(carId).filter((s) => s.seatId !== selfId).map((s) => s.name));
    if (!taken.has(wanted)) return wanted;
    for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
  };
  const cleanName = (raw: string | undefined) => {
    const name = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_SEAT_NAME_LENGTH).trim();
    return name === '' ? DEFAULT_SEAT_NAME : name;
  };
  const dropCodesOf = (carId: string) => {
    for (const [code, rec] of liveCodes) if (rec.carId === carId) liveCodes.delete(code);
  };
  const removeSeat = (seat: Seat) => {
    seats.delete(seat.seatId);
    phoneTokens.delete(seat.phoneToken);
    // 이 자리를 바꾸려고 낸 코드는 쓸 곳이 없어졌다.
    for (const [code, rec] of liveCodes) if (rec.mode.kind === 'replace' && rec.mode.seatId === seat.seatId) liveCodes.delete(code);
    const car = cars.get(seat.carId);
    if (car) {
      // 자리를 지운 것도 차의 활동이다: 마지막 자리가 끊긴 차의 토큰이 곧바로 만료되지 않고 SEATLESS_CAR_TTL_MS 동안 유효하다.
      car.lastActiveAt = now().toISOString();
      if (car.lastSelectedSeatId === seat.seatId) car.lastSelectedSeatId = null;
    }
    emit({ type: 'removed', seatId: seat.seatId });
  };
  /** 지난번 고른 자리(아직 있으면), 아니면 가장 최근에 연결한 자리. */
  const preferredSeatOf = (carId: string): PublicSeat | null => {
    const chosen = cars.get(carId)?.lastSelectedSeatId;
    const seat = (chosen ? seats.get(chosen) : undefined) ?? latest(seatsOf(carId));
    return seat ? toPublic(seat) : null;
  };
  const latest = (list: Seat[]) => [...list].sort((a, b) => b.pairedAt.localeCompare(a.pairedAt) || b.seatId.localeCompare(a.seatId))[0] ?? null;

  return {
    carByToken: (token) => {
      const carId = carTokens.get(token);
      const car = carId === undefined ? undefined : cars.get(carId);
      return car && !stale(car) ? car : null;
    },
    car: (carId) => {
      const car = cars.get(carId);
      return car && !stale(car) ? car : null;
    },
    createCar: (source, carId) => {
      purge();
      const at = t();
      if (cars.size >= MAX_CARS) return { ok: false, reason: 'too-many-cars' };
      const id = carId ?? newId();
      if (cars.has(id)) return { ok: false, reason: 'exists' };
      const recent = carCreates.get(source) ?? [];
      if (recent.length >= MAX_CAR_CREATES_PER_SOURCE) return { ok: false, reason: 'rate-limited' };
      carCreates.set(source, [...recent, at]);
      const stamp = new Date(at).toISOString();
      const car: Car = { carId: id, carToken: newToken(), lastSelectedSeatId: null, createdAt: stamp, lastActiveAt: stamp };
      cars.set(id, car);
      carTokens.set(car.carToken, id);
      return { ok: true, car };
    },
    issueCode: (carId, mode, binding = {}) => {
      purge();
      if (mode.kind === 'replace') {
        const target = seats.get(mode.seatId);
        if (!target || target.carId !== carId) return { ok: false, reason: 'unknown-seat' };
      } else if (seatsOf(carId).length >= MAX_SEATS_PER_CAR) {
        return { ok: false, reason: 'seat-limit' };
      }
      dropCodesOf(carId);
      const car = cars.get(carId);
      if (car) car.lastActiveAt = now().toISOString();
      let code: string;
      do code = String(Math.floor(random() * 1_000_000)).padStart(6, '0');
      while (liveCodes.has(code));
      const record: CodeRecord = { code, carId, mode, binding, expiresAt: t() + CODE_TTL_MS, claimedSeatId: null };
      liveCodes.set(code, record);
      lastCodeOfCar.set(carId, record);
      return { ok: true, issued: { code, expiresAt: new Date(record.expiresAt).toISOString(), mode } };
    },
    codeStatus: (carId) => {
      const rec = lastCodeOfCar.get(carId);
      if (!rec) return { state: 'none', expiresAt: null, mode: null, seatId: null };
      const expiresAt = new Date(rec.expiresAt).toISOString();
      if (rec.claimedSeatId !== null) return { state: 'claimed', expiresAt, mode: rec.mode, seatId: rec.claimedSeatId };
      const seatId = rec.mode.kind === 'replace' ? rec.mode.seatId : null;
      // 서버를 다시 켜면 코드 기록이 없어 'none'이 된다. 차는 새 코드를 받는다.
      return { state: rec.expiresAt <= t() || liveCodes.get(rec.code) !== rec ? 'expired' : 'waiting', expiresAt, mode: rec.mode, seatId };
    },
    claim: ({ code, source, name, phoneToken, deviceId = null }) => {
      const at = t();
      purge();
      // 잠긴 동안(주소별·서버 전체·실패 표가 찬 새 주소)의 요청은 실패로 세지 않는다(잠금이 계속 늘어나지 않게).
      const blocked = claimBlockedFor(source, at);
      if (blocked !== null) return { ok: false, reason: 'locked', retryAfterMs: blocked };
      const record = liveCodes.get(code);
      if (!record) {
        trackFailure(source, at);
        return { ok: false, reason: 'invalid' };
      }
      const carId = record.carId;
      const pairedAt = new Date(at).toISOString();
      const wanted = cleanName(name);
      // 이 폰이 이미 가진 자리(토큰이 가리키는 자리). 같은 폰은 한 자리만 가진다.
      const known = phoneToken ? phoneTokens.get(phoneToken) : undefined;
      const owned = known === undefined ? undefined : seats.get(known);
      let seat: Seat;
      let mode: 'new' | 'replace';
      if (record.mode.kind === 'replace') {
        const existing = seats.get(record.mode.seatId);
        if (!existing || existing.carId !== carId) {
          liveCodes.delete(code);
          trackFailure(source, at);
          return { ok: false, reason: 'invalid' };
        }
        // 같은 자리를 이어받는다: 옛 폰의 토큰·연결 상태는 지우고 기억(자리 데이터)은 둔다.
        phoneTokens.delete(existing.phoneToken);
        seat = existing;
        seat.phoneToken = newToken();
        seat.phoneId = newId();
        seat.name = uniqueName(carId, wanted, seat.seatId);
        seat.btDeviceId = record.binding.btDeviceId ?? null;
        if (record.binding.pleosProfileId !== undefined) seat.pleosProfileId = record.binding.pleosProfileId;
        seat.pairedAt = pairedAt;
        seat.lastPresenceAt = null;
        seat.presence = null;
        phoneTokens.set(seat.phoneToken, seat.seatId);
        mode = 'replace';
        liveCodes.delete(code);
        record.claimedSeatId = seat.seatId;
        // 이 폰이 다른 자리를 가지고 있었다면 그 자리는 끊는다(한 폰은 한 자리).
        if (owned && owned.seatId !== seat.seatId) removeSeat(owned);
        emit({ type: 'replaced', seatId: seat.seatId, deviceId });
      } else if (owned && owned.carId === carId) {
        // 같은 폰이 같은 차에 다시 연결한다: 자리를 늘리지 않고 토큰만 새로 받는다(데이터는 그대로).
        phoneTokens.delete(owned.phoneToken);
        seat = owned;
        seat.phoneToken = newToken();
        seat.pairedAt = pairedAt;
        seat.name = uniqueName(carId, wanted, seat.seatId);
        if (record.binding.btDeviceId !== undefined) seat.btDeviceId = record.binding.btDeviceId;
        if (record.binding.pleosProfileId !== undefined) seat.pleosProfileId = record.binding.pleosProfileId;
        phoneTokens.set(seat.phoneToken, seat.seatId);
        mode = 'new';
        liveCodes.delete(code);
        record.claimedSeatId = seat.seatId;
      } else {
        if (seatsOf(carId).length >= MAX_SEATS_PER_CAR) return { ok: false, reason: 'seat-limit' };
        // 다른 차의 자리를 가진 폰이 새 차에 연결하면 예전 자리를 끊고(그 자리 삭제) 새 자리를 만든다.
        if (owned) removeSeat(owned);
        seat = {
          seatId: newId(),
          carId,
          name: uniqueName(carId, wanted, null),
          phoneId: newId(),
          phoneToken: newToken(),
          pleosProfileId: record.binding.pleosProfileId ?? null,
          btDeviceId: record.binding.btDeviceId ?? null,
          pairedAt,
          lastEventsAt: null,
          lastPresenceAt: null,
          presence: null,
        };
        seats.set(seat.seatId, seat);
        phoneTokens.set(seat.phoneToken, seat.seatId);
        mode = 'new';
        liveCodes.delete(code);
        record.claimedSeatId = seat.seatId;
        emit({ type: 'created', seatId: seat.seatId, deviceId });
      }
      failures.delete(source);
      return { ok: true, seat: toPublic(seat), phoneToken: seat.phoneToken, mode };
    },
    seat: (seatId) => {
      const seat = seats.get(seatId);
      return seat ? toPublic(seat) : null;
    },
    seatByToken: (phoneToken) => {
      const seatId = phoneTokens.get(phoneToken);
      const seat = seatId === undefined ? undefined : seats.get(seatId);
      return seat ? { seat: toPublic(seat), carId: seat.carId } : null;
    },
    seatsOf: (carId) => seatsOf(carId).map(toPublic),
    carIdOfSeat: (seatId) => seats.get(seatId)?.carId ?? null,
    allSeats: () => [...seats.values()].map(toPublic),
    preferredSeat: (carId) => preferredSeatOf(carId),
    soleCarSeat: () => {
      const owners = new Set([...seats.values()].map((seat) => seat.carId));
      if (owners.size !== 1) return null;
      return preferredSeatOf([...owners][0] as string);
    },
    seatedCarCount: () => new Set([...seats.values()].map((seat) => seat.carId)).size,
    drivers: (carId) => {
      const list = seatsOf(carId);
      const car = cars.get(carId);
      return {
        carId,
        seats: list.map(toPublic),
        present: list
          .filter((s) => s.presence === 'connected' && s.lastPresenceAt !== null)
          .map((s) => ({ seatId: s.seatId, at: s.lastPresenceAt as string }))
          .sort((a, b) => b.at.localeCompare(a.at) || a.seatId.localeCompare(b.seatId)),
        lastSelectedSeatId: car?.lastSelectedSeatId ?? latest(list)?.seatId ?? null,
        serverTime: now().toISOString(),
      };
    },
    select: (carId, seatId) => {
      const seat = seats.get(seatId);
      const car = cars.get(carId);
      if (!seat || !car || seat.carId !== carId) return false;
      car.lastSelectedSeatId = seatId;
      return true;
    },
    presence: (phoneToken, connected) => {
      const seatId = phoneTokens.get(phoneToken);
      const seat = seatId === undefined ? undefined : seats.get(seatId);
      if (!seat) return null;
      seat.presence = connected ? 'connected' : 'disconnected';
      seat.lastPresenceAt = now().toISOString();
      return toPublic(seat);
    },
    markEvents: (seatId) => {
      const seat = seats.get(seatId);
      if (seat) seat.lastEventsAt = now().toISOString();
    },
    disconnect: (phoneToken) => {
      const seatId = phoneTokens.get(phoneToken);
      const seat = seatId === undefined ? undefined : seats.get(seatId);
      if (!seat) return false;
      removeSeat(seat);
      return true;
    },
    removeSeat: (seatId) => {
      const seat = seats.get(seatId);
      if (!seat) return false;
      removeSeat(seat);
      return true;
    },
    purgeExpired: () => purge(),
    resetCar: (carId) => {
      const list = seatsOf(carId);
      for (const seat of list) removeSeat(seat);
      dropCodesOf(carId);
      lastCodeOfCar.delete(carId);
      const car = cars.get(carId);
      if (car) {
        car.lastSelectedSeatId = null;
        car.lastActiveAt = now().toISOString();
      }
      return list.length;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
