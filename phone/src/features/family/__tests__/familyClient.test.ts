import { createFamilyClient } from '../familyClient';
import { createMemberSession, type MemberStorage } from '../memberSecret';

const SECRET = 'm'.repeat(64);
const PHONE = 'p'.repeat(64);

const memory = (initial: string | null): MemberStorage => {
  let value = initial;
  return { read: async () => value, write: async (t) => void (value = t), remove: async () => void (value = null) };
};

/** 폰 토큰 저장소 가짜(`Session`의 일부). */
const phone = (initial: string | null) => {
  let token = initial;
  return {
    getToken: async () => token,
    clearIfCurrent: jest.fn(async (t: string) => { if (token === t) token = null; }),
    set: (t: string | null) => { token = t; },
    current: () => token,
  };
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Call = { url: string; member: string | null; bearer: string | null; device: string | null };
const setup = (responses: (Response | ((call: Call) => Response))[], { secret = SECRET as string | null, token = PHONE as string | null } = {}) => {
  const member = createMemberSession(memory(secret));
  const p = phone(token);
  const calls: Call[] = [];
  const fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    const call = { url: String(input), member: h.get('x-chagok-member'), bearer: h.get('authorization'), device: h.get('x-chagok-device') };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error('예상하지 못한 요청');
    return typeof next === 'function' ? next(call) : next;
  });
  const client = createFamilyClient({ url: 'http://server.test', member, phone: p, fetch });
  return { client, member, phone: p, calls, fetch };
};

describe('가족 요청 헤더', () => {
  it('구성원 비밀값은 X-Chagok-Member로, 폰 토큰이 있으면 Authorization으로 함께 보낸다(기기 id는 보내지 않는다)', async () => {
    const { client, calls } = setup([json(200, { family: null })]);
    await client.family.$get();
    expect(calls[0]).toMatchObject({ url: 'http://server.test/family', member: SECRET, bearer: `Bearer ${PHONE}`, device: null });
  });

  it('요청을 만들 때(/requests)도 같은 헤더를 보낸다', async () => {
    const { client, calls } = setup([json(200, { sent: [], received: [], serverTime: 'x' })]);
    await client.requests.$get({ query: { date: undefined } });
    expect(calls[0]).toMatchObject({ member: SECRET, bearer: `Bearer ${PHONE}` });
  });

  it('차에 연결하지 않았으면(폰 토큰 없음) 비밀값만, 비밀값도 없으면 아무 식별 헤더도 보내지 않는다', async () => {
    const onlySecret = setup([json(200, { family: null })], { token: null });
    await onlySecret.client.family.$get();
    expect(onlySecret.calls[0]).toMatchObject({ member: SECRET, bearer: null });
    const none = setup([json(200, { code: 'x' })], { secret: null, token: null });
    await none.client.family.invite.$post({ json: {} });
    expect(none.calls[0]).toMatchObject({ member: null, bearer: null, device: null });
  });
});

describe('401 처리', () => {
  it('401 unknown-member면 저장한 비밀값을 지우고 응답을 그대로 돌려준다. 폰 토큰은 건드리지 않고 다시 보내지도 않는다', async () => {
    const { client, member, phone: p, fetch } = setup([json(401, { error: '없는 구성원', reason: 'unknown-member' })]);
    const res = await client.family.$get();
    expect(res.status).toBe(401);
    expect(await member.get()).toBeNull();
    expect(p.clearIfCurrent).not.toHaveBeenCalled();
    expect(p.current()).toBe(PHONE);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('차 연결을 끊어 폰 토큰이 죽어도(401 unauthorized) 토큰만 버리고 비밀값으로 같은 요청을 한 번 다시 보낸다', async () => {
    const { client, member, phone: p, calls } = setup([json(401, { error: '끊김', reason: 'unauthorized' }), json(200, { family: null })]);
    const res = await client.family.$get();
    expect(res.status).toBe(200);
    expect(p.current()).toBeNull();
    expect(await member.get()).toBe(SECRET);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ member: SECRET, bearer: null });
  });

  it('본문이 있는 요청도 같은 본문으로 다시 보낸다(JSON 문자열 본문)', async () => {
    const bodies: string[] = [];
    const responses = [json(401, { reason: 'unauthorized' }), json(200, { me: { memberId: 'a', name: '아빠' } })];
    const client = createFamilyClient({
      url: 'http://server.test',
      member: createMemberSession(memory(SECRET)),
      phone: phone(PHONE),
      fetch: async (_input, init) => { bodies.push(String(init?.body)); return responses.shift()!; },
    });
    const res = await client.family.me.$put({ json: { name: '아빠' } });
    expect(res.status).toBe(200);
    expect(bodies).toEqual([JSON.stringify({ name: '아빠' }), JSON.stringify({ name: '아빠' })]);
  });

  it('폰 토큰이 걸러진 뒤 다시 보낸 요청이 비밀값 때문에 401이면 그 비밀값도 지운다', async () => {
    const { client, member, phone: p } = setup([json(401, { reason: 'unauthorized' }), json(401, { reason: 'unknown-member' })]);
    const res = await client.family.$get();
    expect(res.status).toBe(401);
    expect(p.current()).toBeNull();
    expect(await member.get()).toBeNull();
  });

  it('비밀값 없이 폰 토큰만 보내 401이면(토큰이 죽음) 토큰을 버리고 식별 없이 한 번 다시 보낸다', async () => {
    const { client, phone: p, calls } = setup([json(401, { reason: 'unauthorized' }), json(401, { reason: 'unauthorized' })], { secret: null });
    const res = await client.family.$get();
    expect(res.status).toBe(401);
    expect(p.current()).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ member: null, bearer: null });
  });

  it('401이 아닌 오류와 성공은 그대로 돌려주고 아무것도 지우지 않는다', async () => {
    const { client, member, phone: p } = setup([json(429, { reason: 'locked' }), json(409, { reason: 'already-in-family' })]);
    expect((await client.family.join.$post({ json: { code: 'AAAA-BBBB' } })).status).toBe(429);
    expect((await client.family.join.$post({ json: { code: 'AAAA-BBBB' } })).status).toBe(409);
    expect(await member.get()).toBe(SECRET);
    expect(p.current()).toBe(PHONE);
  });
});
