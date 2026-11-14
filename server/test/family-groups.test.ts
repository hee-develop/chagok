import { describe, expect, it } from 'vitest';
import { FAMILY_INVITE_TTL_MS, MAX_FAMILY_CREATES_PER_SOURCE, MAX_FAMILY_MEMBERS, DEVICE_MEMBER_TTL_MS } from '../src/family/limits.js';
import { INVITE_ALPHABET, normalizeInviteCode } from '../src/family/groups.js';
import { MAX_FAILURES } from '../src/seats.js';
import { as, call, connect, careBody, dev, fresh, DAY, type Fresh } from './familyHelpers.js';

/** 연결 전 폰(기기 id만)이 가족을 만들고 코드를 받는다. */
const makeFamily = async (t: Fresh, device = dev('mom'), name = '엄마') => {
  const res = await call(t, 'POST', '/family/invite', { device, body: { name } });
  expect(res.status).toBe(200);
  return res.body as { code: string; expiresAt: string; expiresInSeconds: number; created: boolean; family: any };
};
const join = (t: Fresh, device: string, code: string, name?: string, ip?: string) =>
  call(t, 'POST', '/family/join', { device, body: name === undefined ? { code } : { code, name }, ip });
const view = async (t: Fresh, who: { phoneToken?: string; device?: string }) => (await call(t, 'GET', '/family', as(who))).body.family;

