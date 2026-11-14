import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import type { SeatData, SeatDataRegistry } from './seatData.js';
import { DEFAULT_SEAT_ID, type SeatStore } from './seats.js';

/**
 * 요청이 다루는 자리와 그 데이터.
 * - `seat`: 연결된 운전자 자리(폰 토큰 또는 차 토큰+driver).
 * - `device`: 토큰 없이 기기 id(`X-Chagok-Device`)만 있는 폰의 '연결 전 버킷'. claim 때 그 폰의 버킷만 새 자리로 옮겨진다.
 * - `default`: **서버에 자리 있는 차가 하나도 없을 때** 식별이 전혀 없는 읽기, 그리고 식별 없는 쓰기의 '기본 자리'(픽스처·데모·차량 E2E 경로).
 * - `none`: 읽을 자리를 정할 수 없는 읽기(자리 있는 차가 둘 이상인데 식별 없음, 자리 없는 차가 차 토큰만으로 읽기…)의 '저장하지 않는 빈 범위'.
 *   픽스처도 남의 일정도 아닌 0건이고 쓸 수 없다.
 */
export type SeatScope = {
  kind: 'seat' | 'device' | 'default' | 'none';
  /** 데이터 키. 기본 자리는 DEFAULT_SEAT_ID, 버킷은 `device:<id>`(로그·응답에 쓰지 않는다). */
  seatId: string;
  /**
   * **읽기용** 데이터. 연결 전 버킷이 아직 없는 기기와 빈 범위(none)는 저장하지 않는 빈 데이터다(읽기는 버킷을 만들지 않는다).
   * 쓰려면 `open()`을 써야 한다.
   */
  readonly data: SeatData;
  /**
   * 일정을 받은 적 없을 때 픽스처(목 일정)로 떨어지는 자리인가. 기본 자리만 그렇다. 실제 자리(연결된 자리·연결 전 버킷)는 받은 적이 없으면 '0건'이다.
   * (`createApp({ fixtureSeats })`가 켜지면 읽기 범위는 모두 그렇다: 목 캘린더로 도는 데모·폰 E2E 전용.)
   */
  fixture: boolean;
  /**
   * 쓰기 직전에(본문 검증을 통과한 뒤) 부른다. 연결 전 버킷은 이때 비로소 만들어지고(요청 주소별 속도 제한, 가득 차면 가장 오래 쓰지 않은 버킷을
   * 밀어냄) 마지막으로 쓴 시각이 갱신된다. `reserveEvents(bytes)`는 이 데이터의 일정을 bytes 크기로 바꿔도 되는지 확인한다.
   */
  open(): SeatOpen;
};
export type SeatOpen =
  | { ok: true; data: SeatData; reserveEvents: (bytes: number) => boolean }
  | { ok: false; reason: 'rate-limited' | 'unwritable' };
/** open()이 막혔을 때 429 응답 본문(한국어 문구와 reason). */
export const openDenied = (reason: 'rate-limited' | 'unwritable') => ({
  error: reason === 'rate-limited' ? '요청이 너무 많아요. 잠시 뒤 다시 해 주세요' : '이 요청으로는 저장할 수 없어요',
  reason,
});
export type SeatEnv = { Variables: { seat: SeatScope } };

type Bearer = { kind: 'none' } | { kind: 'bad' } | { kind: 'token'; token: string };

/** Authorization: Bearer <토큰>. 토큰은 서버가 낸 16진수 64자이지만 모양은 느슨하게 받고 모르는 토큰은 찾을 때 거른다. */
export const bearerOf = (c: Context): Bearer => {
  const header = c.req.header('authorization');
  if (header === undefined) return { kind: 'none' };
  const m = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(header);
  return m ? { kind: 'token', token: m[1] as string } : { kind: 'bad' };
};

/** 폰이 첫 실행 때 만든 기기 id를 싣는 헤더. 길이·문자는 DEVICE_ID_PATTERN으로 검증하고 로그에 남기지 않는다. */
export const DEVICE_HEADER = 'x-chagok-device';
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

type Device = { kind: 'none' } | { kind: 'bad' } | { kind: 'id'; id: string };

export const deviceOf = (c: Context): Device => {
  const header = c.req.header(DEVICE_HEADER);
  if (header === undefined) return { kind: 'none' };
  return DEVICE_ID_PATTERN.test(header) ? { kind: 'id', id: header } : { kind: 'bad' };
};

