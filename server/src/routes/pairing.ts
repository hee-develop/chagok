import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';
import { bearerOf, connectionAddress, deviceOf, DEVICE_HEADER } from '../seatScope.js';
import type { SeatStore } from '../seats.js';
import { accessCar, claimFailure, qrContent, type PairRouteOptions } from './pair.js';
import { isLoopbackRequest } from './events.js';

const CODE_PATTERN = /^\d{6}$/;
const MAX_BODY_NAME_LENGTH = 100;

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) });
const validCarId = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_ID_LENGTH;

/**
 * 차–폰 연결의 옛 경로(차 id만으로 부르는 호환 경로). 현재 차 앱이 쓴다. 운전자 자리 모델은 같은 저장소(SeatStore)를 쓰고,
 * 정책서 이름의 새 API(`/pair/*`, `/drivers`, `/presence`, `/car`)가 차 토큰·폰 토큰을 쓰는 본 경로다(계약: docs/pairing.md).
 *
 * - `GET /cars/:carId`는 서버가 모르는 차면 404 `unknown-car`, 아는 차면 200이다. `paired`는 '이 차에 연결된 자리가 하나라도 있는가'이고 `pairedAt`은 가장 최근 연결 시각이다.
 * - 코드는 언제나 새 자리용이다(폰 바꾸기는 새 API).
 * - 응답에는 새 필드(carToken·seatId·name·phoneToken)가 더해졌다. 옛 필드는 그대로다.
 */
// RPC 타입 추론을 위해 체이닝을 유지한다. 검증기는 받은 본문 모양 그대로를 돌려준다(폰 RPC 타입이 이 모양을 쓴다).
export const createPairingRoute = (seats: SeatStore, { clientAddress = connectionAddress, isLoopback = isLoopbackRequest }: PairRouteOptions = {}) => {
  const status = (carId: string) => {
    const list = seats.seatsOf(carId);
    const latest = list.map((s) => s.pairedAt).sort().at(-1) ?? null;
    return { paired: list.length > 0, pairedAt: latest as string | null, codeActive: seats.codeStatus(carId).state === 'waiting' };
  };
  return new Hono()
    // 차가 코드를 받는다. qr은 차 화면 QR에 담을 글이다. carToken은 차를 처음 만든 응답에만 실린다(그 뒤 새 API에 쓴다).
    .post('/codes', tooLarge,
      validator('json', (raw: unknown, c) => {
        const v = raw as Record<string, unknown> | null;
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1 || !validCarId(v.carId)) {
          return c.json({ error: `carId(1~${MAX_ID_LENGTH}자) 하나가 필요합니다` }, 400);
        }
        return { carId: v.carId };
      }),
      (c) => {
        const access = accessCar(seats, c, c.req.valid('json').carId, true, { clientAddress, isLoopback });
        if (access instanceof Response) return access;
        const result = seats.issueCode(access.car.carId, { kind: 'new' });
        if (!result.ok) return c.json({ error: '이 차에 연결할 수 있는 폰 수를 넘었습니다', reason: 'seat-limit' as const }, 409);
        const { code, expiresAt } = result.issued;
        return c.json({ code, expiresAt, qr: qrContent(code), carToken: access.carToken }, 200);
      })
    // 차가 연결됐는지 본다(연결 카드를 띄운 동안 몇 초마다, 앱이 앞으로 올 때 한 번).
    // 서버가 모르는 차(서버를 다시 켜 메모리가 비었거나 자리 없는 차가 TTL로 지워짐)는 404 `unknown-car`다. 아는 차의 `paired:false`(자리 0개)는 200이다.
    // 그래서 차는 200 `paired:false`만 해제로 보고, 404는 서버 재시작일 수 있어 해제로 단정하지 않는다(차는 새 코드를 받으면 서버가 차를 다시 만든다).
    .get('/cars/:carId', (c) => {
      const carId = c.req.param('carId');
      if (!validCarId(carId)) return c.json({ error: 'carId가 올바르지 않습니다' }, 400);
      if (!seats.car(carId)) return c.json({ error: '서버가 모르는 차입니다', reason: 'unknown-car' as const }, 404);
      return c.json(status(carId), 200);
    })
    // 폰이 QR이나 숫자로 받은 코드를 보낸다. 새 API(/pair/claim)와 같지만 응답 앞부분이 옛 모양({ carId, pairedAt })이다.
    .post('/claim', tooLarge,
      validator('json', (raw: unknown, c) => {
        const v = raw as Record<string, unknown> | null;
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => k !== 'code' && k !== 'name') || typeof v.code !== 'string' || !CODE_PATTERN.test(v.code)) {
          return c.json({ error: 'code(숫자 6자리)와 선택 항목 name만 보낼 수 있습니다' }, 400);
        }
        if (v.name !== undefined && (typeof v.name !== 'string' || v.name.length > MAX_BODY_NAME_LENGTH)) {
          return c.json({ error: `name은 ${MAX_BODY_NAME_LENGTH}자 이하 문자열이어야 합니다` }, 400);
        }
        return (v.name === undefined ? { code: v.code } : { code: v.code, name: v.name }) as { code: string; name?: string };
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
        const { seat, phoneToken } = result;
        return c.json({ pairedAt: seat.pairedAt, seatId: seat.seatId, name: seat.name, phoneToken }, 200);
      })
    // 데모 초기화: 그 차의 연결(모든 자리)과 서버 데이터를 지운다. 새 API의 DELETE /car와 같다.
    // 자리가 있는 차는 그 차의 토큰이 있거나 같은 기기(루프백) 요청일 때만 지운다(carId만 아는 다른 기기가 남의 연결을 끊지 못하게).
    .delete('/cars/:carId', (c) => {
      const carId = c.req.param('carId');
      if (!validCarId(carId)) return c.json({ error: 'carId가 올바르지 않습니다' }, 400);
      if (seats.seatsOf(carId).length > 0) {
        const auth = bearerOf(c);
        if (auth.kind === 'bad') return c.json({ error: 'Authorization 형식이 올바르지 않습니다', reason: 'unauthorized' as const }, 401);
        const own = auth.kind === 'token' && seats.carByToken(auth.token)?.carId === carId;
        if (!own && !isLoopback(c)) return c.json({ error: '연결된 폰이 있는 차는 차 토큰이 필요합니다', reason: 'unauthorized' as const }, 401);
      }
      seats.resetCar(carId);
      return c.json(status(carId), 200);
    });
};