describe('POST /family/invite', () => {
  it('가족이 없으면 가족을 만들고 부른 사람이 첫 구성원이 된다(기기 id만으로도)', async () => {
    const t = fresh();
    const res = await makeFamily(t);
    expect(res.created).toBe(true);
    expect(res.code).toMatch(new RegExp(`^[${INVITE_ALPHABET}]{4}-[${INVITE_ALPHABET}]{4}$`));
    expect(res.expiresInSeconds).toBe(FAMILY_INVITE_TTL_MS / 1000);
    expect(res.expiresAt).toBe(new Date(t.clock.ms + FAMILY_INVITE_TTL_MS).toISOString());
    expect(res.family.members).toEqual([
      { memberId: expect.any(String), name: '엄마', isMe: true, connected: false, shareWithThem: false, sharesWithMe: false },
    ]);
    expect(res.family.maxMembers).toBe(MAX_FAMILY_MEMBERS);
    expect(res.family.invite.code).toBe(res.code);
  });

  it('이미 가족이면 새 코드로 바꾸고 이전 코드는 쓸 수 없다', async () => {
    const t = fresh();
    const first = await makeFamily(t);
    const second = await call(t, 'POST', '/family/invite', { device: dev('mom'), body: {} });
    expect(second.body.created).toBe(false);
    expect(second.body.code).not.toBe(first.code);
    expect((await join(t, dev('dad'), first.code)).status).toBe(404);
    expect((await join(t, dev('dad'), second.body.code)).status).toBe(200);
  });

  it('이름은 선택이고 비면 기본 이름, 한 가족 안에서 겹치면 번호를 붙인다', async () => {
    const t = fresh();
    const { code } = await call(t, 'POST', '/family/invite', { device: dev('a'), body: {} }).then((r) => r.body);
    await join(t, dev('b'), code, '  가족  ');
    await join(t, dev('c'), code, '가족');
    const f = await view(t, { device: dev('a') });
    expect(f.members.map((m: any) => m.name)).toEqual(['가족', '가족 2', '가족 3']);
    expect((await call(t, 'POST', '/family/invite', { device: dev('z'), body: { name: 'x'.repeat(101) } })).status).toBe(400);
    expect((await call(t, 'POST', '/family/invite', { device: dev('z'), body: { nick: '엄마' } })).status).toBe(400);
    expect((await call(t, 'POST', '/family/invite', { device: dev('z'), body: { name: 3 } })).status).toBe(400);
  });

  it('인원이 가득 차면 새 코드를 만들 수 없다(409 family-full)', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    for (let i = 1; i < MAX_FAMILY_MEMBERS; i++) expect((await join(t, dev(`m${i}`), code)).status).toBe(200);
    const res = await call(t, 'POST', '/family/invite', { device: dev('mom'), body: {} });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('family-full');
  });

  it('한 요청 주소가 짧은 시간에 가족을 너무 많이 만들면 429(기기 id를 바꿔도 주소로 막는다)', async () => {
    const t = fresh();
    for (let i = 0; i < MAX_FAMILY_CREATES_PER_SOURCE; i++) {
      expect((await call(t, 'POST', '/family/invite', { device: dev(`f${i}`), body: {}, ip: '9.9.9.9' })).status).toBe(200);
    }
    const blocked = await call(t, 'POST', '/family/invite', { device: dev('fx'), body: {}, ip: '9.9.9.9' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('rate-limited');
    expect((await call(t, 'POST', '/family/invite', { device: dev('fy'), body: {}, ip: '8.8.8.8' })).status).toBe(200);
    t.clock.ms += 10 * 60_000;
    expect((await call(t, 'POST', '/family/invite', { device: dev('fz'), body: {}, ip: '9.9.9.9' })).status).toBe(200);
  });
});

describe('POST /family/join', () => {
  it('코드로 참여한다(대소문자·공백·하이픈 무시). 참여자는 같은 가족을 본다', async () => {
    const t = fresh();
    const { code, family } = await makeFamily(t);
    const sloppy = code.replace('-', ' ').toLowerCase();
    const joined = await join(t, dev('dad'), sloppy, '아빠');
    expect(joined.status).toBe(200);
    expect(joined.body.family.familyId).toBe(family.familyId);
    expect(joined.body.family.members.map((m: any) => [m.name, m.isMe])).toEqual([['엄마', false], ['아빠', true]]);
    const mom = await view(t, { device: dev('mom') });
    expect(mom.members.map((m: any) => m.name)).toEqual(['엄마', '아빠']);
    expect(normalizeInviteCode('ab cd-efgh')).toBe('ABCDEFGH');
    expect(normalizeInviteCode('AB1D-EFGH')).toBeNull(); // 헷갈리는 글자(0·1·I·L·O)는 코드에 없다
  });

  it('코드는 24시간 뒤에 만료된다(직전까지는 쓸 수 있다)', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    t.clock.ms += FAMILY_INVITE_TTL_MS - 1;
    expect((await join(t, dev('a'), code)).status).toBe(200);
    t.clock.ms += 1;
    const late = await join(t, dev('b'), code);
    expect(late.status).toBe(404);
    expect(late.body.reason).toBe('invalid');
    expect((await view(t, { device: dev('mom') })).invite).toBeNull();
  });

  it('없는 코드와 모양이 틀린 코드는 같은 404이고 본문 오류는 400이다', async () => {
    const t = fresh();
    await makeFamily(t);
    expect((await join(t, dev('a'), 'AAAA-BBBB')).status).toBe(404);
    expect((await join(t, dev('a'), '12')).status).toBe(404);
    expect((await call(t, 'POST', '/family/join', { device: dev('a'), body: {} })).status).toBe(400);
    expect((await call(t, 'POST', '/family/join', { device: dev('a'), body: { code: 5 } })).status).toBe(400);
    expect((await call(t, 'POST', '/family/join', { device: dev('a'), body: { code: 'AAAA-BBBB', extra: 1 } })).status).toBe(400);
  });

  it('인원 한도: 한도까지 들어오고 다음 사람은 409 family-full', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    for (let i = 1; i < MAX_FAMILY_MEMBERS; i++) expect((await join(t, dev(`m${i}`), code)).status).toBe(200);
    const res = await join(t, dev('late'), code);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('family-full');
    expect((await view(t, { device: dev('mom') })).members).toHaveLength(MAX_FAMILY_MEMBERS);
  });

  it('중복 참여: 같은 가족에 다시도, 다른 가족 코드로도 409 already-in-family', async () => {
    const t = fresh();
    const a = await makeFamily(t, dev('mom'), '엄마');
    const b = await makeFamily(t, dev('uncle'), '삼촌');
    expect((await join(t, dev('dad'), a.code)).status).toBe(200);
    for (const code of [a.code, b.code]) {
      const again = await join(t, dev('dad'), code);
      expect(again.status).toBe(409);
      expect(again.body.reason).toBe('already-in-family');
    }
    // 가족을 만든 사람이 자기 가족 코드를 다시 넣는 것도 마찬가지
    expect((await join(t, dev('mom'), a.code)).status).toBe(409);
    expect((await view(t, { device: dev('mom') })).members).toHaveLength(2);
  });

  it('시도 제한: 틀린 코드 5번이면 그 주소를 잠그고(맞는 코드도 막음) 60초 뒤에 풀린다. 다른 주소는 영향 없다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    for (let i = 0; i < MAX_FAILURES; i++) expect((await join(t, dev('x'), 'AAAA-BBBB', undefined, '1.1.1.1')).status).toBe(404);
    const locked = await join(t, dev('x'), code, undefined, '1.1.1.1');
    expect(locked.status).toBe(429);
    expect(locked.body.reason).toBe('locked');
    expect(locked.headers.get('retry-after')).toBe(String(locked.body.retryAfterSeconds));
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect((await join(t, dev('y'), code, undefined, '2.2.2.2')).status).toBe(200);
    t.clock.ms += 60_000;
    expect((await join(t, dev('z'), code, undefined, '1.1.1.1')).status).toBe(200);
  });

  it('맞는 코드는 그 주소의 실패 횟수를 지운다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < MAX_FAILURES - 1; i++) await join(t, dev(`w${round}`), 'AAAA-BBBB', undefined, '3.3.3.3');
      expect((await join(t, dev(`ok${round}`), code, undefined, '3.3.3.3')).status).toBe(200);
    }
  });
});

