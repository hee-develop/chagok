import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';
import { bearerOf, connectionAddress, deviceOf, DEVICE_HEADER } from '../seatScope.js';
import type { Car, ClaimResult, CodeBinding, CodeMode, SeatStore } from '../seats.js';

const CODE_PATTERN = /^\d{6}$/;
const MAX_BODY_NAME_LENGTH = 100;

export const qrContent = (code: string) => `chagok://pair?code=${code}` as const;

export type PairRouteOptions = {
  now?: () => Date;
  /**
   * 요청 주소(코드 시도 횟수를 세는 단위). 기본은 node 서버의 연결 주소이고 알 수 없으면 'unknown' 하나로 묶는다.
   * 프록시 뒤에서는 모든 요청이 한 주소로 보이니 이 함수를 바꿔야 한다. 헤더(X-Forwarded-For)는 속일 수 있어 기본으로는 믿지 않는다.
   */
  clientAddress?: (c: Context) => string;
  /**
   * 같은 기기(루프백) 요청인가. 자리가 이미 있는 차의 옛 `/pairing/*` 경로(코드 발급·초기화)는 차 토큰이 있거나 같은 기기일 때만 받는다
   * (에뮬레이터의 차 앱은 호스트 루프백으로 들어온다). 기본은 `/events`와 같은 판정이고, 프록시 뒤에서는 바꿔야 한다.
   */
  isLoopback?: (c: Context) => boolean;
};

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) });

