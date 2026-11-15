import type { InferResponseType } from 'hono/client';

import { HttpError } from '../../api/request';
import { familyClient, type FamilyClient } from './familyClient';
import { memberSession, type MemberSession } from './memberSecret';
import { session as phoneSession, type Session } from '../../api/session';
import { normalizeRequest, normalizeRequests, type ReceivedRequest, type SentRequest } from './requestModel';
import type { CreateRequestBody } from './requestForm';

/** 내 가족(`GET /family`): 구성원(부르는 이름·차 연결 여부·도착 예정 공유), 초대 코드, '우리 차'로 고를 수 있는 차. */
export type FamilyView = NonNullable<InferResponseType<FamilyClient['family']['$get'], 200>['family']>;
export type FamilyMemberView = FamilyView['members'][number];

/**
 * 보낸·받은 요청. `family`가 거짓이면 이 폰이 가족에 속하지 않아 받을 요청이 있을 수 없다는 뜻이라(서버에 묻지 않고 알았거나 서버가 모른다고 함),
 * 목록을 주기적으로 다시 읽을 이유가 없다. 없으면(`undefined`) 알 수 없는 것으로 보고 그대로 읽는다.
 */
export type RequestLists = { sent: SentRequest[]; received: ReceivedRequest[]; family?: boolean };

/** 서버가 ok가 아닌 응답을 돌려줬을 때 던진다. `reason`은 서버가 본문에 준 이유 코드(`family-full`·`locked`·`bad-request` …). */
export class FamilyHttpError extends HttpError {
  readonly reason: string | null;
  readonly retryAfterSeconds: number | null;
  /** 서버가 준 한국어 설명(개발자용 문장이라 화면에는 그대로 쓰지 않고 지난 시각 같은 한두 가지를 가르는 데만 쓴다). */
  readonly serverMessage: string | null;

  constructor(status: number, what: string, body: { reason: string | null; retryAfterSeconds: number | null; message: string | null }) {
    super(status, `${what} ${status}`);
    this.name = 'FamilyHttpError';
    this.reason = body.reason;
    this.retryAfterSeconds = body.retryAfterSeconds;
    this.serverMessage = body.message;
    Object.setPrototypeOf(this, FamilyHttpError.prototype);
  }
}

async function fail(res: { status: number; json: () => Promise<unknown> }, what: string): Promise<never> {
  let reason: string | null = null;
  let retryAfterSeconds: number | null = null;
  let message: string | null = null;
  try {
    const body = (await res.json()) as { reason?: unknown; retryAfterSeconds?: unknown; error?: unknown };
    reason = typeof body.reason === 'string' ? body.reason : null;
    retryAfterSeconds = typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : null;
    message = typeof body.error === 'string' ? body.error : null;
  } catch {
    // 본문이 없거나 JSON이 아니면 상태 코드만 쓴다.
  }
  throw new FamilyHttpError(res.status, what, { reason, retryAfterSeconds, message });
}

/**
 * 가족 묶기·요청 API(계약: docs/family-requests.md). 구성원 비밀값은 만들거나 참여한 응답을 받는 즉시 저장하고(`memberSession`) 이후 모든 호출에 헤더로 붙는다(`familyClient`).
 * - 식별이 없거나(401) 서버가 모르는 구성원이면(`unknown-member`, 요청 층이 비밀값을 이미 지움) 가족이 없는 것으로 다룬다.
 * - 가족을 나가면(`leave`) 비밀값을 지운다. 차 연결을 끊어도 지우지 않는다(가족은 차와 따로 묶인다).
 */
export type FamilyGroupApi = {
  /** 내 가족. 가족이 없거나 식별이 없으면 null. 저장한 비밀값도 폰 토큰도 없으면 서버에 묻지 않는다. */
  fetchFamily: (signal: AbortSignal) => Promise<FamilyView | null>;
  /** 초대 코드를 만든다. 가족이 없으면 가족을 만들고 내가 첫 구성원이 된다(`name`은 부르는 이름). 이미 구성원이면 새 코드로 바꾼다. */
  invite: (name: string | undefined, signal: AbortSignal) => Promise<FamilyView>;
  /** 초대 코드로 참여한다(새 구성원이 됨). */
  join: (code: string, name: string | undefined, signal: AbortSignal) => Promise<FamilyView>;
  rename: (name: string, signal: AbortSignal) => Promise<void>;
  /** 가족에서 나간다. 서버가 보낸·받은 요청과 공유 설정을 지우고 폰은 비밀값을 버린다. */
  leave: (signal: AbortSignal) => Promise<void>;
  /** 내 도착 예정을 가족 한 사람에게 보여 줄지(기본 꺼짐). */
  setShare: (memberId: string, enabled: boolean, signal: AbortSignal) => Promise<void>;
  /** 보낸 요청과 받은 요청. 식별이 없으면 비어 있다. */
  fetchRequests: (signal: AbortSignal) => Promise<RequestLists>;
  createRequest: (body: CreateRequestBody, signal: AbortSignal) => Promise<SentRequest>;
};

