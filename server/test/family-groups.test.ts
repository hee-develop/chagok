import { describe, expect, it } from 'vitest';
import {
  FAMILY_CREATE_DAY_WINDOW_MS,
  FAMILY_CREATE_WINDOW_MS,
  FAMILY_INVITE_TTL_MS,
  MAX_FAMILY_CREATES_PER_SOURCE,
  MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY,
  MAX_FAMILY_MEMBERS,
  MEMBER_INACTIVE_TTL_MS,
} from '../src/family/limits.js';
import { INVITE_ALPHABET, normalizeInviteCode } from '../src/family/groups.js';
import { MAX_FAILURES } from '../src/seats.js';
import { as, call, connect, careBody, dev, fresh, DAY, HOUR, type Fresh } from './familyHelpers.js';

type Created = { code: string; expiresAt: string; expiresInSeconds: number; created: boolean; memberToken: string | null; family: any };

/** 가족을 만든다(식별 없이도 된다). 폰 토큰을 주면 그 자리가 만든 구성원에게 바로 묶인다. */
const makeFamily = async (t: Fresh, name = '엄마', o: { phoneToken?: string; ip?: string } = {}) => {
  const res = await call(t, 'POST', '/family/invite', { token: o.phoneToken, ip: o.ip, body: { name } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Created;
};
const join = (t: Fresh, code: string, o: { name?: string; ip?: string; memberToken?: string; phoneToken?: string } = {}) =>
  call(t, 'POST', '/family/join', { ...as(o), ip: o.ip, body: o.name === undefined ? { code } : { code, name: o.name } });
/** 코드로 참여한 새 구성원의 비밀값. */
const joined = async (t: Fresh, code: string, name?: string) => {
  const res = await join(t, code, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.memberToken as string;
};
const view = async (t: Fresh, who: { phoneToken?: string; memberToken?: string }) => (await call(t, 'GET', '/family', as(who))).body.family;

describe('POST /family/invite', () => {
  it('식별 없이 부르면 가족을 만들고 부른 사람이 첫 구성원이 되며 구성원 비밀값을 한 번 받는다', async () => {
    const t = fresh();
    const res = await makeFamily(t);
    expect(res.created).toBe(true);
    expect(res.memberToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.code).toMatch(new RegExp(`^[${INVITE_ALPHABET}]{4}-[${INVITE_ALPHABET}]{4}$`));
    expect(res.expiresInSeconds).toBe(FAMILY_INVITE_TTL_MS / 1000);
    expect(res.expiresAt).toBe(new Date(t.clock.ms + FAMILY_INVITE_TTL_MS).toISOString());
    expect(res.family.members).toEqual([
      { memberId: expect.any(String), name: '엄마', isMe: true, connected: false, shareWithThem: false, sharesWithMe: false },
    ]);
    expect(res.family.maxMembers).toBe(MAX_FAMILY_MEMBERS);
    expect(res.family.invite.code).toBe(res.code);
    // 비밀값은 이 응답 한 번뿐이다: 이후 조회에는 나오지 않는다.
    const later = await call(t, 'GET', '/family', { member: res.memberToken! });
    expect(later.status).toBe(200);
    expect(JSON.stringify(later.body)).not.toContain(res.memberToken!);
    expect(later.body.family.me.memberId).toBe(res.family.me.memberId);
    // 구성원마다 비밀값이 다르다
    expect(await makeFamily(t, '삼촌').then((r) => r.memberToken)).not.toBe(res.memberToken);
  });

  it('이미 구성원이면 새 코드로 바꾸고(비밀값은 다시 주지 않음) 이전 코드는 쓸 수 없다', async () => {
    const t = fresh();
    const first = await makeFamily(t);
    const second = await call(t, 'POST', '/family/invite', { member: first.memberToken!, body: {} });
    expect(second.body.created).toBe(false);
    expect(second.body.memberToken).toBeNull();
    expect(second.body.code).not.toBe(first.code);
    expect((await join(t, first.code)).status).toBe(404);
    expect((await join(t, second.body.code)).status).toBe(200);
  });

  it('이름은 선택이고 비면 기본 이름, 한 가족 안에서 겹치면 번호를 붙인다', async () => {
    const t = fresh();
    const a = await call(t, 'POST', '/family/invite', { body: {} }).then((r) => r.body as Created);
    await joined(t, a.code, '  가족  ');
    await joined(t, a.code, '가족');
    const f = await view(t, { memberToken: a.memberToken! });
    expect(f.members.map((m: any) => m.name)).toEqual(['가족', '가족 2', '가족 3']);
    expect((await call(t, 'POST', '/family/invite', { body: { name: 'x'.repeat(101) } })).status).toBe(400);
    expect((await call(t, 'POST', '/family/invite', { body: { nick: '엄마' } })).status).toBe(400);
    expect((await call(t, 'POST', '/family/invite', { body: { name: 3 } })).status).toBe(400);
  });

  it('인원이 가득 차면 새 코드를 만들 수 없다(409 family-full)', async () => {
    const t = fresh();
    const mom = await makeFamily(t);
    for (let i = 1; i < MAX_FAMILY_MEMBERS; i++) await joined(t, mom.code);
    const res = await call(t, 'POST', '/family/invite', { member: mom.memberToken!, body: {} });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('family-full');
  });

  it('폰 토큰을 같이 보내며 만들면 그 자리가 새 구성원에게 바로 묶인다(차 연결 여부와 우리 차가 보임)', async () => {
    const t = fresh();
    const mom = await connect(t, '엄마폰');
    const made = await makeFamily(t, '엄마', { phoneToken: mom.phoneToken });
    expect(made.family.members[0].connected).toBe(true);
    expect(made.family.cars).toEqual([{ carRef: expect.stringMatching(/^car-/), memberIds: [made.family.me.memberId] }]);
    // 이제 폰 토큰만으로도 같은 구성원이다
    expect((await view(t, { phoneToken: mom.phoneToken })).me.memberId).toBe(made.family.me.memberId);
  });

  it('한 요청 주소가 짧은 시간에 가족을 너무 많이 만들면 429(식별을 바꿔도 주소로 막는다)', async () => {
    const t = fresh();
    for (let i = 0; i < MAX_FAMILY_CREATES_PER_SOURCE; i++) await makeFamily(t, `f${i}`, { ip: '9.9.9.9' });
    const blocked = await call(t, 'POST', '/family/invite', { body: {}, ip: '9.9.9.9' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('rate-limited');
    await makeFamily(t, 'other', { ip: '8.8.8.8' });
    t.clock.ms += FAMILY_CREATE_WINDOW_MS;
    await makeFamily(t, 'again', { ip: '9.9.9.9' });
  });

  it('하루(24시간) 누적 상한도 있다: 10분 창을 계속 지나가도 한 주소는 하루 20개까지', async () => {
    const t = fresh();
    let made = 0;
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < MAX_FAMILY_CREATES_PER_SOURCE; i++) {
        const res = await call(t, 'POST', '/family/invite', { body: {}, ip: '7.7.7.7' });
        if (res.status === 200) made += 1;
        else expect(res.body.reason).toBe('rate-limited');
      }
      t.clock.ms += FAMILY_CREATE_WINDOW_MS;
    }
    expect(made).toBe(MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY);
    expect((await call(t, 'POST', '/family/invite', { body: {}, ip: '7.7.7.7' })).status).toBe(429);
    await makeFamily(t, 'good', { ip: '6.6.6.6' }); // 다른 주소는 영향 없다
    t.clock.ms += FAMILY_CREATE_DAY_WINDOW_MS;
    await makeFamily(t, 'next day', { ip: '7.7.7.7' });
  });
});

describe('POST /family/join', () => {
  it('코드로 참여한다(대소문자·공백·하이픈 무시). 새 구성원은 비밀값을 받고 같은 가족을 본다', async () => {
    const t = fresh();
    const { code, family, memberToken: momToken } = await makeFamily(t);
    const sloppy = code.replace('-', ' ').toLowerCase();
    const res = await join(t, sloppy, { name: '아빠' });
    expect(res.status).toBe(200);
    expect(res.body.memberToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.family.familyId).toBe(family.familyId);
    expect(res.body.family.members.map((m: any) => [m.name, m.isMe])).toEqual([['엄마', false], ['아빠', true]]);
    const mom = await view(t, { memberToken: momToken! });
    expect(mom.members.map((m: any) => m.name)).toEqual(['엄마', '아빠']);
    expect(normalizeInviteCode('ab cd-efgh')).toBe('ABCDEFGH');
    expect(normalizeInviteCode('AB1D-EFGH')).toBeNull(); // 헷갈리는 글자(0·1·I·L·O)는 코드에 없다
  });

  it('코드는 24시간 뒤에 만료된다(직전까지는 쓸 수 있다)', async () => {
    const t = fresh();
    const { code, memberToken } = await makeFamily(t);
    t.clock.ms += FAMILY_INVITE_TTL_MS - 1;
    expect((await join(t, code)).status).toBe(200);
    t.clock.ms += 1;
    const late = await join(t, code);
    expect(late.status).toBe(404);
    expect(late.body.reason).toBe('invalid');
    expect((await view(t, { memberToken: memberToken! })).invite).toBeNull();
  });

  it('없는 코드와 모양이 틀린 코드는 같은 404이고 본문 오류는 400이다', async () => {
    const t = fresh();
    await makeFamily(t);
    expect((await join(t, 'AAAA-BBBB')).status).toBe(404);
    expect((await join(t, '12')).status).toBe(404);
    expect((await call(t, 'POST', '/family/join', { body: {} })).status).toBe(400);
    expect((await call(t, 'POST', '/family/join', { body: { code: 5 } })).status).toBe(400);
    expect((await call(t, 'POST', '/family/join', { body: { code: 'AAAA-BBBB', extra: 1 } })).status).toBe(400);
  });

  it('인원 한도: 한도까지 들어오고 다음 사람은 409 family-full', async () => {
    const t = fresh();
    const mom = await makeFamily(t);
    for (let i = 1; i < MAX_FAMILY_MEMBERS; i++) await joined(t, mom.code);
    const res = await join(t, mom.code);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('family-full');
    expect((await view(t, { memberToken: mom.memberToken! })).members).toHaveLength(MAX_FAMILY_MEMBERS);
  });

  it('중복 참여: 같은 가족에 다시도, 다른 가족 코드로도 409 already-in-family', async () => {
    const t = fresh();
    const a = await makeFamily(t, '엄마');
    const b = await makeFamily(t, '삼촌');
    const dad = await joined(t, a.code, '아빠');
    for (const code of [a.code, b.code]) {
      const again = await join(t, code, { memberToken: dad });
      expect(again.status).toBe(409);
      expect(again.body.reason).toBe('already-in-family');
    }
    // 가족을 만든 사람이 자기 가족 코드를 다시 넣는 것도 마찬가지
    expect((await join(t, a.code, { memberToken: a.memberToken! })).status).toBe(409);
    expect((await view(t, { memberToken: a.memberToken! })).members).toHaveLength(2);
  });

  it('시도 제한: 틀린 코드 5번이면 그 주소를 잠그고(맞는 코드도 막음) 60초 뒤에 풀린다. 다른 주소는 영향 없다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    for (let i = 0; i < MAX_FAILURES; i++) expect((await join(t, 'AAAA-BBBB', { ip: '1.1.1.1' })).status).toBe(404);
    const locked = await join(t, code, { ip: '1.1.1.1' });
    expect(locked.status).toBe(429);
    expect(locked.body.reason).toBe('locked');
    expect(locked.headers.get('retry-after')).toBe(String(locked.body.retryAfterSeconds));
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect((await join(t, code, { ip: '2.2.2.2' })).status).toBe(200);
    t.clock.ms += 60_000;
    expect((await join(t, code, { ip: '1.1.1.1' })).status).toBe(200);
  });

  it('맞는 코드는 그 주소의 실패 횟수를 지운다', async () => {
    const t = fresh();
    const { code } = await makeFamily(t);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < MAX_FAILURES - 1; i++) await join(t, 'AAAA-BBBB', { ip: '3.3.3.3' });
      expect((await join(t, code, { ip: '3.3.3.3' })).status).toBe(200);
    }
  });
});