/** 본문이 비었으면 {}, JSON이 아니면 undefined. */
const readBody = async (c: Context): Promise<unknown> => {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_ID_LENGTH;
const unauthorized = (c: Context, error: string) => c.json({ error, reason: 'unauthorized' as const }, 401);

/**
 * 차 토큰으로 차를 알아본다. 모르는 토큰이거나 토큰이 없으면 401 응답을 돌려준다.
 * (`DELETE /car`·`GET /drivers`처럼 차만 부를 수 있는 API가 쓴다.)
 */
export const requireCar = (seats: SeatStore, c: Context): Car | Response => {
  const auth = bearerOf(c);
  if (auth.kind !== 'token') return unauthorized(c, '차 토큰이 필요합니다');
  return seats.carByToken(auth.token) ?? unauthorized(c, '알 수 없는 차 토큰입니다');
};

/** 폰 토큰으로 자리를 알아본다. */
export const requireSeat = (seats: SeatStore, c: Context) => {
  const auth = bearerOf(c);
  if (auth.kind !== 'token') return unauthorized(c, '폰 토큰이 필요합니다');
  const found = seats.seatByToken(auth.token);
  return found ? { token: auth.token, ...found } : unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
};

type CarAccess = { car: Car; carToken: string | null } | Response;

export type CarAccessContext = { clientAddress: (c: Context) => string; isLoopback: (c: Context) => boolean };

/**
 * 코드를 요청하는 차를 정한다. carToken은 이번 응답으로 차에 처음 알려 주는 토큰이고, 이미 가진 차에는 null이다. 토큰은 다시 내주지 않는다
 * (토큰을 잃은 차는 새 carId로 다시 등록하고, 자리 없는 옛 차는 TTL로 정리된다).
 * - 토큰이 있으면 그 차(본문 carId가 다르면 403).
 * - 토큰이 없고 아는 차가 아니면 새로 만든다(본문 carId를 쓰고, 없으면 서버가 정한다. 한 요청 주소가 짧은 시간에 만들 수 있는 수는 제한).
 * - 토큰이 없는데 아는 차이면: 새 API는 401. legacy(옛 `/pairing` 경로, 현재 차 앱)는 연결된 자리가 없는 차는 예전처럼 carId만으로,
 *   자리가 있는 차는 같은 기기(루프백) 요청일 때만 받는다. legacy는 토큰도 새로 주지 않는다.
 */
export function accessCar(seats: SeatStore, c: Context, bodyCarId: string | undefined, legacy: boolean, ctx: CarAccessContext): CarAccess {
  const auth = bearerOf(c);
  if (auth.kind === 'bad') return unauthorized(c, 'Authorization 형식이 올바르지 않습니다');
  if (auth.kind === 'token') {
    const car = seats.carByToken(auth.token);
    if (!car) return unauthorized(c, '알 수 없는 차 토큰입니다');
    if (bodyCarId !== undefined && bodyCarId !== car.carId) return c.json({ error: '토큰의 차와 carId가 다릅니다', reason: 'forbidden' as const }, 403);
    return { car, carToken: null };
  }
  const existing = bodyCarId === undefined ? null : seats.car(bodyCarId);
  if (existing) {
    if (!legacy) return unauthorized(c, '이미 등록된 차는 차 토큰이 필요합니다. 토큰을 잃었다면 새 carId로 다시 등록해 주세요');
    if (seats.seatsOf(existing.carId).length > 0 && !ctx.isLoopback(c)) {
      return unauthorized(c, '연결된 폰이 있는 차는 차 토큰이 필요합니다');
    }
    return { car: existing, carToken: null };
  }
  const created = seats.createCar(ctx.clientAddress(c), bodyCarId);
  if (created.ok) return { car: created.car, carToken: created.car.carToken };
  if (created.reason === 'exists') return unauthorized(c, '이미 등록된 차는 차 토큰이 필요합니다');
  return created.reason === 'too-many-cars'
    ? c.json({ error: '서버가 받을 수 있는 차 수를 넘었습니다', reason: 'too-many-cars' as const }, 429)
    : c.json({ error: '차를 너무 자주 등록했습니다. 잠시 뒤 다시 해 주세요', reason: 'rate-limited' as const }, 429);
}

type CodeRequest = { carId?: string; mode: CodeMode; binding: CodeBinding };

/** POST /pair/code 본문: { carId?, mode?: 'new'|'replace', seatId?(replace일 때), btDeviceId?, pleosProfileId? } */
function parseCodeRequest(raw: unknown): CodeRequest | string {
  if (!isObject(raw)) return '본문은 객체여야 합니다';
  const allowed = new Set(['carId', 'mode', 'seatId', 'btDeviceId', 'pleosProfileId']);
  if (Object.keys(raw).some((k) => !allowed.has(k))) return '알 수 없는 항목이 있습니다';
  if (raw.carId !== undefined && !isId(raw.carId)) return `carId는 1~${MAX_ID_LENGTH}자 문자열이어야 합니다`;
  if (raw.mode !== undefined && raw.mode !== 'new' && raw.mode !== 'replace') return "mode는 'new' 또는 'replace'여야 합니다";
  for (const key of ['btDeviceId', 'pleosProfileId'] as const) {
    const v = raw[key];
    if (v !== undefined && v !== null && !isId(v)) return `${key}는 1~${MAX_ID_LENGTH}자 문자열 또는 null이어야 합니다`;
  }
  const binding: CodeBinding = {};
  if (raw.btDeviceId !== undefined) binding.btDeviceId = raw.btDeviceId as string | null;
  if (raw.pleosProfileId !== undefined) binding.pleosProfileId = raw.pleosProfileId as string | null;
  if (raw.mode === 'replace') {
    if (!isId(raw.seatId)) return 'mode가 replace이면 바꿀 자리 seatId가 필요합니다';
    return { carId: raw.carId as string | undefined, mode: { kind: 'replace', seatId: raw.seatId }, binding };
  }
  if (raw.seatId !== undefined) return 'seatId는 mode가 replace일 때만 쓸 수 있습니다';
  return { carId: raw.carId as string | undefined, mode: { kind: 'new' }, binding };
}

/** 코드 발급 응답 본문. 차 토큰은 처음 알려 줄 때만 실린다. */
export const issuedBody = (issued: { code: string; expiresAt: string; mode: CodeMode }, carId: string, carToken: string | null, now: Date) => ({
  carId,
  carToken,
  code: issued.code,
  expiresAt: issued.expiresAt,
  expiresInSeconds: Math.max(0, Math.round((Date.parse(issued.expiresAt) - now.getTime()) / 1000)),
  qr: qrContent(issued.code),
  mode: issued.mode.kind,
  seatId: issued.mode.kind === 'replace' ? issued.mode.seatId : (null as string | null),
});

export const invalidCodeMessage = '없거나 만료된 코드입니다. 차 화면의 새 코드로 다시 해 주세요';
export const lockedMessage = '코드를 너무 많이 틀렸습니다. 잠시 뒤 다시 해 주세요';

/** 코드가 안 맞을 때의 응답 본문과 상태. 폰 RPC 타입에 상태별로 잡히도록 라우트가 c.json으로 보낸다. */
export const claimFailure = (result: Exclude<ClaimResult, { ok: true }>) =>
  result.reason === 'locked'
    ? ({ status: 429 as const, body: { error: lockedMessage, reason: 'locked' as const, retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000) } })
    : result.reason === 'seat-limit'
      ? ({ status: 409 as const, body: { error: '이 차에 연결할 수 있는 폰 수를 넘었습니다', reason: 'seat-limit' as const } })
      : ({ status: 404 as const, body: { error: invalidCodeMessage, reason: 'invalid' as const } });

