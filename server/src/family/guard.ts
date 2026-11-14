import type { Context, MiddlewareHandler } from 'hono';
import { bearerOf, driverOf } from '../seatScope.js';
import type { SeatStore } from '../seats.js';
import { MEMBER_HEADER, MEMBER_TOKEN_PATTERN, type PhoneIdentity } from './groups.js';

/**
 * 가족·요청 API의 호출자.
 * - `phone`: 폰. 신원은 구성원 비밀값(`X-Chagok-Member`) 또는 이미 구성원에게 묶인 자리의 폰 토큰이다. 기기 id(`X-Chagok-Device`)는 읽지도 않는다.
 * - `car`: 차. 차 토큰 + `driver=<자리 id>`(그 차의 자리). 차가 어느 자리를 대신해 부르는지 정한다.
 */
export type Who = { kind: 'phone'; identity: PhoneIdentity } | { kind: 'car'; carId: string; seatId: string };
export type FamilyEnv = { Variables: { who: Who } };

/** 가드가 구성원 비밀값이 있는지 물어보는 곳(가족 요청 서비스가 채운다). */
export type MemberDirectory = { knowsMember(token: string): boolean };

export const UNKNOWN_MEMBER_MESSAGE = '이 구성원 비밀값의 가족 구성원이 없습니다(나갔거나 오래 쓰지 않아 정리됨). 비밀값을 지우고 가족에 새로 참여해 주세요';

const unauthorized = (c: Context, error: string) => c.json({ error, reason: 'unauthorized' as const }, 401);
const forbidden = (c: Context, error: string) => c.json({ error, reason: 'forbidden' as const }, 403);
/** J3의 새 장소 API 가드(`placeRead`·`placeWrite`)와 같은 문구·상태: 차 토큰으로 부를 때는 `driver`가 꼭 필요하다. */
const driverRequired = (c: Context) => c.json({ error: '차 토큰으로 부를 때는 driver=<자리 id>가 꼭 필요합니다', reason: 'driver-required' as const }, 400);
const badMember = (c: Context) => c.json({ error: `${MEMBER_HEADER} 헤더는 32~128자의 영문·숫자·-·_ 이어야 합니다`, reason: 'bad-member' as const }, 400);

/**
 * 가족·요청 API의 자리 정하기. **옛 차 앱 호환(`legacyDriverFallback`)과 기본 자리를 적용하지 않는다**(J3의 엄격한 가드와 같은 규칙):
 * 식별이 없는 요청은 어떤 자리의 데이터도 읽거나 쓰지 못하고 401이다(기본 자리·빈 범위·가장 최근 자리로 흘리지 않는다).
 * 알 수 없는 폰 토큰·이상한 Authorization 형식·모르는 구성원 비밀값은 401, 이상한 구성원 비밀값 모양은 400이다.
 * 차의 `driver`는 자리 정하기 가드(`seatScope.ts`)와 같은 `driverOf`로 읽는다.
 */
export function createFamilyGuard(seats: SeatStore, members: MemberDirectory) {
  /**
   * `open`이면 아무 증거가 없어도 통과한다(`POST /family/invite`·`/join`: 구성원 비밀값 없이 부르는 것이 새 구성원이 되는 길이다).
   * 아니면 비밀값이나 폰 토큰 중 하나는 있어야 한다.
   */
  const resolvePhone = (c: Context, open: boolean): Who | Response => {
    const auth = bearerOf(c);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    const header = c.req.header(MEMBER_HEADER);
    if (header !== undefined && !MEMBER_TOKEN_PATTERN.test(header)) return badMember(c);
    let seat: PhoneIdentity['seat'] = null;
    if (auth.kind === 'token') {
      const found = seats.seatByToken(auth.token);
      if (!found) return unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
      seat = { seatId: found.seat.seatId, carId: found.carId };
    }
    if (header !== undefined && !members.knowsMember(header)) {
      return c.json({ error: UNKNOWN_MEMBER_MESSAGE, reason: 'unknown-member' as const }, 401);
    }
    if (header === undefined && seat === null && !open) return unauthorized(c, '구성원 비밀값 또는 폰 토큰이 필요합니다');
    return { kind: 'phone', identity: { memberToken: header ?? null, seat } };
  };

  const resolveCar = (c: Context): Who | Response => {
    const auth = bearerOf(c);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    if (auth.kind === 'none') return unauthorized(c, '차 토큰이 필요합니다');
    const car = seats.carByToken(auth.token);
    if (!car) return unauthorized(c, '알 수 없는 차 토큰입니다');
    const driver = driverOf(c);
    if (driver === undefined) return driverRequired(c);
    if (!seats.seatsOf(car.carId).some((s) => s.seatId === driver)) return forbidden(c, '그 운전자 자리를 볼 수 없습니다');
    return { kind: 'car', carId: car.carId, seatId: driver };
  };

  /** 차 토큰이면 차, 아니면 폰. `GET /requests`처럼 같은 주소를 폰과 차가 함께 쓰는 곳. */
  const resolveAny = (c: Context): Who | Response => {
    const auth = bearerOf(c);
    return auth.kind === 'token' && seats.carByToken(auth.token) ? resolveCar(c) : resolvePhone(c, false);
  };

  const middleware = (resolve: (c: Context) => Who | Response): MiddlewareHandler<FamilyEnv> => async (c, next) => {
    const who = resolve(c);
    if (who instanceof Response) return who;
    c.set('who', who);
    await next();
  };
  return {
    /** 폰: 구성원 비밀값 또는 구성원에게 묶인 폰 토큰이 있어야 한다. */
    phone: middleware((c) => resolvePhone(c, false)),
    /** 폰: 증거가 없어도 통과한다(가족 만들기·참여). */
    phoneOpen: middleware((c) => resolvePhone(c, true)),
    car: middleware(resolveCar),
    any: middleware(resolveAny),
  };
}

export type FamilyGuard = ReturnType<typeof createFamilyGuard>;