/** 요청 주소(코드 시도 횟수를 세는 단위). node 서버의 연결 주소이고 알 수 없으면 'unknown' 하나로 묶는다. */
export const connectionAddress = (c: Context): string => {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

export type SeatGuardOptions = {
  /**
   * 식별 없는(토큰·기기 id·driver 없는) 읽기를 옛 차 앱 호환으로 보낸다: **자리가 있는 차가 정확히 하나일 때만** 그 차의
   * '지난번 고른 자리(없으면 가장 최근에 연결한 자리)', 그 밖에는 기본 자리. 차 토큰만 있고 driver가 없는 읽기는 그 차 안에서만 같은 규칙.
   * 끄면 두 경우 모두 빈 범위다(자리를 정할 수 없다). 차가 driver를 보내게 되면 끈다.
   * 읽을 자리를 정할 수 없을 때는 기본 자리(픽스처)가 아니라 **저장하지 않는 빈 범위**다. 기본 자리는 자리 있는 차가 하나도 없을 때의 식별 없는 읽기에만 쓴다.
   */
  legacyDriverFallback: boolean;
  /** 모든 읽기 범위가 일정을 받은 적 없을 때 픽스처로 떨어지게 한다(데모 전용: 실제 사용자에게 목 일정이 보인다. 기본 꺼짐). */
  fixtureSeats?: boolean;
  /** 버킷을 만드는 요청 주소(속도 제한 단위). 기본은 연결 주소이고 프록시 뒤에서는 바꿔야 한다. */
  clientAddress?: (c: Context) => string;
};

const unauthorized = (c: Context, error: string) => c.json({ error, reason: 'unauthorized' as const }, 401);
const forbidden = (c: Context, error: string) => c.json({ error, reason: 'forbidden' as const }, 403);
const badDevice = (c: Context) => c.json({ error: `${DEVICE_HEADER} 헤더는 22~64자의 영문·숫자·-·_ 이어야 합니다`, reason: 'bad-device' as const }, 400);

/**
 * 요청이 어느 자리의 데이터를 다루는지 정한다.
 *
 * - 쓰기(폰): 폰 토큰이 있으면 그 자리. 토큰이 없으면 기기 id가 있을 때 그 기기의 연결 전 버킷(실제 만들기는 `open()` 때), 기기 id도 없으면 기본 자리.
 *   모르는 토큰(바뀌거나 끊긴 폰)과 이상한 Authorization 형식은 401, 이상한 기기 id는 400이다.
 * - 읽기: `driver=<seatId>`는 그 자리를 가진 차의 토큰(또는 그 자리 폰의 토큰)이 있어야 한다. 폰 토큰만 있으면 그 자리,
 *   차 토큰만 있으면 그 차의 지난번 고른 자리, 토큰이 없으면 기기 id의 버킷(읽기는 버킷을 만들지 않는다),
 *   아무것도 없으면 옛 차 앱 호환을 따른다: 자리 있는 차가 하나도 없으면 기본 자리, 정확히 하나(legacyDriverFallback)면 그 차의 자리,
 *   그 밖에는 읽을 자리를 정할 수 없어 빈 범위다. 차 토큰만 있는데 그 차에 자리가 없어도 빈 범위다.
 *   토큰이 있으면 기기 id는 자리를 정하는 데 쓰지 않는다(바뀐 토큰의 401을 버킷으로 흘리지 않는다: 폰이 토큰을 버리고 다시 보낸다).
 */
export function createSeatGuard(
  seats: SeatStore,
  registry: SeatDataRegistry,
  { legacyDriverFallback, fixtureSeats = false, clientAddress = connectionAddress }: SeatGuardOptions,
) {
  const base = (kind: SeatScope['kind'], seatId: string) => ({ kind, seatId, fixture: fixtureSeats || kind === 'default' });
  const seatScope = (seatId: string): SeatScope => {
    const data = registry.get(seatId);
    return {
      ...base('seat', seatId),
      data,
      open: () => ({ ok: true, data, reserveEvents: (bytes) => registry.reserveEvents(data, bytes) }),
    };
  };
  const defaultScope = (): SeatScope => {
    const data = registry.get(DEFAULT_SEAT_ID);
    return {
      ...base('default', DEFAULT_SEAT_ID),
      data,
      open: () => ({ ok: true, data, reserveEvents: (bytes) => registry.reserveEvents(data, bytes) }),
    };
  };
  const deviceScope = (c: Context, deviceId: string): SeatScope => {
    let blank: SeatData | null = null;
    return {
      ...base('device', `device:${deviceId}`),
      get data() {
        return registry.peekBucket(deviceId) ?? (blank ??= registry.blank());
      },
      open: () => {
        const opened = registry.openBucket(deviceId, clientAddress(c));
        if (!opened.ok) return opened;
        const data = opened.data;
        return { ok: true, data, reserveEvents: (bytes) => registry.reserveEvents(data, bytes) };
      },
    };
  };
  /** 읽을 자리를 정할 수 없을 때의 범위: 저장하지 않는 빈 데이터. 픽스처도 남의 일정도 아니다. */
  const noneScope = (): SeatScope => {
    const data = registry.blank();
    return { ...base('none', 'none'), data, open: () => ({ ok: false, reason: 'unwritable' }) };
  };
  const legacyRead = (): SeatScope => {
    // 자리 있는 차가 하나도 없는 서버의 식별 없는 읽기만 기본 자리(픽스처·데모·차량 E2E)다.
    const cars = seats.seatedCarCount();
    if (cars === 0) return defaultScope();
    const seat = legacyDriverFallback && cars === 1 ? seats.soleCarSeat() : null;
    return seat ? seatScope(seat.seatId) : noneScope();
  };

  const resolveWrite = (c: Context): SeatScope | Response => {
    const auth = bearerOf(c);
    const device = deviceOf(c);
    if (device.kind === 'bad') return badDevice(c);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    if (auth.kind === 'none') return device.kind === 'none' ? defaultScope() : deviceScope(c, device.id);
    const found = seats.seatByToken(auth.token);
    if (!found) return unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
    return seatScope(found.seat.seatId);
  };

  const resolveRead = (c: Context): SeatScope | Response => {
    const auth = bearerOf(c);
    const device = deviceOf(c);
    if (device.kind === 'bad') return badDevice(c);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    const driver = c.req.query('driver');
    if (driver !== undefined) {
      if (auth.kind === 'none') return unauthorized(c, 'driver를 지정하려면 차 토큰이 필요합니다');
      const car = seats.carByToken(auth.token);
      const own = seats.seatByToken(auth.token);
      if (!car && !own) return unauthorized(c, '알 수 없는 토큰입니다');
      const allowed = (car !== null && seats.seatsOf(car.carId).some((s) => s.seatId === driver)) || own?.seat.seatId === driver;
      return allowed ? seatScope(driver) : forbidden(c, '그 운전자 자리를 볼 수 없습니다');
    }
    if (auth.kind === 'token') {
      const own = seats.seatByToken(auth.token);
      if (own) return seatScope(own.seat.seatId);
      // 차 토큰으로 driver 없이 읽는 것은 옛 차 앱 호환 읽기다: 그 차 안에서만 지난번 고른 자리(없으면 최근 자리). 자리가 없으면 빈 범위.
      const car = seats.carByToken(auth.token);
      if (car) {
        const seat = legacyDriverFallback ? seats.preferredSeat(car.carId) : null;
        return seat ? seatScope(seat.seatId) : noneScope();
      }
      return unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
    }
    if (device.kind === 'id') return deviceScope(c, device.id);
    return legacyRead();
  };

  /**
   * 차가 자리 데이터에 쓰는 요청(장소 기억 저장). 차 토큰이 있으면 `driver=<seatId>`가 그 차의 자리여야 하고(아니면 403), `driver`가 없으면
   * 옛 차 앱 호환으로 그 차의 지난번 고른 자리(없으면 가장 최근 자리)이며 자리가 없으면 409 `no-seat`다(`legacyDriverFallback: false`면 `driver`가 꼭 필요).
   * 차 토큰이 아닌 요청(폰 토큰·기기 id·식별 없음)은 폰의 쓰기와 같은 규칙이다(`resolveWrite`).
   */
  const resolveCarWrite = (c: Context): SeatScope | Response => {
    const auth = bearerOf(c);
    if (auth.kind !== 'token') return resolveWrite(c);
    const car = seats.carByToken(auth.token);
    if (!car || seats.seatByToken(auth.token)) return resolveWrite(c);
    if (deviceOf(c).kind === 'bad') return badDevice(c);
    const driver = c.req.query('driver');
    if (driver !== undefined) {
      return seats.seatsOf(car.carId).some((s) => s.seatId === driver)
        ? seatScope(driver)
        : forbidden(c, '그 운전자 자리를 볼 수 없습니다');
    }
    const seat = legacyDriverFallback ? seats.preferredSeat(car.carId) : null;
    return seat ? seatScope(seat.seatId) : c.json({ error: '쓸 운전자 자리를 정할 수 없습니다. driver를 지정해 주세요', reason: 'no-seat' as const }, 409);
  };

  const middleware = (resolve: (c: Context) => SeatScope | Response): MiddlewareHandler<SeatEnv> => async (c, next) => {
    const scope = resolve(c);
    if (scope instanceof Response) return scope;
    c.set('seat', scope);
    await next();
  };

  return {
    resolveWrite,
    resolveRead,
    /** 폰의 쓰기·폰 전용 요청이 쓰는 미들웨어 */
    write: middleware(resolveWrite),
    /** 읽기 요청이 쓰는 미들웨어 */
    read: middleware(resolveRead),
    /** 차가 자리 데이터에 쓰는 요청(차 토큰 + driver)이 쓰는 미들웨어. 폰 토큰·기기 id 요청은 `write`와 같다 */
    carWrite: middleware(resolveCarWrite),
  };
}

export type SeatGuard = ReturnType<typeof createSeatGuard>;