// RPC 타입 추론을 위해 체이닝을 유지한다. 폰은 claim·상태·끊기를, 차는 code·status를 부른다.
export const createPairRoute = (
  seats: SeatStore,
  { now = () => new Date(), clientAddress = connectionAddress, isLoopback = () => false }: PairRouteOptions = {},
) =>
  new Hono()
    // 차: 코드 발급. 본문 { carId?, mode?, seatId?, btDeviceId?, pleosProfileId? }는 모두 생략할 수 있다(생략하면 새 자리).
    // Authorization 토큰이 이 차의 것이면 그 차로, 처음이면 차를 만들어 carToken을 한 번 알려 준다.
    .post('/code', tooLarge, async (c) => {
      const body = parseCodeRequest(await readBody(c));
      if (typeof body === 'string') return c.json({ error: body }, 400);
      const access = accessCar(seats, c, body.carId, false, { clientAddress, isLoopback });
      if (access instanceof Response) return access;
      const result = seats.issueCode(access.car.carId, body.mode, body.binding);
      if (!result.ok) {
        return result.reason === 'unknown-seat'
          ? c.json({ error: '이 차에 없는 자리입니다', reason: 'unknown-seat' as const }, 404)
          : c.json({ error: '이 차에 연결할 수 있는 폰 수를 넘었습니다', reason: 'seat-limit' as const }, 409);
      }
      return c.json(issuedBody(result.issued, access.car.carId, access.carToken, now()), 200);
    })
    // 차: 마지막으로 낸 코드 상태. waiting(기다림)·claimed(연결됨, seatId)·expired(만료)·none(낸 적 없음, 서버를 다시 켠 뒤 포함).
    .get('/status', (c) => {
      const car = requireCar(seats, c);
      if (car instanceof Response) return car;
      return c.json(seats.codeStatus(car.carId), 200);
    })
    // 폰: 코드로 자리에 연결. 폰은 응답의 phoneToken을 저장하고 이후 요청에 Authorization: Bearer로 붙인다.
    .post('/claim', tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).some((k) => k !== 'code' && k !== 'name') || typeof raw.code !== 'string' || !CODE_PATTERN.test(raw.code)) {
          return c.json({ error: 'code(숫자 6자리)와 선택 항목 name만 보낼 수 있습니다' }, 400);
        }
        if (raw.name !== undefined && (typeof raw.name !== 'string' || raw.name.length > MAX_BODY_NAME_LENGTH)) {
          return c.json({ error: `name은 ${MAX_BODY_NAME_LENGTH}자 이하 문자열이어야 합니다` }, 400);
        }
        return (raw.name === undefined ? { code: raw.code } : { code: raw.code, name: raw.name }) as { code: string; name?: string };
      }),
      (c) => {
        const { code, name } = c.req.valid('json');
        const device = deviceOf(c);
        if (device.kind === 'bad') return c.json({ error: `${DEVICE_HEADER} 헤더가 올바르지 않습니다`, reason: 'bad-device' as const }, 400);
        const auth = bearerOf(c);
        const result = seats.claim({
          code, name, source: clientAddress(c), phoneToken: auth.kind === 'token' ? auth.token : null, deviceId: device.kind === 'id' ? device.id : null,
        });
        if (!result.ok) {
          const failure = claimFailure(result);
          return c.json(failure.body, failure.status, failure.status === 429 ? { 'Retry-After': String(failure.body.retryAfterSeconds) } : {});
        }
        // 폰에는 차 id를 주지 않는다(차 id는 옛 경로에서 차를 가리키는 열쇠라 차만 안다). 폰은 자리 id·이름으로 연결을 본다.
        const { seat, phoneToken, mode } = result;
        return c.json({ seatId: seat.seatId, name: seat.name, phoneToken, pairedAt: seat.pairedAt, mode }, 200);
      })
    // 폰: 지금 연결 상태(200 연결됨: 자리 이름·연결 시각 / 401 연결 안 됨). carId는 주지 않는다.
    .get('/', (c) => {
      const found = requireSeat(seats, c);
      if (found instanceof Response) return found;
      const { seat } = found;
      return c.json({
        paired: true as const, seatId: seat.seatId, name: seat.name, pairedAt: seat.pairedAt, lastEventsAt: seat.lastEventsAt,
        presence: seat.presence, lastPresenceAt: seat.lastPresenceAt,
      }, 200);
    })
    // 폰: 차 연결 끊기. 그 자리의 연결·일정·기억(자주 가는 곳 등)을 모두 지운다.
    .delete('/', (c) => {
      const found = requireSeat(seats, c);
      if (found instanceof Response) return found;
      seats.disconnect(found.token);
      return c.json({ disconnected: true as const, seatId: found.seat.seatId }, 200);
    });

