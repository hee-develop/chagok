import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import type { SeatData, SeatDataRegistry } from './seatData.js';
import { DEFAULT_SEAT_ID, type SeatStore } from './seats.js';

/** 요청이 다루는 운전자 자리와 그 데이터. */
export type SeatScope = { seatId: string; data: SeatData };
export type SeatEnv = { Variables: { seat: SeatScope } };

type Bearer = { kind: 'none' } | { kind: 'bad' } | { kind: 'token'; token: string };

/** Authorization: Bearer <토큰>. 토큰은 서버가 낸 16진수 64자이지만 모양은 느슨하게 받고 모르는 토큰은 찾을 때 거른다. */
export const bearerOf = (c: Context): Bearer => {
  const header = c.req.header('authorization');
  if (header === undefined) return { kind: 'none' };
  const m = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(header);
  return m ? { kind: 'token', token: m[1] as string } : { kind: 'bad' };
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
   * 자리 지정(토큰·driver) 없는 읽기가 가장 최근에 연결한 자리를 본다(연결된 자리가 없으면 기본 자리).
   * 자리를 모르는 옛 차 앱이 새 폰이 보낸 일정을 계속 받게 하는 호환이다. 차가 driver를 보내게 되면 끈다.
   */
  legacyDriverFallback: boolean;
};

const unauthorized = (c: Context, error: string) => c.json({ error, reason: 'unauthorized' as const }, 401);
const forbidden = (c: Context, error: string) => c.json({ error, reason: 'forbidden' as const }, 403);

/**
 * 요청이 어느 운전자 자리의 데이터를 다루는지 정한다.
 *
 * - 쓰기(폰): 폰 토큰이 있으면 그 자리, 없으면 기본 자리(연결 전 폰·옛 클라이언트·픽스처 경로). 모르는 토큰(바뀌거나 끊긴 폰)은 401.
 * - 읽기: `driver=<seatId>`는 그 자리를 가진 차의 토큰(또는 그 자리 폰의 토큰)이 있어야 한다. 폰 토큰만 있으면 그 자리,
 *   아무것도 없으면 legacyDriverFallback에 따라 가장 최근에 연결한 자리 또는 기본 자리.
 */
export function createSeatGuard(seats: SeatStore, registry: SeatDataRegistry, { legacyDriverFallback }: SeatGuardOptions) {
  const scopeOf = (seatId: string): SeatScope => ({ seatId, data: registry.get(seatId) });
  const legacyRead = (): SeatScope => scopeOf((legacyDriverFallback ? seats.latestSeat()?.seatId : undefined) ?? DEFAULT_SEAT_ID);

  const resolveWrite = (c: Context): SeatScope | Response => {
    const auth = bearerOf(c);
    if (auth.kind === 'none') return scopeOf(DEFAULT_SEAT_ID);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    const found = seats.seatByToken(auth.token);
    if (!found) return unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
    return scopeOf(found.seat.seatId);
  };

  const resolveRead = (c: Context): SeatScope | Response => {
    const auth = bearerOf(c);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    const driver = c.req.query('driver');
    if (driver !== undefined) {
      if (auth.kind === 'none') return unauthorized(c, 'driver를 지정하려면 차 토큰이 필요합니다');
      const car = seats.carByToken(auth.token);
      const own = seats.seatByToken(auth.token);
      if (!car && !own) return unauthorized(c, '알 수 없는 토큰입니다');
      const allowed = (car !== null && seats.seatsOf(car.carId).some((s) => s.seatId === driver)) || own?.seat.seatId === driver;
      return allowed ? scopeOf(driver) : forbidden(c, '그 운전자 자리를 볼 수 없습니다');
    }
    if (auth.kind === 'token') {
      const own = seats.seatByToken(auth.token);
      if (own) return scopeOf(own.seat.seatId);
      // 차 토큰으로 driver 없이 읽는 것은 옛 차 앱과 같은 기본 읽기다.
      if (seats.carByToken(auth.token)) return legacyRead();
      return unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
    }
    return legacyRead();
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
  };
}

export type SeatGuard = ReturnType<typeof createSeatGuard>;