describe('가족 조회·이름·공유', () => {
  it('구성원 비밀값이 가리키는 구성원이 가족을 본다. 폰 토큰만 있고 구성원에게 묶이지 않았으면 family: null', async () => {
    const t = fresh();
    const lone = await connect(t, '혼자폰');
    expect((await call(t, 'GET', '/family', { token: lone.phoneToken })).body).toEqual({ family: null });
  });

  it('구성원에는 폰 토큰·자리 id·차 토큰·구성원 비밀값이 나오지 않고, 차 연결 여부와 우리 차 목록만 나온다', async () => {
    const t = fresh();
    const mom = await connect(t, '엄마폰');
    const made = await makeFamily(t, '엄마', { phoneToken: mom.phoneToken });
    const dadToken = await joined(t, made.code, '아빠');
    const f = await view(t, { phoneToken: mom.phoneToken, memberToken: made.memberToken! });
    const text = JSON.stringify(f);
    for (const secret of [mom.phoneToken, mom.seatId, mom.carToken, made.memberToken!, dadToken]) expect(text).not.toContain(secret);
    expect(f.members.map((m: any) => [m.name, m.connected])).toEqual([['엄마', true], ['아빠', false]]);
    expect(f.cars).toEqual([{ carRef: expect.stringMatching(/^car-/), memberIds: [f.me.memberId] }]);
    expect(text).not.toContain(mom.carId);
  });

  it('PUT /family/me로 부르는 이름을 바꾼다(겹치면 번호)', async () => {
    const t = fresh();
    const mom = await makeFamily(t);
    const dad = await joined(t, mom.code, '아빠');
    const res = await call(t, 'PUT', '/family/me', { member: dad, body: { name: '엄마' } });
    expect(res.body.me.name).toBe('엄마 2');
    expect((await call(t, 'PUT', '/family/me', { member: dad, body: {} })).status).toBe(400);
    const lone = await connect(t, '혼자폰');
    expect((await call(t, 'PUT', '/family/me', { token: lone.phoneToken, body: { name: 'x' } })).status).toBe(404);
  });

  it('PUT /family/share: 가족 한 사람마다 켜고 끈다(기본 꺼짐). 내 설정은 상대 화면의 sharesWithMe로 보인다', async () => {
    const t = fresh();
    const mom = await makeFamily(t);
    const dad = await joined(t, mom.code, '아빠');
    const momView = await view(t, { memberToken: mom.memberToken! });
    const dadRow = momView.members.find((m: any) => m.name === '아빠');
    expect(dadRow.shareWithThem).toBe(false);
    const on = await call(t, 'PUT', '/family/share', { member: mom.memberToken!, body: { memberId: dadRow.memberId, enabled: true } });
    expect(on.body).toEqual({ memberId: dadRow.memberId, enabled: true });
    expect((await view(t, { memberToken: mom.memberToken! })).members.find((m: any) => m.name === '아빠').shareWithThem).toBe(true);
    expect((await view(t, { memberToken: dad })).members.find((m: any) => m.name === '엄마').sharesWithMe).toBe(true);
    expect((await view(t, { memberToken: dad })).members.find((m: any) => m.name === '엄마').shareWithThem).toBe(false);
    await call(t, 'PUT', '/family/share', { member: mom.memberToken!, body: { memberId: dadRow.memberId, enabled: false } });
    expect((await view(t, { memberToken: dad })).members.find((m: any) => m.name === '엄마').sharesWithMe).toBe(false);
  });

  it('공유 대상 검증: 자기 자신 400, 다른 가족·없는 구성원 404, 가족 없음 404, 본문 오류 400', async () => {
    const t = fresh();
    const a = await makeFamily(t, '엄마');
    const b = await makeFamily(t, '삼촌');
    const mom = a.family.members[0].memberId as string;
    const uncle = b.family.members[0].memberId as string;
    const put = (member: string, body: unknown) => call(t, 'PUT', '/family/share', { member, body });
    expect((await put(a.memberToken!, { memberId: mom, enabled: true })).status).toBe(400);
    expect((await put(a.memberToken!, { memberId: uncle, enabled: true })).status).toBe(404);
    expect((await put(a.memberToken!, { memberId: 'nope', enabled: true })).status).toBe(404);
    const lone = await connect(t, '혼자폰');
    expect((await call(t, 'PUT', '/family/share', { token: lone.phoneToken, body: { memberId: mom, enabled: true } })).body.reason).toBe('not-in-family');
    expect((await put(a.memberToken!, { memberId: uncle })).status).toBe(400);
    expect((await put(a.memberToken!, { memberId: uncle, enabled: 'yes' })).status).toBe(400);
  });
});