export const createDriversRoute = (seats: SeatStore) =>
  new Hono()
    // 차: 연결된 운전자 자리 목록, 차 블루투스에 붙었다고 알려 온 폰, 지난번 고른 자리.
    .get('/', (c) => {
      const car = requireCar(seats, c);
      if (car instanceof Response) return car;
      return c.json(seats.drivers(car.carId), 200);
    })
    // 차: '바꾸기' 칩으로 고른 자리를 다음 판단의 기준으로 기억한다.
    .put('/selected', tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).length !== 1 || !isId(raw.seatId)) return c.json({ error: 'seatId 하나가 필요합니다' }, 400);
        return { seatId: raw.seatId };
      }),
      (c) => {
        const car = requireCar(seats, c);
        if (car instanceof Response) return car;
        const { seatId } = c.req.valid('json');
        if (!seats.select(car.carId, seatId)) return c.json({ error: '이 차에 없는 자리입니다', reason: 'unknown-seat' as const }, 404);
        return c.json({ lastSelectedSeatId: seatId }, 200);
      });

export const createPresenceRoute = (seats: SeatStore) =>
  new Hono()
    // 폰(갤럭시): 차 블루투스에 붙었다·떨어졌다. 차는 탑승 시각과 10분 안의 신호만 쓴다(5장 운전자 판단 ③).
    .post('/', tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).length !== 1 || typeof raw.connected !== 'boolean') return c.json({ error: 'connected(true|false) 하나가 필요합니다' }, 400);
        return { connected: raw.connected };
      }),
      (c) => {
        const found = requireSeat(seats, c);
        if (found instanceof Response) return found;
        const seat = seats.presence(found.token, c.req.valid('json').connected);
        if (!seat) return unauthorized(c, '연결이 끊겼거나 다른 폰으로 바뀐 토큰입니다. 차와 다시 연결해 주세요');
        return c.json({ seatId: seat.seatId, connected: seat.presence === 'connected', at: seat.lastPresenceAt as string }, 200);
      });

export const createCarRoute = (seats: SeatStore) =>
  new Hono()
    // 차: 차곡 초기화. 그 차의 모든 자리와 서버 데이터(일정·기억)를 지운다. 차 id와 토큰은 남아 새 코드를 낼 수 있다.
    .delete('/', (c) => {
      const car = requireCar(seats, c);
      if (car instanceof Response) return car;
      return c.json({ removedSeats: seats.resetCar(car.carId) }, 200);
    });