export function createFamilyGroupApi({
  client = familyClient,
  member = memberSession,
  phone = phoneSession,
}: { client?: FamilyClient; member?: MemberSession; phone?: Pick<Session, 'getToken'> } = {}): FamilyGroupApi {
  // 폰 토큰을 읽지 못해도(저장소 오류) 서버에 묻지 않을 뿐 던지지 않는다.
  const hasIdentity = async () => {
    if (await member.get()) return true;
    return Boolean(await Promise.resolve().then(() => phone.getToken()).catch(() => null));
  };
  const init = (signal: AbortSignal) => ({ init: { signal } });
  const keep = async (token: string | null) => {
    if (token) await member.set(token);
  };
  /**
   * 이 폰이 가족에 속하는가(마지막으로 안 것). `GET /family`·만들기·참여·나가기가 정하고 모르면 null이다.
   * 거짓이면 `fetchRequests`는 서버에 묻지 않고 빈 목록을 돌려준다(가족이 없으면 보낸·받은 요청이 있을 수 없다). 폰 토큰으로 묶인 자리가 가족에 속할 수 있어서
   * (폰 바꾸기 뒤 새 폰은 비밀값 없이 폰 토큰만으로 같은 구성원) 알 수 없을 때는 먼저 `GET /family`로 확인한다. 비밀값이 지워지면(나가기·모르는 구성원) 거짓이다.
   */
  let inFamily: boolean | null = null;
  member.subscribe((event) => {
    if (event.type === 'cleared') inFamily = false;
  });
  const empty = (): RequestLists => ({ sent: [], received: [], family: false });

  const api: FamilyGroupApi = {
    fetchFamily: async (signal) => {
      if (!(await hasIdentity())) return null;
      const res = await client.family.$get(undefined, init(signal));
      const status: number = res.status;
      // 식별이 없거나 서버가 모르는 구성원(나감·정리됨): 가족이 없는 상태다.
      if (status === 401) {
        inFamily = false;
        return null;
      }
      if (!res.ok) return fail(res, 'GET /family');
      const family = (await res.json()).family;
      inFamily = family !== null;
      return family;
    },
    invite: async (name, signal) => {
      const trimmed = name?.trim();
      const res = await client.family.invite.$post({ json: trimmed ? { name: trimmed } : {} }, init(signal));
      if (!res.ok) return fail(res, 'POST /family/invite');
      const body = await res.json();
      // 비밀값은 이 응답에만 있다. 화면을 바꾸기 전에 먼저 저장한다.
      await keep(body.memberToken);
      inFamily = true;
      return body.family;
    },
    join: async (code, name, signal) => {
      const trimmed = name?.trim();
      const res = await client.family.join.$post({ json: trimmed ? { code, name: trimmed } : { code } }, init(signal));
      if (!res.ok) return fail(res, 'POST /family/join');
      const body = await res.json();
      await keep(body.memberToken);
      inFamily = true;
      return body.family;
    },
    rename: async (name, signal) => {
      const res = await client.family.me.$put({ json: { name } }, init(signal));
      if (!res.ok) await fail(res, 'PUT /family/me');
    },
    leave: async (signal) => {
      const res = await client.family.me.$delete(undefined, init(signal));
      const status: number = res.status;
      // 404(이미 가족이 아님)·401(서버가 모르는 구성원)도 나간 것과 같다.
      if (status !== 200 && status !== 404 && status !== 401) return fail(res, 'DELETE /family/me');
      await member.clear('left');
      inFamily = false;
    },
    setShare: async (memberId, enabled, signal) => {
      const res = await client.family.share.$put({ json: { memberId, enabled } }, init(signal));
      if (!res.ok) await fail(res, 'PUT /family/share');
    },
    fetchRequests: async (signal) => {
      // 식별이 없으면 가족일 수 없다(알아낸 것으로 기억하지는 않는다: 나중에 폰 토큰이 생기면 다시 확인해야 한다).
      if (!(await hasIdentity())) return empty();
      // 가족에 속하는지 모르면 먼저 확인하고, 속하지 않으면 요청을 묻지 않는다.
      if (inFamily === null) await api.fetchFamily(signal);
      if (inFamily === false) return empty();
      const res = await client.requests.$get({ query: { date: undefined } }, init(signal));
      const status: number = res.status;
      if (status === 401) return empty();
      if (!res.ok) return fail(res, 'GET /requests');
      const body = (await res.json()) as { sent?: unknown; received?: unknown };
      return { sent: normalizeRequests(body.sent), received: normalizeRequests(body.received), family: true };
    },
    createRequest: async (body, signal) => {
      // 서버 타입은 검증을 거친 모양(`{ fields, recipient, … }`)을 입력으로 추론하지만 실제로 받는 것은 평평한 본문이라 형변환한다(docs/family-requests.md).
      const res = await client.requests.$post({ json: body as never }, init(signal));
      if (!res.ok) return fail(res, 'POST /requests');
      const created = normalizeRequest(((await res.json()) as { request?: unknown }).request);
      if (created === null) throw new HttpError(502, 'POST /requests 응답을 읽을 수 없어요');
      return created;
    },
  };
  return api;
}

export const familyGroupApi: FamilyGroupApi = createFamilyGroupApi();
