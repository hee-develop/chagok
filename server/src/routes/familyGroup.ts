import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import { MAX_BODY_BYTES } from '../limits.js';
import type { FamilyGuard, FamilyEnv } from '../family/guard.js';
import type { FamilyRequests, PhoneIdentity } from '../family/service.js';
import { connectionAddress } from '../seatScope.js';

const tooLarge = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 폰 요청의 식별. 가드가 `phone`을 통과시켰으면 늘 폰이다. */
const identityOf = (c: { var: FamilyEnv['Variables'] }): PhoneIdentity => {
  const who = c.var.who;
  return who.kind === 'phone' ? who.identity : { memberToken: null, seat: null };
};

const MAX_NAME_BODY = 100;
const nameBody = (raw: unknown, c: Context) => {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length > MAX_NAME_BODY) return c.json({ error: `name은 ${MAX_NAME_BODY}자 이하 문자열이어야 합니다` }, 400);
  return raw;
};

export const FAMILY_NOT_FOUND = '가족이 없습니다. 초대 코드를 만들거나 코드로 참여해 주세요';
export const INVALID_INVITE_MESSAGE = '없거나 만료된 초대 코드입니다. 새 코드를 받아 다시 해 주세요';

/**
 * 가족 묶기(정책서 10.10·11장). 가족은 차와 따로 묶인다. 폰 전용이고 구성원 비밀값(`X-Chagok-Member`, 가족을 만들거나 참여할 때 한 번 받음) 또는
 * 구성원에게 묶인 자리의 폰 토큰으로 알아본다. 기기 id는 쓰지 않는다.
 * 옛 `GET /family/members`·`GET /family/requests`(픽스처 가족, `routes/family.ts`)는 그대로 있다.
 * RPC 타입 추론을 위해 체이닝을 유지한다.
 */