describe('가족 나가기 (DELETE /family/me)', () => {
  const trio = async (t: Fresh) => {
    const mom = await makeFamily(t);
    const dad = await joined(t, mom.code, '아빠');
    const kid = await joined(t, mom.code, '아들');
    const f = await view(t, { memberToken: mom.memberToken! });
    const id = (name: string) => f.members.find((m: any) => m.name === name).memberId as string;
    return { mom: id('엄마'), dad: id('아빠'), kid: id('아들'), momToken: mom.memberToken!, dadToken: dad, kidToken: kid, code: mom.code };
  };
  const send = (t: Fresh, member: string, to: string) => call(t, 'POST', '/requests', { member, body: careBody({ memberId: to }) });

  it('그 사람이 보낸·받은 요청과 공유 설정이 지워지고 다른 사람의 요청은 남는다', async () => {
    const t = fresh();
    const x = await trio(t);
    await send(t, x.dadToken, x.mom); // 아빠 → 엄마
    await send(t, x.momToken, x.dad); // 엄마 → 아빠
    await send(t, x.momToken, x.kid); // 엄마 → 아들(남아야 함)
    await send(t, x.kidToken, x.mom); // 아들 → 엄마(남아야 함)
    await call(t, 'PUT', '/family/share', { member: x.dadToken, body: { memberId: x.mom, enabled: true } });
    await call(t, 'PUT', '/family/share', { member: x.momToken, body: { memberId: x.dad, enabled: true } });
    await call(t, 'PUT', '/family/share', { member: x.momToken, body: { memberId: x.kid, enabled: true } });
    expect(t.familyRequests.storedRequests()).toBe(4);

    const left = await call(t, 'DELETE', '/family/me', { member: x.dadToken });
    expect(left.body).toEqual({ left: true });
    expect(t.familyRequests.storedRequests()).toBe(2);
    const mom = (await call(t, 'GET', '/requests', { member: x.momToken })).body;
    expect(mom.sent.map((r: any) => r.to.name)).toEqual(['아들']);
    expect(mom.received.map((r: any) => r.from.name)).toEqual(['아들']);
    const f = await view(t, { memberToken: x.momToken });
    expect(f.members.map((m: any) => m.name)).toEqual(['엄마', '아들']);
    expect(f.members.find((m: any) => m.name === '아들').shareWithThem).toBe(true); // 다른 사람과의 공유는 남는다
    // 나간 사람의 비밀값은 더는 통하지 않는다(401). 다시 들어오면 새 구성원·새 비밀값이고 공유 설정도 기본 꺼짐이다
    const gone = await call(t, 'GET', '/family', { member: x.dadToken });
    expect(gone.status).toBe(401);
    expect(gone.body.reason).toBe('unknown-member');
    const { code } = (await call(t, 'POST', '/family/invite', { member: x.momToken, body: {} })).body;
    const back = await join(t, code, { name: '아빠' });
    expect(back.body.memberToken).not.toBe(x.dadToken);
    const again = await view(t, { memberToken: x.momToken });
    expect(again.members.find((m: any) => m.name === '아빠').shareWithThem).toBe(false);
    expect(again.members.find((m: any) => m.name === '아빠').sharesWithMe).toBe(false);
  });

  it('나간 사람의 옛 요청 id는 더는 보이지 않고, 같은 비밀값은 401', async () => {
    const t = fresh();
    const x = await trio(t);
    await send(t, x.dadToken, x.mom);
    await call(t, 'DELETE', '/family/me', { member: x.dadToken });
    expect((await call(t, 'DELETE', '/family/me', { member: x.dadToken })).status).toBe(401);
    expect((await call(t, 'GET', '/requests', { member: x.dadToken })).status).toBe(401);
    expect((await send(t, x.dadToken, x.mom)).status).toBe(401);
  });

  it('마지막 구성원이 나가면 가족과 초대 코드가 사라진다', async () => {
    const t = fresh();
    const { code, memberToken } = await makeFamily(t);
    await call(t, 'DELETE', '/family/me', { member: memberToken! });
    expect(t.familyRequests.familyCount()).toBe(0);
    expect((await join(t, code)).status).toBe(404);
  });

  it('폰 토큰만 있고 구성원에게 묶이지 않은 폰은 나갈 가족이 없어 404', async () => {
    const t = fresh();
    const lone = await connect(t, '혼자폰');
    expect((await call(t, 'DELETE', '/family/me', { token: lone.phoneToken })).status).toBe(404);
  });
});

