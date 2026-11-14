import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES } from '../limits.js';
import type { FamilyEnv, FamilyGuard } from '../family/guard.js';
import { parseCreateBody, PATCHABLE_STATUSES, type PatchableStatus } from '../family/requests.js';
import type { FamilyRequests } from '../family/service.js';
import { MAX_ID_LENGTH } from '../limits.js';
import { formatSeoulDate, parseAt, parseSeoulDate, seoulDay } from '../time.js';

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const NOT_IN_FAMILY_MESSAGE = '가족이 없습니다. 초대 코드를 만들거나 코드로 참여해 주세요';
export const REQUEST_NOT_FOUND_MESSAGE = '이 자리로 온 요청이 아니거나 없는(날짜가 지난) 요청입니다';

/**
 * 가족 요청(정책서 10.10). 폰은 만들기·조회, 차는 자리·'우리 차'로 온 요청 조회와 상태 변경·도착 예정 알림을 부른다.
 * 폰은 폰 토큰(또는 기기 id), 차는 차 토큰 + `driver=<자리 id>`가 필요하고 옛 차 앱 호환 읽기는 적용하지 않는다(`family/guard.ts`).
 * RPC 타입 추론을 위해 체이닝을 유지한다.
 */
export const createRequestsRoute = (guard: FamilyGuard, service: FamilyRequests, now: () => Date = () => new Date()) =>
  new Hono<FamilyEnv>()
    // 폰: 요청 만들기. 카테고리 4종·받는 사람(가족 한 사람 또는 우리 차)·장소·시간·한 줄 메모. 만들면 상태는 '보냄'(sent)이다.
    .post('/', guard.phone, tooLarge,
      validator('json', (raw: unknown, c) => {
        const body = parseCreateBody(raw, now());
        if ('error' in body) return c.json({ error: body.error, reason: 'bad-request' as const }, 400);
        return body;
      }),
      (c) => {
        const who = c.var.who;
        if (who.kind !== 'phone') return c.json({ error: '폰 요청이 아닙니다', reason: 'unauthorized' as const }, 401);
        const result = service.create(who.identity, c.req.valid('json'));
        if (result.ok) return c.json({ request: result.request }, 200);
        switch (result.reason) {
          case 'not-in-family':
            return c.json({ error: NOT_IN_FAMILY_MESSAGE, reason: 'not-in-family' as const }, 409);
          case 'too-many-requests':
            return c.json({ error: '보낼 수 있는 요청 수를 넘었습니다. 끝난 요청이 지워진 뒤에 다시 해 주세요', reason: 'too-many-requests' as const }, 429);
          case 'self':
            return c.json({ error: '자기 자신에게는 보낼 수 없습니다', reason: 'self' as const }, 400);
          case 'unknown-car':
            return c.json({ error: '가족 폰이 연결된 차가 아닙니다', reason: 'unknown-car' as const }, 400);
          case 'unknown-recipient':
            return c.json({ error: '우리 가족이 아닌 받는 사람입니다', reason: 'unknown-recipient' as const }, 400);
        }
      })
    // 폰: 보낸·받은 요청과 상태(?date= 로 그날만). 차(차 토큰 + driver): 그 자리로 온 요청과 '우리 차'로 온 요청 중 그날(?date=, 기본 오늘) 아직 끝나지 않은 것.
    .get('/', guard.any,
      validator('query', (value: { date?: string | string[]; driver?: string | string[] }, c) => {
        if (value.date === undefined) return { date: undefined as string | undefined };
        if (typeof value.date !== 'string' || parseSeoulDate(value.date) === null) return c.json({ error: 'date는 YYYY-MM-DD 형식의 실제 날짜여야 합니다', reason: 'bad-request' as const }, 400);
        return { date: value.date as string | undefined };
      }),
      (c) => {
        const who = c.var.who;
        const { date } = c.req.valid('query');
        const serverTime = now().toISOString();
        if (who.kind === 'car') {
          const day = date ?? formatSeoulDate(seoulDay(now().getTime()));
          return c.json({ driver: who.seatId, date: day, requests: service.listForCar(who.carId, who.seatId, day), serverTime }, 200);
        }
        const lists = service.listForPhone(who.identity, date);
        return c.json({ sent: lists?.sent ?? [], received: lists?.received ?? [], serverTime }, 200);
      })
    // 차: 요청 상태 바꾸기(전달·수락·거절·완료). 바뀌면 보낸 사람 폰 알림함에 알림. 표에 없는 전이는 409 invalid-transition.
    .patch('/:id', guard.car, tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).length !== 1 || typeof raw.status !== 'string' || !(PATCHABLE_STATUSES as readonly string[]).includes(raw.status)) {
          return c.json({ error: "status 하나('delivered'·'accepted'·'declined'·'completed')가 필요합니다", reason: 'bad-request' as const }, 400);
        }
        return { status: raw.status as PatchableStatus };
      }),
      (c) => {
        const who = c.var.who;
        const id = c.req.param('id');
        if (who.kind !== 'car' || id.length > MAX_ID_LENGTH) return c.json({ error: REQUEST_NOT_FOUND_MESSAGE, reason: 'not-found' as const }, 404);
        const result = service.patch(who.carId, who.seatId, id, c.req.valid('json').status);
        if (result.ok) return c.json({ request: result.request, changed: result.changed }, 200);
        if (result.reason === 'not-found') return c.json({ error: REQUEST_NOT_FOUND_MESSAGE, reason: 'not-found' as const }, 404);
        return c.json({ error: `${result.from} 상태에서 ${result.to}로 바꿀 수 없습니다`, reason: 'invalid-transition' as const, from: result.from, to: result.to }, 409);
      })
    // 차: 도착 5분 전(soon)·도착(arrived). 약속·픽업만. 받는 사람이 보낸 사람에게 도착 예정 공유를 켠 경우에만 보낸 사람 폰에 알림(notified).
    .post('/:id/eta', guard.car, tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).some((k) => k !== 'stage' && k !== 'etaAt') || (raw.stage !== 'soon' && raw.stage !== 'arrived')) {
          return c.json({ error: "stage('soon'|'arrived')와 선택 항목 etaAt이 필요합니다", reason: 'bad-request' as const }, 400);
        }
        let etaAt: string | null = null;
        if (raw.etaAt !== undefined) {
          const parsed = raw.stage === 'soon' && typeof raw.etaAt === 'string' ? parseAt(raw.etaAt) : null;
          if (parsed === null) return c.json({ error: 'etaAt은 stage가 soon일 때만 쓰는 오프셋이 있는 ISO8601 시각이어야 합니다', reason: 'bad-request' as const }, 400);
          etaAt = parsed.toISOString();
        }
        return { stage: raw.stage as 'soon' | 'arrived', etaAt };
      }),
      (c) => {
        const who = c.var.who;
        const id = c.req.param('id');
        if (who.kind !== 'car' || id.length > MAX_ID_LENGTH) return c.json({ error: REQUEST_NOT_FOUND_MESSAGE, reason: 'not-found' as const }, 404);
        const { stage, etaAt } = c.req.valid('json');
        const result = service.eta(who.carId, who.seatId, id, stage, etaAt);
        if (result.ok) return c.json({ notified: result.notified }, 200);
        if (result.reason === 'not-found') return c.json({ error: REQUEST_NOT_FOUND_MESSAGE, reason: 'not-found' as const }, 404);
        if (result.reason === 'not-eta-category') return c.json({ error: '약속 가기·데려다주기·픽업 요청만 도착 예정을 알릴 수 있습니다', reason: 'not-eta-category' as const }, 409);
        return c.json({ error: '끝났거나 아직 전달되지 않은 요청입니다', reason: 'not-in-progress' as const }, 409);
      });

/**
 * 차: 이 자리의 주행 시작·멈춤(위치 없음). 보낸 사람 폰의 '운전 중이라 다음 정차 때 전해요' 문구에만 쓴다(받는 사람이 도착 예정 공유를 켠 경우).
 * 차 토큰 + `driver=<자리 id>`.
 */
export const createDriveStateRoute = (guard: FamilyGuard, service: FamilyRequests) =>
  new Hono<FamilyEnv>().post('/', guard.car, tooLarge,
    validator('json', (raw: unknown, c) => {
      if (!isObject(raw) || Object.keys(raw).length !== 1 || typeof raw.driving !== 'boolean') return c.json({ error: 'driving(true|false) 하나가 필요합니다', reason: 'bad-request' as const }, 400);
      return { driving: raw.driving };
    }),
    (c) => {
      const who = c.var.who;
      if (who.kind !== 'car') return c.json({ error: '차 요청이 아닙니다', reason: 'unauthorized' as const }, 401);
      return c.json(service.setDriveState(who.seatId, c.req.valid('json').driving), 200);
    });