export const createFamilyGroupRoute = (guard: FamilyGuard, service: FamilyRequests, { now = () => new Date(), clientAddress = connectionAddress }: { now?: () => Date; clientAddress?: (c: Context) => string } = {}) =>
  new Hono<FamilyEnv>()
    // 내 가족과 구성원(부르는 이름·차 연결 여부·도착 예정 공유), 초대 코드, '우리 차'로 고를 수 있는 차. 가족이 없으면 family: null.
    .get('/', guard.phone, (c) => c.json({ family: service.familyView(identityOf(c)) }, 200))
    // 초대 코드 만들기. 구성원이 아니면 가족을 만들고 부른 사람이 첫 구성원이 되며 구성원 비밀값(memberToken)을 한 번 받는다. 이미 구성원이면 그 가족의 새 코드로 바꾼다(이전 코드는 버림).
    .post('/invite', guard.phoneOpen, tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).some((k) => k !== 'name')) return c.json({ error: '선택 항목 name만 보낼 수 있습니다' }, 400);
        const name = nameBody(raw.name, c);
        if (name !== undefined && typeof name !== 'string') return name;
        return { name } as { name?: string };
      }),
      (c) => {
        const identity = identityOf(c);
        const result = service.invite(identity, c.req.valid('json').name, clientAddress(c));
        if (!result.ok) {
          if (result.reason === 'family-full') return c.json({ error: '가족 인원이 가득 찼습니다', reason: 'family-full' as const }, 409);
          return c.json(
            { error: result.reason === 'rate-limited' ? '가족을 너무 자주 만들었습니다. 잠시 뒤 다시 해 주세요' : '서버가 받을 수 있는 가족 수를 넘었습니다', reason: result.reason },
            429,
          );
        }
        return c.json({
          code: result.family.invite!.code,
          expiresAt: new Date(result.expiresAt).toISOString(),
          expiresInSeconds: Math.max(0, Math.round((result.expiresAt - now().getTime()) / 1000)),
          created: result.created,
          /** 가족을 새로 만들 때만 있는 구성원 비밀값(이 응답이 마지막이다). 이미 구성원이었으면 null. */
          memberToken: result.memberToken,
          family: result.family,
        }, 200);
      })
    // 코드로 참여. 새 구성원이 되며 구성원 비밀값(memberToken)을 한 번 받는다. 틀린 코드는 차 연결 코드와 같은 시도 제한(요청 주소별 60초 5번 → 429 locked). 이미 가족이면 409.
    .post('/join', guard.phoneOpen, tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).some((k) => k !== 'code' && k !== 'name') || typeof raw.code !== 'string' || raw.code.length > 40) {
          return c.json({ error: 'code(초대 코드)와 선택 항목 name만 보낼 수 있습니다' }, 400);
        }
        const name = nameBody(raw.name, c);
        if (name !== undefined && typeof name !== 'string') return name;
        return { code: raw.code, name } as { code: string; name?: string };
      }),
      (c) => {
        const identity = identityOf(c);
        const { code, name } = c.req.valid('json');
        const result = service.join(identity, code, name, clientAddress(c));
        if (!result.ok) {
          if (result.reason === 'locked') {
            const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
            return c.json({ error: '초대 코드를 너무 많이 틀렸습니다. 잠시 뒤 다시 해 주세요', reason: 'locked' as const, retryAfterSeconds }, 429, { 'Retry-After': String(retryAfterSeconds) });
          }
          if (result.reason === 'already-in-family') return c.json({ error: '이미 가족에 속해 있습니다. 나간 뒤에 다시 참여해 주세요', reason: 'already-in-family' as const }, 409);
          if (result.reason === 'family-full') return c.json({ error: '가족 인원이 가득 찼습니다', reason: 'family-full' as const }, 409);
          return c.json({ error: INVALID_INVITE_MESSAGE, reason: 'invalid' as const }, 404);
        }
        // 새 구성원의 비밀값은 이 응답에만 있다(폰이 secure-store에 저장한다).
        return c.json({ memberToken: result.memberToken, family: result.family }, 200);
      })
    // 내 부르는 이름 바꾸기. 한 가족 안에서 겹치면 ' 2'를 붙인다.
    .put('/me', guard.phone, tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).length !== 1 || typeof raw.name !== 'string' || raw.name.length > MAX_NAME_BODY) {
          return c.json({ error: `name 하나(${MAX_NAME_BODY}자 이하 문자열)가 필요합니다` }, 400);
        }
        return { name: raw.name };
      }),
      (c) => {
        const me = service.rename(identityOf(c), c.req.valid('json').name);
        if (me === null) return c.json({ error: FAMILY_NOT_FOUND, reason: 'not-in-family' as const }, 404);
        return c.json({ me: { memberId: me.memberId, name: me.name } }, 200);
      })
    // 가족 나가기. 내가 보낸·받은 요청과 공유 설정(내가 켠 것, 나에게 켠 것)이 지워진다. 마지막 구성원이면 가족도 사라진다.
    .delete('/me', guard.phone, (c) => {
      if (!service.leave(identityOf(c))) return c.json({ error: FAMILY_NOT_FOUND, reason: 'not-in-family' as const }, 404);
      return c.json({ left: true as const }, 200);
    })
    // 도착 예정 공유 켜기·끄기: 내가 가족 한 사람에게 내 도착 예정(약속·픽업 요청의 시각과 주행 중 여부)을 보여 줄지. 기본 꺼짐.
    .put('/share', guard.phone, tooLarge,
      validator('json', (raw: unknown, c) => {
        if (!isObject(raw) || Object.keys(raw).length !== 2 || typeof raw.memberId !== 'string' || raw.memberId.length === 0 || raw.memberId.length > 100 || typeof raw.enabled !== 'boolean') {
          return c.json({ error: 'memberId(문자열)와 enabled(true|false)가 필요합니다' }, 400);
        }
        return { memberId: raw.memberId, enabled: raw.enabled };
      }),
      (c) => {
        const { memberId, enabled } = c.req.valid('json');
        const result = service.setShare(identityOf(c), memberId, enabled);
        if (!result.ok) {
          if (result.reason === 'not-in-family') return c.json({ error: FAMILY_NOT_FOUND, reason: 'not-in-family' as const }, 404);
          if (result.reason === 'self') return c.json({ error: '자기 자신과는 공유할 수 없습니다', reason: 'self' as const }, 400);
          return c.json({ error: '우리 가족이 아닌 구성원입니다', reason: 'unknown-member' as const }, 404);
        }
        return c.json({ memberId, enabled }, 200);
      });
