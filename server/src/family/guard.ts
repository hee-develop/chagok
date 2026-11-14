import type { Context, MiddlewareHandler } from 'hono';
import { bearerOf, deviceOf, DEVICE_HEADER } from '../seatScope.js';
import type { SeatStore } from '../seats.js';
import { deviceKey, seatKey } from './groups.js';
import type { PhoneIdentity } from './service.js';

/**
 * 가족·요청 API의 호출자.
 * - `phone`: 폰. 폰 토큰이 있으면 그 자리(+기기 id가 있으면 같이)이고, 토큰이 없으면 기기 id만으로 알아본다(연결 전 폰도 가족 기능을 쓴다).
 * - `car`: 차. 차 토큰 + `driver=<자리 id>`(그 차의 자리). 차가 어느 자리를 대신해 부르는지 정한다.
 */
export type Who = { kind: 'phone'; identity: PhoneIdentity } | { kind: 'car'; carId: string; seatId: string };
export type FamilyEnv = { Variables: { who: Who } };

const unauthorized = (c: Context, error: string) => c.json({ error, reason: 'unauthorized' as const }, 401);
const forbidden = (c: Context, error: string) => c.json({ error, reason: 'forbidden' as const }, 403);
/** J3의 새 장소 API 가드(`placeRead`·`placeWrite`)와 같은 문구·상태: 차 토큰으로 부를 때는 `driver`가 꼭 필요하다. */
const driverRequired = (c: Context) => c.json({ error: '차 토큰으로 부를 때는 driver=<자리 id>가 꼭 필요합니다', reason: 'driver-required' as const }, 400);
const badDevice = (c: Context) => c.json({ error: `${DEVICE_HEADER} 헤더는 22~64자의 영문·숫자·-·_ 이어야 합니다`, reason: 'bad-device' as const }, 400);

/**
 * 가족·요청 API의 자리 정하기. **옛 차 앱 호환(`legacyDriverFallback`)과 기본 자리를 적용하지 않는다**(J3의 엄격한 가드와 같은 규칙):
 * 식별이 없는 요청은 어떤 자리의 데이터도 읽거나 쓰지 못하고 401이다(기본 자리·빈 범위·가장 최근 자리로 흘리지 않는다).
 * 알 수 없는 토큰·이상한 Authorization 형식도 401, 이상한 기기 id는 400이다.
 */
export function createFamilyGuard(seats: SeatStore) {
  const resolvePhone = (c: Context): Who | Response => {
    const auth = bearerOf(c);
    const device = deviceOf(c);
    if (device.kind === 'bad') return badDevice(c);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    const deviceKeys = device.kind === 'id' ? [deviceKey(device.id)] : [];
    if (auth.kind === 'token') {
      const found = seats.seatByToken(auth.token);
      if (!found) return unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
      return { kind: 'phone', identity: { keys: [seatKey(found.seat.seatId), ...deviceKeys] } };
    }
    if (deviceKeys.length === 0) return unauthorized(c, '폰 토큰 또는 기기 id가 필요합니다');
    return { kind: 'phone', identity: { keys: deviceKeys } };
  };

  const resolveCar = (c: Context): Who | Response => {
    const auth = bearerOf(c);
    if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
    if (auth.kind === 'none') return unauthorized(c, '차 토큰이 필요합니다');
    const car = seats.carByToken(auth.token);
    if (!car) return unauthorized(c, '알 수 없는 차 토큰입니다');
    const drivers = c.req.queries('driver');
    if (drivers === undefined || drivers.length === 0) return driverRequired(c);
    const driver = drivers[0] as string;
    if (drivers.length > 1 || driver === '') return driverRequired(c);
    if (!seats.seatsOf(car.carId).some((s) => s.seatId === driver)) return forbidden(c, '그 운전자 자리를 볼 수 없습니다');
    return { kind: 'car', carId: car.carId, seatId: driver };
  };

  /** 차 토큰이면 차, 아니면 폰. `GET /requests`처럼 같은 주소를 폰과 차가 함께 쓰는 곳. */
  const resolveAny = (c: Context): Who | Response => {
    const auth = bearerOf(c);
    return auth.kind === 'token' && seats.carByToken(auth.token) ? resolveCar(c) : resolvePhone(c);
  };

  const middleware = (resolve: (c: Context) => Who | Response): MiddlewareHandler<FamilyEnv> => async (c, next) => {
    const who = resolve(c);
    if (who instanceof Response) return who;
    c.set('who', who);
    await next();
  };
  return { phone: middleware(resolvePhone), car: middleware(resolveCar), any: middleware(resolveAny) };
}

export type FamilyGuard = ReturnType<typeof createFamilyGuard>;
