import { FAMILY } from '../../../__tests__/support/familySupport';
import { createFamilyClient } from '../familyClient';
import { createFamilyGroupApi, FamilyHttpError } from '../familyGroupApi';
import { createMemberSession, type MemberEvent, type MemberStorage } from '../memberSecret';

const SECRET = 'm'.repeat(64);
const NEW_SECRET = 'n'.repeat(64);
const signal = new AbortController().signal;

const memory = (initial: string | null = null): MemberStorage & { value: () => string | null } => {
  let value = initial;
  return { read: async () => value, write: async (t) => void (value = t), remove: async () => void (value = null), value: () => value };
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

type Sent = { url: string; method: string; body: unknown };
const setup = ({ secret = SECRET as string | null, token = null as string | null } = {}, ...responses: Response[]) => {
  const storage = memory(secret);
  const member = createMemberSession(storage);
  const phone = { getToken: async () => token, clearIfCurrent: async () => undefined };
  const sent: Sent[] = [];
  const queue = [...responses];
  const client = createFamilyClient({
    url: 'http://server.test', member, phone,
    fetch: async (input, init) => {
      sent.push({ url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const next = queue.shift();
      if (!next) throw new Error('예상하지 못한 요청');
      return next;
    },
  });
  const events: MemberEvent[] = [];
  member.subscribe((e) => events.push(e));
  return { api: createFamilyGroupApi({ client, member, phone }), member, storage, sent, events };
};

describe('가족 조회', () => {
  it('저장한 비밀값도 폰 토큰도 없으면 서버에 묻지 않고 가족이 없다고 본다', async () => {
    const { api, sent } = setup({ secret: null });
    expect(await api.fetchFamily(signal)).toBeNull();
    expect(await api.fetchRequests(signal)).toEqual({ sent: [], received: [], family: false });
    expect(sent).toHaveLength(0);
  });

  it('폰 토큰만 있어도(차에 연결한 폰) 서버에 묻는다', async () => {
    const { api, sent } = setup({ secret: null, token: 'p'.repeat(64) }, json(200, { family: null }));
    expect(await api.fetchFamily(signal)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('200이면 가족을, 401(식별 없음·모르는 구성원)이면 null을 돌려준다', async () => {
    expect(await setup({}, json(200, { family: FAMILY })).api.fetchFamily(signal)).toEqual(FAMILY);
    const gone = setup({}, json(401, { reason: 'unknown-member' }));
    expect(await gone.api.fetchFamily(signal)).toBeNull();
    expect(await gone.member.get()).toBeNull();
  });

  it('그 밖의 오류는 이유와 함께 던진다', async () => {
    const { api } = setup({}, json(500, { error: 'boom' }));
    await expect(api.fetchFamily(signal)).rejects.toMatchObject({ name: 'FamilyHttpError', status: 500 });
  });
});

describe('가족 만들기·참여(구성원 비밀값 저장)', () => {
  it('가족을 만들면 응답의 memberToken을 저장하고 이름은 있을 때만 보낸다', async () => {
    const { api, storage, sent, events } = setup({ secret: null }, json(200, { code: 'ABCD-EFGH', created: true, memberToken: NEW_SECRET, family: FAMILY }));
    expect(await api.invite('  아빠  ', signal)).toEqual(FAMILY);
    expect(sent[0]).toMatchObject({ url: 'http://server.test/family/invite', method: 'POST', body: { name: '아빠' } });
    expect(storage.value()).toBe(NEW_SECRET);
    expect(events).toEqual([{ type: 'set', persisted: true }]);
  });

  it('이름을 비우면 name 없이 보낸다. 이미 구성원이라 memberToken이 null이면 기존 비밀값을 그대로 둔다', async () => {
    const { api, storage, sent } = setup({}, json(200, { code: 'WXYZ-2345', created: false, memberToken: null, family: FAMILY }));
    await api.invite('   ', signal);
    expect(sent[0]!.body).toEqual({});
    expect(storage.value()).toBe(SECRET);
  });

  it('참여하면 새 구성원 비밀값을 저장한다', async () => {
    const { api, storage, sent } = setup({ secret: null }, json(200, { memberToken: NEW_SECRET, family: FAMILY }));
    await api.join('abcd-efgh', '엄마', signal);
    expect(sent[0]).toMatchObject({ url: 'http://server.test/family/join', body: { code: 'abcd-efgh', name: '엄마' } });
    expect(storage.value()).toBe(NEW_SECRET);
  });

  it('참여가 거절되면 이유(reason)와 기다릴 시간을 담아 던지고 비밀값은 만들지 않는다', async () => {
    const { api, storage } = setup({ secret: null }, json(429, { error: '많이 틀림', reason: 'locked', retryAfterSeconds: 30 }, { 'retry-after': '30' }));
    const error = await api.join('ZZZZ-ZZZZ', undefined, signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FamilyHttpError);
    expect(error).toMatchObject({ status: 429, reason: 'locked', retryAfterSeconds: 30, serverMessage: '많이 틀림' });
    expect(storage.value()).toBeNull();
  });
});

describe('이름·공유·나가기', () => {
  it('이름 바꾸기와 도착 예정 공유를 서버에 보낸다', async () => {
    const { api, sent } = setup({}, json(200, { me: { memberId: 'me1', name: '아빠 2' } }), json(200, { memberId: 'mom1', enabled: true }));
    await api.rename('아빠 2', signal);
    await api.setShare('mom1', true, signal);
    expect(sent[0]).toMatchObject({ url: 'http://server.test/family/me', method: 'PUT', body: { name: '아빠 2' } });
    expect(sent[1]).toMatchObject({ url: 'http://server.test/family/share', method: 'PUT', body: { memberId: 'mom1', enabled: true } });
  });

  it.each([[200, { left: true }], [404, { reason: 'not-in-family' }], [401, { reason: 'unauthorized' }]])('가족 나가기(%s)는 저장한 비밀값을 지우고 나갔다고 알린다', async (status, body) => {
    const { api, member, events } = setup({}, json(status, body));
    await api.leave(signal);
    expect(await member.get()).toBeNull();
    expect(events).toContainEqual({ type: 'cleared', reason: status === 401 ? expect.anything() : 'left' });
  });

  it('나가기가 서버 오류로 실패하면 비밀값을 지우지 않는다(나가지 못한 것)', async () => {
    const { api, member } = setup({}, json(500, { error: 'boom' }));
    await expect(api.leave(signal)).rejects.toMatchObject({ status: 500 });
    expect(await member.get()).toBe(SECRET);
  });
});

describe('요청', () => {
  const raw = (extra: Record<string, unknown>) => ({
    id: 'r1', memo: null, date: '2026-11-06', status: 'sent', createdAt: '2026-11-06T00:10:00.000Z', from: { memberId: 'me1', name: '아빠' },
    to: { kind: 'member', memberId: 'mom1', name: '엄마' }, reachable: true, drivingNow: false, etaStage: null, ...extra,
  });

  it('보낸·받은 요청을 화면 모델로 읽고 모양이 깨진 줄은 버린다. 401이면 비어 있다', async () => {
    const { api } = setup({}, json(200, { family: FAMILY }), json(200, { sent: [raw({ category: 'care', item: '우산', timing: 'take-along' }), { broken: true }], received: [], serverTime: 'x' }), json(401, { reason: 'unauthorized' }));
    expect(await api.fetchRequests(signal)).toMatchObject({ sent: [{ id: 'r1', category: 'care', item: '우산' }], received: [], family: true });
    expect(await api.fetchRequests(signal)).toEqual({ sent: [], received: [], family: false });
  });

  it('가족에 속하는지 모르면 먼저 GET /family로 확인하고, 속하지 않으면 GET /requests를 묻지 않는다(그 뒤로는 네트워크도 쓰지 않는다)', async () => {
    const { api, sent } = setup({}, json(200, { family: null }));
    expect(await api.fetchRequests(signal)).toEqual({ sent: [], received: [], family: false });
    expect(sent.map((r) => r.url)).toEqual(['http://server.test/family']);
    expect(await api.fetchRequests(signal)).toEqual({ sent: [], received: [], family: false });
    expect(sent).toHaveLength(1);
  });

  it('폰 토큰만 있어도(폰 바꾸기 뒤 새 폰) 가족에 속할 수 있으니 확인해서 속하면 요청을 읽는다', async () => {
    const { api, sent } = setup({ secret: null, token: 'p'.repeat(64) }, json(200, { family: FAMILY }), json(200, { sent: [], received: [], serverTime: 'x' }));
    expect(await api.fetchRequests(signal)).toEqual({ sent: [], received: [], family: true });
    expect(sent.map((r) => r.url)).toEqual(['http://server.test/family', 'http://server.test/requests']);
  });

  it('가족을 만들면 요청을 바로 읽고, 나가면(또는 서버가 모르는 구성원이 되면) 다시 묻지 않는다', async () => {
    const created = setup({ secret: null }, json(200, { code: 'ABCD-EFGH', created: true, memberToken: NEW_SECRET, family: FAMILY }), json(200, { sent: [], received: [], serverTime: 'x' }), json(200, { left: true }));
    await created.api.invite('아빠', signal);
    expect(await created.api.fetchRequests(signal)).toMatchObject({ family: true });
    await created.api.leave(signal);
    expect(await created.api.fetchRequests(signal)).toEqual({ sent: [], received: [], family: false });
    expect(created.sent.map((r) => r.method + ' ' + r.url.replace('http://server.test', ''))).toEqual(['POST /family/invite', 'GET /requests', 'DELETE /family/me']);

    // 다른 곳에서 정리돼 요청 층이 비밀값을 지우면(gone) 요청을 묻지 않는다
    const gone = setup({}, json(200, { family: FAMILY }), json(401, { reason: 'unknown-member' }));
    await gone.api.fetchFamily(signal);
    await gone.api.fetchFamily(signal);
    expect(await gone.api.fetchRequests(signal)).toEqual({ sent: [], received: [], family: false });
    expect(gone.sent).toHaveLength(2);
  });

  it('요청 만들기는 평평한 본문을 그대로 보내고 응답을 화면 모델로 돌려준다', async () => {
    const body = { category: 'care', recipient: { memberId: 'mom1' }, item: '우산', timing: 'take-along', date: '2026-11-06' } as const;
    const { api, sent } = setup({}, json(200, { request: raw({ category: 'care', item: '우산', timing: 'take-along' }) }));
    expect(await api.createRequest(body, signal)).toMatchObject({ id: 'r1', category: 'care' });
    expect(sent[0]).toMatchObject({ url: 'http://server.test/requests', method: 'POST', body });
  });

  it('거절 이유를 담아 던진다(400 bad-request·429 too-many-requests)', async () => {
    const { api } = setup({}, json(400, { error: '이미 지난 시각입니다', reason: 'bad-request' }), json(429, { reason: 'too-many-requests' }));
    await expect(api.createRequest({ category: 'care', recipient: { memberId: 'x' } }, signal)).rejects.toMatchObject({ status: 400, reason: 'bad-request', serverMessage: '이미 지난 시각입니다' });
    await expect(api.createRequest({ category: 'care', recipient: { memberId: 'x' } }, signal)).rejects.toMatchObject({ status: 429, reason: 'too-many-requests' });
  });

  it('응답을 읽을 수 없으면 오류로 본다', async () => {
    const { api } = setup({}, json(200, { request: { id: 1 } }));
    await expect(api.createRequest({ category: 'care', recipient: { memberId: 'x' } }, signal)).rejects.toMatchObject({ status: 502 });
  });
});