describe('가족 조회·이름·공유', () => {
  it('가족이 없으면 family: null', async () => {
    const t = fresh();
    expect((await call(t, 'GET', '/family', { device: dev('solo') })).body).toEqual({ family: null });
  });

  it('구성원에는 폰 토큰·자리 id·기기 id가 나오지 않고, 차 연결 여부와 우리 차 목록만 나온다', async () => {
    const t = fresh();
    const mom = { ...(await connect(t, '엄마폰', { device: dev('mom') })), device: dev('mom') };
    const { code } = await call(t, 'POST', '/family/invite', { ...as(mom), body: { name: '엄마' } }).then((r) => r.body);
    await join(t, dev('dad'), code, '아빠');
    const f = await view(t, as(mom));
    const text = JSON.stringify(f);
    for (const secret of [mom.phoneToken, mom.seatId, mom.carToken, dev('mom'), dev('dad')]) expect(text).not.toContain(secret);
    expect(f.members.map((m: any) => [m.name, m.connected])).toEqual([['엄마', true], ['아빠', false]]);
    expect(f.cars).toEqual([{ carRef: expect.stringMatching(/^car-/), memberIds: [f.me.memberId] }]);
    expect(text).not.toContain(mom.carId);
  });

  it('PUT /family/me로 부르는 이름을 바꾼다(겹치면 번호)', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    await join(t, dev('dad'), code, '아빠');
    const res = await call(t, 'PUT', '/family/me', { device: dev('dad'), body: { name: '엄마' } });
    expect(res.body.me.name).toBe('엄마 2');
    expect((await call(t, 'PUT', '/family/me', { device: dev('dad'), body: {} })).status).toBe(400);
    expect((await call(t, 'PUT', '/family/me', { device: dev('nobody'), body: { name: 'x' } })).status).toBe(404);
  });

  it('PUT /family/share: 가족 한 사람마다 켜고 끈다(기본 꺼짐). 내 설정은 상대 화면의 sharesWithMe로 보인다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    await join(t, dev('dad'), code, '아빠');
    const mom = await view(t, { device: dev('mom') });
    const dad = mom.members.find((m: any) => m.name === '아빠');
    expect(dad.shareWithThem).toBe(false);
    const on = await call(t, 'PUT', '/family/share', { device: dev('mom'), body: { memberId: dad.memberId, enabled: true } });
    expect(on.body).toEqual({ memberId: dad.memberId, enabled: true });
    expect((await view(t, { device: dev('mom') })).members.find((m: any) => m.name === '아빠').shareWithThem).toBe(true);
    expect((await view(t, { device: dev('dad') })).members.find((m: any) => m.name === '엄마').sharesWithMe).toBe(true);
    expect((await view(t, { device: dev('dad') })).members.find((m: any) => m.name === '엄마').shareWithThem).toBe(false);
    await call(t, 'PUT', '/family/share', { device: dev('mom'), body: { memberId: dad.memberId, enabled: false } });
    expect((await view(t, { device: dev('dad') })).members.find((m: any) => m.name === '엄마').sharesWithMe).toBe(false);
  });

  it('공유 대상 검증: 자기 자신 400, 다른 가족·없는 구성원 404, 가족 없음 404, 본문 오류 400', async () => {
    const t = fresh();
    const a = await makeFamily(t, dev('mom'), '엄마');
    const b = await makeFamily(t, dev('uncle'), '삼촌');
    const mom = a.family.members[0].memberId as string;
    const uncle = b.family.members[0].memberId as string;
    const put = (device: string, body: unknown) => call(t, 'PUT', '/family/share', { device, body });
    expect((await put(dev('mom'), { memberId: mom, enabled: true })).status).toBe(400);
    expect((await put(dev('mom'), { memberId: uncle, enabled: true })).status).toBe(404);
    expect((await put(dev('mom'), { memberId: 'nope', enabled: true })).status).toBe(404);
    expect((await put(dev('stranger'), { memberId: mom, enabled: true })).body.reason).toBe('not-in-family');
    expect((await put(dev('mom'), { memberId: uncle })).status).toBe(400);
    expect((await put(dev('mom'), { memberId: uncle, enabled: 'yes' })).status).toBe(400);
  });
});