describe('구성원 신분: 구성원 비밀값과 폰 토큰(기기 id는 신원이 아니다)', () => {
  it('비밀값만으로 가족을 쓴다(연결 전 폰). 나중에 차에 연결하면 비밀값과 폰 토큰이 같이 온 요청에서 같은 구성원에게 묶인다', async () => {
    const t = fresh();
    const mom = await makeFamily(t);
    const before = await view(t, { memberToken: mom.memberToken! });
    expect(before.members[0].connected).toBe(false);
    const phone = await connect(t, '엄마폰');
    // 폰 토큰만으로는 아직 구성원이 아니다(묶이지 않았으므로)
    expect((await call(t, 'GET', '/family', { token: phone.phoneToken })).body).toEqual({ family: null });
    // 같은 요청에 둘이 같이 오면 묶인다
    const bound = await view(t, { phoneToken: phone.phoneToken, memberToken: mom.memberToken! });
    expect(bound.me.memberId).toBe(before.me.memberId);
    expect(bound.members[0].connected).toBe(true);
    // 그 뒤에는 폰 토큰만으로도 같은 구성원이다
    expect((await view(t, { phoneToken: phone.phoneToken })).me.memberId).toBe(before.me.memberId);
  });

  it('기기 id는 가족 신원이 아니다: 기기 id만으로는 401, 헤더를 붙여도 구성원이 되지 않는다(탈취·선점·키 늘리기가 모두 막힘)', async () => {
    const t = fresh();
    const mom = await makeFamily(t, '엄마');
    const attacker = await connect(t, '공격자');
    // 기기 id만: 식별 없음
    expect((await call(t, 'GET', '/family', { device: dev('mom') })).status).toBe(401);
    // 공격자 폰 토큰 + 피해자 기기 id: 공격자는 어떤 가족의 구성원도 아니다
    expect((await call(t, 'GET', '/family', { token: attacker.phoneToken, device: dev('mom') })).body).toEqual({ family: null });
    // 기기 id를 먼저 선점해 봐도 피해자(아직 구성원이 아닌 폰)는 자기 가족을 만든다
    await call(t, 'POST', '/family/invite', { token: attacker.phoneToken, device: dev('victim'), body: { name: '공격자' } });
    const victim = await call(t, 'POST', '/family/invite', { device: dev('victim'), body: { name: '피해자' } });
    expect(victim.body.created).toBe(true);
    expect(victim.body.family.members.map((m: any) => m.name)).toEqual(['피해자']);
    // 임의의 기기 id 500개를 붙여도 그 기기 id들은 아무것도 풀지 못한다
    for (let i = 0; i < 500; i++) await call(t, 'GET', '/family', { member: mom.memberToken!, device: `rand-${i}`.padEnd(30, 'x') });
    expect((await call(t, 'GET', '/family', { device: 'rand-7'.padEnd(30, 'x') })).status).toBe(401);
  });

  it('연결을 끊어도(자리가 사라져도) 구성원은 비밀값으로 가족에 남고, 옛 폰 토큰만 401이다', async () => {
    const t = fresh();
    const phone = await connect(t, '엄마폰');
    const mom = await makeFamily(t, '엄마', { phoneToken: phone.phoneToken });
    const dad = await joined(t, mom.code, '아빠');
    expect((await call(t, 'DELETE', '/pair', { token: phone.phoneToken })).status).toBe(200);
    expect((await call(t, 'GET', '/family', { token: phone.phoneToken })).status).toBe(401);
    const f = await view(t, { memberToken: mom.memberToken! });
    expect(f.members.map((m: any) => [m.name, m.connected])).toEqual([['엄마', false], ['아빠', false]]);
    expect((await view(t, { memberToken: dad })).members).toHaveLength(2);
  });

  it('폰 바꾸기: 자리가 그대로라 구성원도 이어진다. 새 폰은 폰 토큰만으로 같은 구성원이고 옛 폰 토큰은 401', async () => {
    const t = fresh();
    const mom = await connect(t, '엄마폰');
    const made = await makeFamily(t, '엄마', { phoneToken: mom.phoneToken });
    const issued = await call(t, 'POST', '/pair/code', { token: mom.carToken, body: { mode: 'replace', seatId: mom.seatId } });
    const claimed = await call(t, 'POST', '/pair/claim', { body: { code: issued.body.code, name: '새 폰' } });
    expect(claimed.status).toBe(200);
    const fromNew = await view(t, { phoneToken: claimed.body.phoneToken });
    expect(fromNew.me.memberId).toBe(made.family.me.memberId);
    expect(fromNew.members[0].connected).toBe(true);
    expect((await call(t, 'GET', '/family', { token: mom.phoneToken })).status).toBe(401);
    // 비밀값을 잃은 새 폰도 폰 토큰만으로 가족을 쓰고 나갈 수 있다
    expect((await call(t, 'DELETE', '/family/me', { token: claimed.body.phoneToken })).status).toBe(200);
  });

  it('자리가 이미 다른 구성원에게 묶여 있으면 비밀값을 가진 쪽이 이기고 묶음은 바뀌지 않는다', async () => {
    const t = fresh();
    const phone = await connect(t, '공용폰');
    const a = await makeFamily(t, '엄마', { phoneToken: phone.phoneToken });
    const b = await joined(t, a.code, '아빠');
    // 아빠 비밀값 + 엄마에게 묶인 폰 토큰: 아빠로 보이고 자리는 그대로 엄마 것
    const asDad = await view(t, { phoneToken: phone.phoneToken, memberToken: b });
    expect(asDad.me.name).toBe('아빠');
    expect(asDad.members.map((m: any) => [m.name, m.connected])).toEqual([['엄마', true], ['아빠', false]]);
    expect((await view(t, { phoneToken: phone.phoneToken })).me.name).toBe('엄마');
  });

  it('구성원이 다른 차에 다시 연결하면 새 자리로 묶음이 옮겨 간다(옛 차의 자리는 풀림)', async () => {
    const t = fresh();
    const phone = await connect(t, '엄마폰');
    const made = await makeFamily(t, '엄마', { phoneToken: phone.phoneToken });
    const carA = (await view(t, { memberToken: made.memberToken! })).cars[0].carRef;
    // 같은 폰이 다른 차의 코드로 연결: 옛 자리 삭제 + 새 자리
    const second = await call(t, 'POST', '/pair/code', { body: {} });
    const issued = await call(t, 'POST', '/pair/code', { token: second.body.carToken, body: {} });
    const claimed = await call(t, 'POST', '/pair/claim', { token: phone.phoneToken, body: { code: issued.body.code, name: '엄마폰' } });
    expect(claimed.status).toBe(200);
    expect((await view(t, { memberToken: made.memberToken! })).members[0].connected).toBe(false); // 옛 자리가 사라짐
    const rebound = await view(t, { phoneToken: claimed.body.phoneToken, memberToken: made.memberToken! });
    expect(rebound.members[0].connected).toBe(true);
    expect(rebound.cars).toHaveLength(1);
    expect(rebound.cars[0].carRef).not.toBe(carA);
  });

  it('식별 없는 요청·이상한 식별은 가족 API에서 거절된다(가족 만들기·참여만 식별 없이 된다)', async () => {
    const t = fresh();
    const mom = await makeFamily(t);
    await connect(t, '엄마폰'); // 자리 있는 차가 하나(옛 호환 읽기가 열려 있는 서버)
    const calls: [string, string, unknown?][] = [
      ['GET', '/family'], ['PUT', '/family/me', { name: 'x' }], ['DELETE', '/family/me'],
      ['PUT', '/family/share', { memberId: 'x', enabled: true }], ['POST', '/requests', careBody({ memberId: 'x' })], ['GET', '/requests'],
    ];
    for (const [method, path, body] of calls) {
      expect((await call(t, method, path, { body })).status, `${method} ${path} 식별 없음`).toBe(401);
      expect((await call(t, method, path, { body, device: dev('mom') })).status, `${method} ${path} 기기 id만`).toBe(401);
      expect((await call(t, method, path, { body, token: 'f'.repeat(64) })).status, `${method} ${path} 모르는 폰 토큰`).toBe(401);
      const unknown = await call(t, method, path, { body, member: 'e'.repeat(64) });
      expect(unknown.status, `${method} ${path} 모르는 비밀값`).toBe(401);
      expect(unknown.body.reason).toBe('unknown-member');
      expect((await call(t, method, path, { body, member: 'short' })).status, `${method} ${path} 이상한 비밀값`).toBe(400);
      expect((await call(t, method, path, { body, member: mom.memberToken!, token: 'f'.repeat(64) })).status, `${method} ${path} 비밀값+모르는 폰 토큰`).toBe(401);
    }
    // 가족 만들기·참여는 식별 없이 된다. 모르는 비밀값·이상한 비밀값은 여기서도 거절
    expect((await call(t, 'POST', '/family/invite', { body: {} })).status).toBe(200);
    expect((await call(t, 'POST', '/family/join', { body: { code: 'AAAA-BBBB' } })).status).toBe(404);
    expect((await call(t, 'POST', '/family/invite', { body: {}, member: 'e'.repeat(64) })).status).toBe(401);
    expect((await call(t, 'POST', '/family/join', { body: { code: 'AAAA-BBBB' }, member: 'short' })).status).toBe(400);
  });

  it('차 토큰으로는 폰 API를 부를 수 없다(401)', async () => {
    const t = fresh();
    const mom = await connect(t, '엄마폰');
    expect((await call(t, 'GET', '/family', { token: mom.carToken })).status).toBe(401);
    expect((await call(t, 'POST', '/family/invite', { token: mom.carToken, body: {} })).status).toBe(401);
  });

  it('구성원 비밀값은 어떤 응답에도 다시 나오지 않는다(가족·요청·차 조회·알림함)', async () => {
    const t = fresh();
    const mom = await connect(t, '엄마폰');
    const dad = await connect(t, '아빠폰', { carToken: mom.carToken });
    const made = await makeFamily(t, '엄마', { phoneToken: mom.phoneToken });
    const dadJoin = await join(t, made.code, { name: '아빠', phoneToken: dad.phoneToken });
    const secrets = [made.memberToken!, dadJoin.body.memberToken as string];
    const dadId = dadJoin.body.family.me.memberId as string;
    const created = await call(t, 'POST', '/requests', { ...as({ memberToken: made.memberToken!, phoneToken: mom.phoneToken }), body: careBody({ memberId: dadId }) });
    const texts = [
      JSON.stringify((await call(t, 'GET', '/family', as({ memberToken: made.memberToken! }))).body),
      JSON.stringify((await call(t, 'GET', '/family', as({ memberToken: secrets[1]! }))).body),
      JSON.stringify(created.body),
      JSON.stringify((await call(t, 'GET', '/requests', as({ memberToken: secrets[1]! }))).body),
      JSON.stringify((await call(t, 'GET', `/requests?driver=${dad.seatId}`, { token: mom.carToken })).body),
      JSON.stringify((await call(t, 'GET', '/drivers', { token: mom.carToken })).body),
      JSON.stringify(t.outbox.list(mom.seatId)),
    ];
    for (const text of texts) for (const secret of secrets) expect(text).not.toContain(secret);
    expect(JSON.stringify(t.familyRequests.storedRequests())).not.toContain(secrets[0]!);
  });
});

