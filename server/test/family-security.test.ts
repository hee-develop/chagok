import { describe, expect, it } from 'vitest';
import { ETA_NOTIFICATION_TTL_MS, MAX_FAMILY_CREATES_PER_SOURCE, MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY, PAST_AT_LEEWAY_MS, SOLO_FAMILY_TTL_MS, FAMILY_CREATE_WINDOW_MS, MEMBER_INACTIVE_TTL_MS } from '../src/family/limits.js';
import { NOTIFICATION_TTL_MS } from '../src/notify/outbox.js';
import {
  appointmentBody, as, call, careBody, connect, fresh, inbox, memberOnly, rideBody, stopBody, DAY, HOUR, MINUTE, T0, type Fresh,
} from './familyHelpers.js';

type Phone = { phoneToken?: string; memberToken: string; seatId?: string; carToken?: string; memberId?: string };

/** 가족 만들기(폰 토큰을 같이 보내면 그 자리가 묶임)와 참여. */
const found = async (t: Fresh, name: string, phone?: { phoneToken: string; seatId: string; carToken?: string }) => {
  const res = await call(t, 'POST', '/family/invite', { token: phone?.phoneToken, body: { name } });
  expect(res.status).toBe(200);
  return { phone: { ...phone, memberToken: res.body.memberToken as string, memberId: res.body.family.me.memberId as string } as Phone, code: res.body.code as string, family: res.body.family };
};
const enter = async (t: Fresh, code: string, name: string, phone?: { phoneToken: string; seatId: string; carToken?: string }) => {
  const res = await call(t, 'POST', '/family/join', { token: phone?.phoneToken, body: { code, name } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { ...phone, memberToken: res.body.memberToken as string, memberId: res.body.family.me.memberId as string } as Phone;
};
const send = async (t: Fresh, from: Phone, body: unknown) => {
  const res = await call(t, 'POST', '/requests', { ...as(from), body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.request as any;
};
const carList = async (t: Fresh, carToken: string, seatId: string) => (await call(t, 'GET', `/requests?driver=${seatId}`, { token: carToken })).body.requests as any[];
const patch = (t: Fresh, carToken: string, seatId: string, id: string, status: string) =>
  call(t, 'PATCH', `/requests/${id}?driver=${seatId}`, { token: carToken, body: { status } });

/** 엄마·아빠 폰이 같은 차에 연결된 가족(엄마가 가족을 만들고 아빠가 참여). */
const twoOnOneCar = async () => {
  const t = fresh();
  const momPhone = await connect(t, '엄마폰');
  const dadPhone = await connect(t, '아빠폰', { carToken: momPhone.carToken });
  const made = await found(t, '엄마', momPhone);
  const dad = await enter(t, made.code, '아빠', dadPhone);
  const carRef = (await call(t, 'GET', '/family', as(made.phone))).body.family.cars[0].carRef as string;
  return { t, mom: made.phone, dad, momPhone, dadPhone, carRef, code: made.code };
};

describe("critical: '우리 차' 요청은 그 차에 그 가족의 자리가 남아 있을 때만 유효하다", () => {
  it('차곡 초기화 뒤 같은 차에 새로 연결한 낯선 사람은 이전 가족의 우리 차 요청을 보지도 바꾸지도 못하고, 요청은 지워진다', async () => {
    const t = fresh();
    const momPhone = await connect(t, '엄마폰');
    const mom = await found(t, '엄마', momPhone);
    const dad = await enter(t, mom.code, '아빠'); // 차에 연결 안 한 가족
    const carRef = (await call(t, 'GET', '/family', as(mom.phone))).body.family.cars[0].carRef;
    const req = await send(t, dad, stopBody({ carRef }, { memo: '엄마 처방전 번호 1234' }));
    expect((await carList(t, momPhone.carToken!, momPhone.seatId)).map((r) => r.id)).toEqual([req.id]);

    expect((await call(t, 'DELETE', '/car', { token: momPhone.carToken })).status).toBe(200);
    const stranger = await connect(t, '새주인', { carToken: momPhone.carToken });
    expect(await carList(t, momPhone.carToken!, stranger.seatId)).toEqual([]);
    expect((await patch(t, momPhone.carToken!, stranger.seatId, req.id, 'delivered')).status).toBe(404);
    expect((await call(t, 'POST', `/requests/${req.id}/eta?driver=${stranger.seatId}`, { token: momPhone.carToken, body: { stage: 'soon' } })).status).toBe(404);
    // 저장 쪽: 요청과 가리킴값이 지워졌다
    expect(t.familyRequests.storedRequests()).toBe(0);
    expect(t.familyRequests.refCount()).toBe(0);
    // 보낸 사람 화면에서도 사라지고(보낸 요청이 낯선 사람에게 가지 않음), 옛 가리킴값으로는 새 요청을 못 보낸다
    expect((await call(t, 'GET', '/requests', as(dad))).body.sent).toEqual([]);
    const again = await call(t, 'POST', '/requests', { ...as(dad), body: stopBody({ carRef }) });
    expect(again.body.reason).toBe('unknown-car');
    expect((await call(t, 'GET', '/family', as(dad))).body.family.cars).toEqual([]);
  });

  it('마지막 가족 구성원이 차 연결을 끊거나 가족을 나가면 그 차의 우리 차 요청이 지워진다(자리를 이어받은 낯선 사람은 못 봄)', async () => {
    for (const how of ['unpair', 'leave'] as const) {
      const t = fresh();
      const momPhone = await connect(t, '엄마폰');
      const mom = await found(t, '엄마', momPhone);
      const dad = await enter(t, mom.code, '아빠');
      const carRef = (await call(t, 'GET', '/family', as(mom.phone))).body.family.cars[0].carRef;
      const req = await send(t, dad, careBody({ carRef }));
      const stranger = await connect(t, '동승자', { carToken: momPhone.carToken });
      expect((await carList(t, momPhone.carToken!, stranger.seatId)).map((r) => r.id), `${how} 전`).toEqual([req.id]); // 가족 자리가 남아 있는 동안은 정책대로 보임
      if (how === 'unpair') expect((await call(t, 'DELETE', '/pair', { token: momPhone.phoneToken })).status).toBe(200);
      else expect((await call(t, 'DELETE', '/family/me', as(mom.phone))).status).toBe(200);
      expect(await carList(t, momPhone.carToken!, stranger.seatId), `${how} 후`).toEqual([]);
      expect((await patch(t, momPhone.carToken!, stranger.seatId, req.id, 'delivered')).status).toBe(404);
      expect(t.familyRequests.storedRequests(), how).toBe(0);
    }
  });

  it('30일 정리로 마지막 연결된 구성원이 나가도 그 차의 우리 차 요청이 지워진다', async () => {
    const t = fresh();
    const momPhone = await connect(t, '엄마폰');
    const mom = await found(t, '엄마', momPhone);
    const dad = await enter(t, mom.code, '아빠');
    const carRef = (await call(t, 'GET', '/family', as(mom.phone))).body.family.cars[0].carRef;
    await send(t, dad, careBody({ carRef }));
    t.clock.ms += MEMBER_INACTIVE_TTL_MS - HOUR;
    await call(t, 'GET', '/family', memberOnly(dad)); // 아빠만 계속 씀
    t.clock.ms += 2 * HOUR;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(1); // 엄마가 나감
    expect(t.familyRequests.storedRequests()).toBe(0);
  });

  it('같은 차에 가족 아닌 동료의 자리가 있어도 가족 자리가 하나라도 남아 있으면 정책대로 그 차에 다음에 타는 운전자가 우리 차 요청을 본다', async () => {
    const x = await twoOnOneCar();
    const coworker = await connect(x.t, '동료폰', { carToken: x.momPhone.carToken });
    const kid = await enter(x.t, x.code, '아들'); // 차 없음
    const req = await send(x.t, kid, rideBody({ carRef: x.carRef }));
    expect((await carList(x.t, x.momPhone.carToken!, coworker.seatId)).map((r) => r.id)).toEqual([req.id]);
    // 엄마가 끊어도 아빠 자리가 남아 있으면 그대로
    expect((await call(x.t, 'DELETE', '/pair', { token: x.momPhone.phoneToken })).status).toBe(200);
    expect((await carList(x.t, x.momPhone.carToken!, coworker.seatId)).map((r) => r.id)).toEqual([req.id]);
    expect((await patch(x.t, x.momPhone.carToken!, coworker.seatId, req.id, 'delivered')).status).toBe(200);
    // 아빠까지 끊으면 지워진다
    expect((await call(x.t, 'DELETE', '/pair', { token: x.dadPhone.phoneToken })).status).toBe(200);
    expect(await carList(x.t, x.momPhone.carToken!, coworker.seatId)).toEqual([]);
    expect(x.t.familyRequests.storedRequests()).toBe(0);
  });

  it('구성원이 다른 차에 다시 연결하면 옛 차의 우리 차 요청이 지워지고 새 차의 가리킴값은 따로다', async () => {
    const t = fresh();
    const phone = await connect(t, '엄마폰');
    const mom = await found(t, '엄마', phone);
    const dad = await enter(t, mom.code, '아빠');
    const carA = (await call(t, 'GET', '/family', as(mom.phone))).body.family.cars[0].carRef;
    await send(t, dad, careBody({ carRef: carA }));
    const second = await call(t, 'POST', '/pair/code', { body: {} });
    const issued = await call(t, 'POST', '/pair/code', { token: second.body.carToken, body: {} });
    const claimed = await call(t, 'POST', '/pair/claim', { token: phone.phoneToken, body: { code: issued.body.code, name: '엄마폰' } });
    expect(claimed.status).toBe(200);
    expect(t.familyRequests.storedRequests()).toBe(0); // 옛 차에 가족 자리가 없어짐
    const rebound = (await call(t, 'GET', '/family', as({ phoneToken: claimed.body.phoneToken, memberToken: mom.phone.memberToken }))).body.family;
    expect(rebound.cars).toHaveLength(1);
    expect(rebound.cars[0].carRef).not.toBe(carA);
  });

  it('요청이 지워지면 그 요청의 family-status 알림도 알림함에서 지운다(가족 나가기·차 자리 없어짐), 다른 요청의 알림은 남는다', async () => {
    const x = await twoOnOneCar();
    const kidPhone = await connect(x.t, '아들폰', { carToken: x.momPhone.carToken });
    const kid = await enter(x.t, x.code, '아들', kidPhone);
    // 아빠가 엄마에게, 아들에게 보낸 요청이 각각 '전달' 알림을 만든다
    const toMom = await send(x.t, x.dad, careBody({ memberId: x.mom.memberId }));
    const toKid = await send(x.t, x.dad, careBody({ memberId: kid.memberId }));
    await patch(x.t, x.momPhone.carToken!, x.momPhone.seatId, toMom.id, 'delivered');
    await patch(x.t, x.momPhone.carToken!, kidPhone.seatId, toKid.id, 'delivered');
    expect(inbox(x.t, x.dadPhone.seatId).map((n) => n.data.requestId).sort()).toEqual([toMom.id, toKid.id].sort());
    // 엄마가 가족을 나가면 엄마가 받은 요청과 그 알림이 지워진다
    expect((await call(x.t, 'DELETE', '/family/me', as(x.mom))).status).toBe(200);
    expect(inbox(x.t, x.dadPhone.seatId).map((n) => n.data.requestId)).toEqual([toKid.id]);
    // 같은 요청의 알림은 다시 만들어지지 않는다(중복 억제 키가 남음): 이미 지워진 요청이라 어차피 404
    expect((await patch(x.t, x.momPhone.carToken!, x.momPhone.seatId, toMom.id, 'completed')).status).toBe(404);
  });
});

describe('major: 구성원 신분은 구성원 비밀값이다(기기 id는 신원이 아니다)', () => {
  it('P1: 다른 사람의 기기 id를 알아도 구성원을 가로챌 수 없다(기기 id를 읽지도 않는다)', async () => {
    const t = fresh();
    const mom = await found(t, '엄마');
    const attacker = await connect(t, '공격자');
    const dev = 'dev-mom'.padEnd(24, '0');
    const r = await call(t, 'GET', '/family', { token: attacker.phoneToken, device: dev });
    expect(r.body).toEqual({ family: null });
    expect((await call(t, 'GET', '/family', { token: attacker.phoneToken, device: dev, member: 'f'.repeat(64) })).status).toBe(401);
    expect((await call(t, 'GET', '/family', as(mom.phone))).body.family.members).toHaveLength(1);
  });

  it('P3: 연결된 구성원이 임의의 기기 id를 아무리 붙여도 서버 상태가 늘지 않고 그 기기 id로는 아무것도 풀리지 않는다', async () => {
    const t = fresh();
    const phone = await connect(t, 'A폰');
    const a = await found(t, 'A', phone);
    for (let i = 0; i < 300; i++) await call(t, 'GET', '/family', { ...as(a.phone), device: `rand-${i}`.padEnd(30, 'x') });
    expect((await call(t, 'GET', '/family', { device: 'rand-7'.padEnd(30, 'x') })).status).toBe(401);
    expect(t.familyRequests.familyCount()).toBe(1);
  });

  it('비밀값을 잃은 구성원(앱 삭제)은 새로 참여해야 하고 옛 구성원은 30일 비활동으로 정리된다', async () => {
    const t = fresh();
    const mom = await found(t, '엄마');
    const lost = await enter(t, mom.code, '아빠');
    const fresher = await enter(t, mom.code, '아빠'); // 다시 설치한 같은 사람: 새 구성원
    expect(fresher.memberId).not.toBe(lost.memberId);
    expect((await call(t, 'GET', '/family', as(mom.phone))).body.family.members.map((m: any) => m.name)).toEqual(['엄마', '아빠', '아빠 2']);
    t.clock.ms += MEMBER_INACTIVE_TTL_MS - 1;
    for (const who of [mom.phone, fresher]) await call(t, 'GET', '/family', as(who)); // 쓰는 구성원은 기한이 새로 시작한다
    t.clock.ms += 1;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(1); // 비밀값을 잃은 옛 구성원만
    expect((await call(t, 'GET', '/family', as(lost))).status).toBe(401);
  });
});

describe('major: 가족 수 상한 남용', () => {
  it('P7: 한 주소로 가족을 계속 만들어도 하루 누적 상한에서 막히고 다른 사용자는 가족을 만들 수 있다', async () => {
    const t = fresh();
    let made = 0;
    for (let i = 0; i < 400; i++) {
      const res = await call(t, 'POST', '/family/invite', { body: {}, ip: 'evil' });
      if (res.status === 200) made += 1;
      else if (res.body.reason === 'rate-limited') t.clock.ms += FAMILY_CREATE_WINDOW_MS;
      else throw new Error(JSON.stringify(res.body));
      if (t.clock.ms - T0 > 20 * HOUR) break;
    }
    expect(made).toBe(MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY);
    expect(MAX_FAMILY_CREATES_PER_SOURCE).toBeLessThan(MAX_FAMILY_CREATES_PER_SOURCE_PER_DAY);
    const victim = await call(t, 'POST', '/family/invite', { body: {}, ip: 'good' });
    expect(victim.status).toBe(200);
  });

  it('구성원 1명뿐이고 요청이 없는 가족은 마지막으로 쓴 지 24시간 뒤 정리된다(쓰면 기한이 새로 시작, 요청이 있으면 남음)', async () => {
    const t = fresh();
    const idle = await found(t, '버려진');
    const used = await found(t, '쓰는중');
    const withRequest = await found(t, '요청있음');
    const phone = await connect(t, '폰');
    const car = await found(t, '차있음', phone);
    const friend = await enter(t, withRequest.code, '친구');
    // 내일 날짜 요청(24시간 뒤에도 날짜가 지나지 않음)
    await send(t, withRequest.phone, careBody({ memberId: friend.memberId }, { date: '2026-11-16' }));
    await send(t, car.phone, careBody({ carRef: car.family.cars[0].carRef }, { date: '2026-11-16' }));
    t.clock.ms += SOLO_FAMILY_TTL_MS - 1;
    await call(t, 'GET', '/family', as(used.phone));
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(0);
    t.clock.ms += 1;
    expect(t.familyRequests.purge(new Date(t.clock.ms)).members).toBe(1);
    expect((await call(t, 'GET', '/family', as(idle.phone))).status).toBe(401);
    expect((await call(t, 'GET', '/family', as(used.phone))).status).toBe(200);
    expect((await call(t, 'GET', '/family', as(withRequest.phone))).status).toBe(200); // 구성원 둘
    expect((await call(t, 'GET', '/family', as(car.phone))).status).toBe(200); // 우리 차 요청이 있음
    expect(t.familyRequests.familyCount()).toBe(3);
  });

  it('전체 상한에 닿으면 혼자뿐인 빈 가족 중 가장 오래 쓰지 않은 것부터 밀어내고, 밀어낼 것이 없을 때만 429', async () => {
    const t = fresh({ maxFamilies: 3 });
    const a = await found(t, 'A');
    t.clock.ms += MINUTE;
    const b = await found(t, 'B');
    t.clock.ms += MINUTE;
    const c = await found(t, 'C');
    t.clock.ms += MINUTE;
    await call(t, 'GET', '/family', as(a.phone)); // A를 최근에 씀 → 가장 오래 쓰지 않은 것은 B
    const d = await found(t, 'D', undefined);
    expect(d.family.members[0].name).toBe('D');
    expect((await call(t, 'GET', '/family', as(b.phone))).status).toBe(401); // 밀려남
    for (const alive of [a, c, d]) expect((await call(t, 'GET', '/family', as(alive.phone))).status).toBe(200);
    expect(t.familyRequests.familyCount()).toBe(3);
    // 밀어낼 수 있는 가족이 없으면(구성원 둘·요청 있음) 429
    const full = fresh({ maxFamilies: 2 });
    const f1 = await found(full, 'A');
    await enter(full, f1.code, 'A2');
    const f2 = await found(full, 'B');
    const f2friend = await enter(full, f2.code, 'B2');
    await send(full, f2.phone, careBody({ memberId: f2friend.memberId }));
    const blocked = await call(full, 'POST', '/family/invite', { body: {} });
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('too-many-families');
  });

  it('정리되지 않던 맵을 정리한다: 가족 만들기 기록은 하루 뒤, 우리 차 가리킴값은 차 자리·가족이 사라질 때', async () => {
    const t = fresh();
    for (let i = 0; i < 5; i++) await call(t, 'POST', '/family/invite', { body: {}, ip: `10.0.0.${i}` });
    expect(t.familyRequests.trackedCreateSources()).toBe(5);
    t.clock.ms += DAY + MINUTE;
    t.familyRequests.purge(new Date(t.clock.ms));
    expect(t.familyRequests.trackedCreateSources()).toBe(0);

    const phone = await connect(t, '폰');
    const mom = await found(t, '엄마', phone);
    expect((await call(t, 'GET', '/family', as(mom.phone))).body.family.cars).toHaveLength(1);
    expect(t.familyRequests.refCount()).toBe(1);
    await call(t, 'DELETE', '/pair', { token: phone.phoneToken });
    expect(t.familyRequests.refCount()).toBe(0);
    const phone2 = await connect(t, '폰2', { carToken: phone.carToken });
    expect((await call(t, 'GET', '/family', as({ memberToken: mom.phone.memberToken, phoneToken: phone2.phoneToken }))).body.family.cars).toHaveLength(1);
    expect(t.familyRequests.refCount()).toBe(1);
    expect((await call(t, 'DELETE', '/family/me', memberOnly(mom.phone))).status).toBe(200);
    expect(t.familyRequests.refCount()).toBe(0);
  });
});

describe('minor', () => {
  it('carRef는 가족마다 다르다(같은 차라도 가족이 다르면 다른 값이라 가족 사이에 차를 맞춰 볼 수 없고, 남의 가리킴값으로는 보낼 수 없다)', async () => {
    const t = fresh();
    const momPhone = await connect(t, '엄마폰');
    const otherPhone = await connect(t, '남폰', { carToken: momPhone.carToken });
    const mom = await found(t, '엄마', momPhone);
    const other = await found(t, '남', otherPhone);
    const refMom = (await call(t, 'GET', '/family', as(mom.phone))).body.family.cars[0].carRef;
    const refOther = (await call(t, 'GET', '/family', as(other.phone))).body.family.cars[0].carRef;
    expect(refMom).not.toBe(refOther);
    const dad = await enter(t, mom.code, '아빠');
    const res = await call(t, 'POST', '/requests', { ...as(dad), body: careBody({ carRef: refOther }) });
    expect(res.body.reason).toBe('unknown-car');
  });

  it('요청 모양에는 정밀한 전이 시각이 없다(만든 시각만). 보낸 사람·받는 사람 모두', async () => {
    const x = await twoOnOneCar();
    const req = await send(x.t, x.dad, appointmentBody({ memberId: x.mom.memberId }));
    x.t.clock.ms += 7 * MINUTE;
    await patch(x.t, x.momPhone.carToken!, x.momPhone.seatId, req.id, 'delivered');
    x.t.clock.ms += 13 * MINUTE;
    await patch(x.t, x.momPhone.carToken!, x.momPhone.seatId, req.id, 'accepted');
    const sent = (await call(x.t, 'GET', '/requests', as(x.dad))).body.sent[0];
    const received = (await call(x.t, 'GET', '/requests', as(x.mom))).body.received[0];
    for (const view of [sent, received, req]) {
      expect(Object.keys(view)).not.toContain('updatedAt');
      expect(Object.keys(view)).not.toContain('completedAt');
      expect(view.createdAt).toBe(new Date(T0).toISOString());
      expect(JSON.stringify(view)).not.toContain(new Date(T0 + 7 * MINUTE).toISOString());
      expect(JSON.stringify(view)).not.toContain(new Date(T0 + 20 * MINUTE).toISOString());
    }
    expect(sent.status).toBe('accepted');
  });

  it('도착 예정 알림은 알림함에 1시간만 머물고(etaAt 포함) 폰이 읽어 ack하면 즉시 사라진다. 일반 상태 알림은 그대로 3일', async () => {
    const x = await twoOnOneCar();
    await call(x.t, 'PUT', '/family/share', { ...as(x.mom), body: { memberId: x.dad.memberId, enabled: true } });
    const req = await send(x.t, x.dad, appointmentBody({ memberId: x.mom.memberId }));
    for (const status of ['delivered', 'accepted']) await patch(x.t, x.momPhone.carToken!, x.momPhone.seatId, req.id, status);
    expect((await call(x.t, 'POST', `/requests/${req.id}/eta?driver=${x.momPhone.seatId}`, { token: x.momPhone.carToken, body: { stage: 'soon', etaAt: '2026-11-15T18:05:00+09:00' } })).body).toEqual({ notified: true });
    const notes = () => inbox(x.t, x.dadPhone.seatId);
    expect(notes().map((n) => n.data.etaAt ?? n.body)).toEqual(['전달했어요', '출발했어요', '2026-11-15T09:05:00.000Z']);
    x.t.clock.ms += ETA_NOTIFICATION_TTL_MS - 1;
    expect(notes()).toHaveLength(3);
    x.t.clock.ms += 1;
    expect(notes().map((n) => n.body)).toEqual(['전달했어요', '출발했어요']); // etaAt이 든 알림만 사라짐
    expect(NOTIFICATION_TTL_MS).toBeGreaterThan(ETA_NOTIFICATION_TTL_MS);
    // ack하면 즉시 사라진다
    const req2 = await send(x.t, x.dad, appointmentBody({ memberId: x.mom.memberId }, { at: '2026-11-16T10:00:00+09:00' }));
    for (const status of ['delivered', 'accepted']) await patch(x.t, x.momPhone.carToken!, x.momPhone.seatId, req2.id, status);
    await call(x.t, 'POST', `/requests/${req2.id}/eta?driver=${x.momPhone.seatId}`, { token: x.momPhone.carToken, body: { stage: 'soon', etaAt: '2026-11-16T10:05:00+09:00' } });
    const soon = notes().find((n) => n.data.etaAt !== undefined)!;
    expect((await call(x.t, 'POST', '/notifications/ack', { token: x.dadPhone.phoneToken, body: { ids: [soon.id] } })).body).toEqual({ acked: 1 });
    expect(notes().filter((n) => n.data.etaAt !== undefined)).toEqual([]);
  });

  it('약속·픽업의 시각이 이미 지난 시각이면 400(약간의 여유는 허용)', async () => {
    const x = await twoOnOneCar();
    const post = (body: unknown) => call(x.t, 'POST', '/requests', { ...as(x.dad), body });
    const at = (ms: number) => new Date(x.t.clock.ms + ms).toISOString();
    expect((await post(appointmentBody({ memberId: x.mom.memberId }, { at: at(-PAST_AT_LEEWAY_MS) }))).status).toBe(200);
    expect((await post(rideBody({ memberId: x.mom.memberId }, { at: at(-PAST_AT_LEEWAY_MS + 1000) }))).status).toBe(200);
    const late = await post(appointmentBody({ memberId: x.mom.memberId }, { at: at(-PAST_AT_LEEWAY_MS - 1000) }));
    expect(late.status).toBe(400);
    expect(late.body.reason).toBe('bad-request');
    expect((await post(rideBody({ memberId: x.mom.memberId }, { at: '2026-11-15T08:00:00+09:00' }))).status).toBe(400);
    // 채비·들르기는 시각이 없고 date만 본다(오늘이면 받는다)
    expect((await post(careBody({ memberId: x.mom.memberId }))).status).toBe(200);
  });

  it('차에서 그 자리로 부르는 driver 판정은 자리 정하기 가드와 같다(같은 이름 여럿이면 첫 값, 빈 값·남의 자리는 403)', async () => {
    const x = await twoOnOneCar();
    const other = await connect(x.t, '다른차폰');
    const get = (query: string, token = x.momPhone.carToken) => call(x.t, 'GET', `/requests${query}`, { token });
    expect((await get(`?driver=${x.momPhone.seatId}&driver=${other.seatId}`)).status).toBe(200);
    expect((await get(`?driver=${other.seatId}&driver=${x.momPhone.seatId}`)).status).toBe(403);
    expect((await get('?driver=')).status).toBe(403);
    expect((await get('')).status).toBe(400);
    // 새 장소 API 가드(placeRead)도 같은 첫 값 규칙: 같은 쿼리로 같은 판정
    const place = (query: string) => call(x.t, 'GET', `/places/memory${query}`, { token: x.momPhone.carToken });
    expect((await place(`?driver=${x.momPhone.seatId}&driver=${other.seatId}`)).status).not.toBe(403);
    expect((await place(`?driver=${other.seatId}&driver=${x.momPhone.seatId}`)).status).toBe(403);
  });
});