describe('가족 나가기 (DELETE /family/me)', () => {
  const trio = async (t: Fresh) => {
    const { code } = await makeFamily(t);
    await join(t, dev('dad'), code, '아빠');
    await join(t, dev('kid'), code, '아들');
    const f = await view(t, { device: dev('mom') });
    const id = (name: string) => f.members.find((m: any) => m.name === name).memberId as string;
    return { mom: id('엄마'), dad: id('아빠'), kid: id('아들') };
  };
  const send = (t: Fresh, device: string, to: string) => call(t, 'POST', '/requests', { device, body: careBody({ memberId: to }) });

  it('그 사람이 보낸·받은 요청과 공유 설정이 지워지고 다른 사람의 요청은 남는다', async () => {
    const t = fresh();
    const ids = await trio(t);
    await send(t, dev('dad'), ids.mom); // 아빠 → 엄마
    await send(t, dev('mom'), ids.dad); // 엄마 → 아빠
    await send(t, dev('mom'), ids.kid); // 엄마 → 아들(남아야 함)
    await send(t, dev('kid'), ids.mom); // 아들 → 엄마(남아야 함)
    await call(t, 'PUT', '/family/share', { device: dev('dad'), body: { memberId: ids.mom, enabled: true } });
    await call(t, 'PUT', '/family/share', { device: dev('mom'), body: { memberId: ids.dad, enabled: true } });
    await call(t, 'PUT', '/family/share', { device: dev('mom'), body: { memberId: ids.kid, enabled: true } });
    expect(t.familyRequests.storedRequests()).toBe(4);

    const left = await call(t, 'DELETE', '/family/me', { device: dev('dad') });
    expect(left.body).toEqual({ left: true });
    expect(t.familyRequests.storedRequests()).toBe(2);
    const mom = (await call(t, 'GET', '/requests', { device: dev('mom') })).body;
    expect(mom.sent.map((r: any) => r.to.name)).toEqual(['아들']);
    expect(mom.received.map((r: any) => r.from.name)).toEqual(['아들']);
    const f = await view(t, { device: dev('mom') });
    expect(f.members.map((m: any) => m.name)).toEqual(['엄마', '아들']);
    expect(f.members.find((m: any) => m.name === '아들').shareWithThem).toBe(true); // 다른 사람과의 공유는 남는다
    // 나간 사람은 더는 가족이 아니고, 같은 기기로 다시 들어오면 새 구성원(공유 설정도 기본 꺼짐)이다
    expect((await call(t, 'GET', '/family', { device: dev('dad') })).body).toEqual({ family: null });
    const { code } = (await call(t, 'POST', '/family/invite', { device: dev('mom'), body: {} })).body;
    await join(t, dev('dad'), code, '아빠');
    const again = await view(t, { device: dev('mom') });
    expect(again.members.find((m: any) => m.name === '아빠').shareWithThem).toBe(false);
    expect(again.members.find((m: any) => m.name === '아빠').sharesWithMe).toBe(false);
  });

  it('나간 사람의 옛 요청 id는 더는 보이지 않고, 가족이 아니면 404', async () => {
    const t = fresh();
    const ids = await trio(t);
    await send(t, dev('dad'), ids.mom);
    await call(t, 'DELETE', '/family/me', { device: dev('dad') });
    expect((await call(t, 'DELETE', '/family/me', { device: dev('dad') })).status).toBe(404);
    expect((await call(t, 'GET', '/requests', { device: dev('dad') })).body).toMatchObject({ sent: [], received: [] });
    expect((await send(t, dev('dad'), ids.mom)).status).toBe(409);
  });

  it('마지막 구성원이 나가면 가족과 초대 코드가 사라진다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    await call(t, 'DELETE', '/family/me', { device: dev('mom') });
    expect(t.familyRequests.familyView({ keys: ['d:' + dev('mom')] })).toBeNull();
    expect((await join(t, dev('dad'), code)).status).toBe(404);
  });
});