describe('정기 작업(purge): 오래 쓰지 않은 구성원, 버려진 혼자뿐인 가족', () => {
  it('30일 쓰지 않은 구성원은 연결 여부와 관계없이 가족에서 내보내고, 쓰면 기한이 새로 시작한다', async () => {
    const t = fresh();
    const phone = await connect(t, '엄마폰');
    const mom = await makeFamily(t, '엄마', { phoneToken: phone.phoneToken });
    const dad = await joined(t, mom.code, '아빠');
    const kid = await joined(t, mom.code, '아들');
    t.clock.ms += MEMBER_INACTIVE_TTL_MS - 1;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(0);
    for (const member of [dad, kid]) await call(t, 'GET', '/family', { member }); // 쓰면 기한이 새로 시작한다
    t.clock.ms += MEMBER_INACTIVE_TTL_MS - 1;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(1); // 엄마만(30일 쓰지 않음)
    expect((await call(t, 'GET', '/family', { member: mom.memberToken! })).status).toBe(401);
    expect((await view(t, { memberToken: dad })).members.map((m: any) => m.name)).toEqual(['아빠', '아들']);
    t.clock.ms += 60 * DAY;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(2);
    expect(t.familyRequests.familyCount()).toBe(0);
  });

  it('차에서 그 자리로 부르면(요청 조회) 그 구성원이 쓴 것으로 센다: 차만 쓰는 사람이 30일 뒤 내보내지지 않는다', async () => {
    const t = fresh();
    const phone = await connect(t, '엄마폰');
    const mom = await makeFamily(t, '엄마', { phoneToken: phone.phoneToken });
    await joined(t, mom.code, '아빠');
    t.clock.ms += MEMBER_INACTIVE_TTL_MS - HOUR;
    expect((await call(t, 'GET', `/requests?driver=${phone.seatId}`, { token: phone.carToken })).status).toBe(200);
    t.clock.ms += 2 * HOUR;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(1); // 비밀값만 가진 아빠만
    expect((await view(t, { memberToken: mom.memberToken! })).members.map((m: any) => m.name)).toEqual(['엄마']);
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