describe('구성원 식별: 폰·자리·기기 id', () => {
  it('연결 전 폰(기기 id)이 가족에 든 뒤 차에 연결해도 같은 구성원으로 이어진다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    const before = await view(t, { device: dev('mom') });
    const mom = { ...(await connect(t, '엄마폰', { device: dev('mom') })), device: dev('mom') };
    const after = await view(t, { phoneToken: mom.phoneToken }); // 토큰만(기기 id 없이)으로도 같은 구성원
    expect(after.me.memberId).toBe(before.me.memberId);
    expect(after.members[0].connected).toBe(true);
    expect(after.familyId).toBe(before.familyId);
    expect((await join(t, dev('dad'), code)).status).toBe(200);
  });

  it('차 연결을 끊어도(자리가 사라져도) 기기 id로 가족에 남는다', async () => {
    const t = fresh();
    await makeFamily(t);
    const mom = { ...(await connect(t, '엄마폰', { device: dev('mom') })), device: dev('mom') };
    expect((await call(t, 'DELETE', '/pair', as(mom))).status).toBe(200);
    // 옛 토큰은 401(폰이 토큰을 버리고 기기 id만으로 다시 보낸다)
    expect((await call(t, 'GET', '/family', { token: mom.phoneToken })).status).toBe(401);
    const f = await view(t, { device: dev('mom') });
    expect(f.members.map((m: any) => [m.name, m.connected])).toEqual([['엄마', false]]);
  });

  it('토큰으로만 가족에 든 폰(기기 id 없음)은 차 연결이 끊기면 식별할 방법이 없어 가족에서 나간다', async () => {
    const t = fresh();
    const mom = await connect(t, '엄마폰');
    const { code } = (await call(t, 'POST', '/family/invite', { token: mom.phoneToken, body: { name: '엄마' } })).body;
    const dad = await connect(t, '아빠폰', { carToken: mom.carToken });
    await call(t, 'POST', '/family/join', { token: dad.phoneToken, body: { code, name: '아빠' } });
    await call(t, 'POST', '/requests', { token: mom.phoneToken, body: careBody({ memberId: (await view(t, { phoneToken: dad.phoneToken })).members.find((m: any) => m.name === '아빠').memberId }) });
    expect(t.familyRequests.storedRequests()).toBe(1);
    await call(t, 'DELETE', '/pair', { token: dad.phoneToken });
    expect((await view(t, { phoneToken: mom.phoneToken })).members.map((m: any) => m.name)).toEqual(['엄마']);
    expect(t.familyRequests.storedRequests()).toBe(0);
  });

  it('폰 바꾸기: 자리의 구성원은 새 폰이 이어받고, 옛 폰의 기기 id는 더는 가족으로 보이지 않는다', async () => {
    const t = fresh();
    await makeFamily(t, dev('oldmom'));
    const mom = { ...(await connect(t, '엄마폰', { device: dev('oldmom') })), device: dev('oldmom') };
    const issued = await call(t, 'POST', '/pair/code', { token: mom.carToken, body: { mode: 'replace', seatId: mom.seatId } });
    const claimed = await call(t, 'POST', '/pair/claim', { body: { code: issued.body.code, name: '새 폰' }, device: dev('newmom') });
    expect(claimed.status).toBe(200);
    const fromNew = await view(t, { phoneToken: claimed.body.phoneToken, device: dev('newmom') });
    expect(fromNew.members.map((m: any) => m.name)).toEqual(['엄마']);
    expect((await call(t, 'GET', '/family', { token: mom.phoneToken })).status).toBe(401);
    expect((await call(t, 'GET', '/family', { device: dev('oldmom') })).body).toEqual({ family: null });
    // 새 폰이 연결을 끊어도 새 기기 id로 가족에 남는다
    await call(t, 'DELETE', '/pair', { token: claimed.body.phoneToken });
    expect((await view(t, { device: dev('newmom') })).members).toHaveLength(1);
  });

  it('식별 없는 요청·이상한 식별은 모든 가족 API에서 거절된다(옛 호환·기본 자리로 흐르지 않음)', async () => {
    const t = fresh();
    await makeFamily(t);
    await connect(t, '엄마폰', { device: dev('mom') }); // 자리 있는 차가 하나(옛 호환 읽기가 열려 있는 서버)
    const calls: [string, string, unknown?][] = [
      ['GET', '/family'], ['POST', '/family/invite', {}], ['POST', '/family/join', { code: 'AAAA-BBBB' }], ['PUT', '/family/me', { name: 'x' }],
      ['DELETE', '/family/me'], ['PUT', '/family/share', { memberId: 'x', enabled: true }], ['POST', '/requests', careBody({ memberId: 'x' })], ['GET', '/requests'],
    ];
    for (const [method, path, body] of calls) {
      expect((await call(t, method, path, { body })).status, `${method} ${path} 식별 없음`).toBe(401);
      expect((await call(t, method, path, { body, token: 'f'.repeat(64) })).status, `${method} ${path} 모르는 토큰`).toBe(401);
      expect((await call(t, method, path, { body, device: 'short' })).status, `${method} ${path} 이상한 기기 id`).toBe(400);
    }
  });

  it('차 토큰으로는 폰 API를 부를 수 없다(401)', async () => {
    const t = fresh();
    const mom = await connect(t, '엄마폰', { device: dev('mom') });
    expect((await call(t, 'GET', '/family', { token: mom.carToken })).status).toBe(401);
    expect((await call(t, 'POST', '/family/invite', { token: mom.carToken, body: {} })).status).toBe(401);
  });
});

describe('정기 작업(purge): 오래 쓰지 않은 기기 id 구성원', () => {
  it('차에 연결하지 않고 30일 쓰지 않은 구성원은 가족에서 내보내고, 연결된 구성원은 남긴다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t, dev('mom'));
    await join(t, dev('dad'), code, '아빠');
    const mom = { ...(await connect(t, '엄마폰', { device: dev('mom') })), device: dev('mom') };
    t.clock.ms += DEVICE_MEMBER_TTL_MS - 1;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(0);
    await call(t, 'GET', '/family', { device: dev('dad') }); // 쓰면 기한이 새로 시작한다
    t.clock.ms += DEVICE_MEMBER_TTL_MS - 1;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(0);
    t.clock.ms += 1;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(1);
    expect((await view(t, as(mom))).members.map((m: any) => m.name)).toEqual(['엄마']);
    t.clock.ms += 60 * DAY;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(0); // 자리가 있는 구성원은 자리와 함께 간다
  });
});

describe('옛 픽스처 가족은 그대로', () => {
  it('GET /family/members는 픽스처 가족을 주고, 새 가족과 섞이지 않는다', async () => {
    const t = fresh();
    await makeFamily(t);
    const res = await call(t, 'GET', '/family/members');
    expect(res.body).toEqual({ members: [{ id: 'family-mom', name: '엄마' }, { id: 'family-brother', name: '동생' }] });
    expect((await call(t, 'GET', '/family/requests')).body).toEqual({ requests: [] });
  });
});
