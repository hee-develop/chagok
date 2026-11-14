import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  canTransition,
  PATCHABLE_STATUSES,
  STATUSES,
  TRANSITIONS,
  type Category,
  type PatchableStatus,
  type Status,
} from '../src/family/requests.js';
import { pruneSilentSeats } from '../src/jobs.js';
import { createScheduler } from '../src/scheduler.js';
import { FAMILY_REQUESTS_EXPIRE_JOB, registerFamilyRequestJobs } from '../src/family/jobs.js';
import { MAX_REQUESTS_PER_MEMBER } from '../src/family/limits.js';
import {
  appointmentBody, as, bodyOf, call, careBody, connect, fresh, inbox, memberOnly, rideBody, stopBody, DAY, MINUTE, T0, type Fresh,
} from './familyHelpers.js';

type Phone = { phoneToken?: string; memberToken: string; seatId?: string; carToken?: string; memberId?: string };

/**
 * 가족: 엄마(차1 자리), 아빠(차1의 다른 자리), 아들(차2 자리), 삼촌(차에 연결 안 한 폰, 구성원 비밀값만).
 * 가족은 차와 따로 묶이므로 가족 만들기·참여는 차 연결과 따로 한다(연결한 폰은 폰 토큰을 같이 보내 자리를 묶는다).
 */
const setup = async () => {
  const t = fresh();
  const momPhone = await connect(t, '엄마폰');
  const dadPhone = await connect(t, '아빠폰', { carToken: momPhone.carToken });
  const kidPhone = await connect(t, '아들폰');
  const made = (await call(t, 'POST', '/family/invite', { token: momPhone.phoneToken, body: { name: '엄마' } })).body;
  const mom = { ...momPhone, memberToken: made.memberToken as string, memberId: made.family.me.memberId as string } as Phone;
  const joinAs = async (name: string, phone?: { phoneToken: string }) => {
    const res = await call(t, 'POST', '/family/join', { token: phone?.phoneToken, body: { code: made.code, name } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { memberToken: res.body.memberToken as string, memberId: res.body.family.me.memberId as string };
  };
  const dad = { ...dadPhone, ...(await joinAs('아빠', dadPhone)) } as Phone;
  const kid = { ...kidPhone, ...(await joinAs('아들', kidPhone)) } as Phone;
  const uncle = (await joinAs('삼촌')) as Phone;
  const family = (await call(t, 'GET', '/family', as(mom))).body.family;
  const carRef = (who: Phone) => family.cars.find((c: any) => c.memberIds.includes(who.memberId)).carRef as string;
  return { t, mom, dad, kid, uncle, family, carRef };
};
type Setup = Awaited<ReturnType<typeof setup>>;

const phoneCall = (t: Fresh, who: Phone, method: string, path: string, body?: unknown) => call(t, method, path, { ...as(who), body });
/** 차가 자리 하나를 대신해 부른다(차 토큰 + driver). */
const carCall = (t: Fresh, car: Phone, seat: Phone, method: string, path: string, body?: unknown) =>
  call(t, method, `${path}${path.includes('?') ? '&' : '?'}driver=${seat.seatId}`, { token: car.carToken, body });
const send = async (s: Setup, from: Phone, body: unknown) => {
  const res = await phoneCall(s.t, from, 'POST', '/requests', body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.request as any;
};
const share = (s: Setup, owner: Phone, viewer: Phone, enabled = true) =>
  phoneCall(s.t, owner, 'PUT', '/family/share', { memberId: viewer.memberId, enabled });
const carList = async (s: Setup, car: Phone, seat: Phone, query = '') => (await carCall(s.t, car, seat, 'GET', `/requests${query}`)).body.requests as any[];
const patch = (s: Setup, car: Phone, seat: Phone, id: string, status: string) => carCall(s.t, car, seat, 'PATCH', `/requests/${id}`, { status });

describe('POST /requests: 요청 4종 만들기와 검증', () => {
  it('채비·들르기·약속 가기·데려다주기를 만들면 상태는 보냄이고 받은 값이 정리되어 돌아온다', async () => {
    const s = await setup();
    const care = await send(s, s.mom, careBody({ memberId: s.dad.memberId }, { item: ' 우산  ', memo: '비 와요\n꼭!' }));
    expect(care).toMatchObject({
      category: 'care', item: '우산', timing: 'take-along', memo: '비 와요 꼭!', date: '2026-11-15', status: 'sent', reachable: true,
      from: { memberId: s.mom.memberId, name: '엄마' }, to: { kind: 'member', memberId: s.dad.memberId, name: '아빠' }, drivingNow: false, etaStage: null,
    });
    expect(care.createdAt).toBe(new Date(T0).toISOString());
    const stop = await send(s, s.mom, stopBody({ memberId: s.dad.memberId }, { deadline: { type: 'by', time: '17:30' }, date: '2026-11-16' }));
    expect(stop).toMatchObject({ category: 'stop', place: { text: '약국' }, item: '감기약', deadline: { type: 'by', time: '17:30' }, date: '2026-11-16', memo: null });
    const appointment = await send(s, s.mom, appointmentBody({ memberId: s.dad.memberId }));
    expect(appointment).toMatchObject({ category: 'appointment', at: '2026-11-15T09:00:00.000Z', place: { text: '광주 KIA 챔피언스필드', lat: 35.168, lng: 126.889 }, companions: ['동생'], date: '2026-11-15' });
    const ride = await send(s, s.mom, rideBody({ carRef: s.carRef(s.kid) }));
    expect(ride).toMatchObject({ category: 'ride', who: '민준', pickup: { text: '학원' }, dropoff: { text: '집' }, date: '2026-11-15', to: { kind: 'car', carRef: s.carRef(s.kid) } });
    // 받은 모양에서 차 id·토큰은 나오지 않는다
    expect(JSON.stringify([care, stop, appointment, ride])).not.toContain(s.kid.carToken as string);
    expect(JSON.stringify(ride)).not.toMatch(/carId/);
  });

  it('약속·픽업의 날짜는 시각(서울)에서 나오고, 요청은 오늘·내일만 받는다', async () => {
    const s = await setup();
    expect((await send(s, s.mom, appointmentBody({ memberId: s.dad.memberId }, { at: '2026-11-16T23:59:00+09:00' }))).date).toBe('2026-11-16');
    expect((await send(s, s.mom, appointmentBody({ memberId: s.dad.memberId }, { at: '2026-11-15T14:00:00Z' }))).date).toBe('2026-11-15'); // 23:00 서울
    expect((await send(s, s.mom, appointmentBody({ memberId: s.dad.memberId }, { at: '2026-11-15T15:00:00Z' }))).date).toBe('2026-11-16'); // 자정 서울
    for (const body of [
      appointmentBody({ memberId: s.dad.memberId }, { at: '2026-11-17T00:00:00+09:00' }),
      appointmentBody({ memberId: s.dad.memberId }, { at: '2026-11-14T23:59:00+09:00' }),
      careBody({ memberId: s.dad.memberId }, { date: '2026-11-14' }),
      careBody({ memberId: s.dad.memberId }, { date: '2026-11-17' }),
    ]) {
      const res = await phoneCall(s.t, s.mom, 'POST', '/requests', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('잘못된 본문은 400이고 아무것도 저장하지 않는다', async () => {
    const s = await setup();
    const to = { memberId: s.dad.memberId };
    const bad: [string, unknown][] = [
      ['객체 아님', ['care']],
      ['category 없음', { recipient: to, item: 'x', timing: 'take-along' }],
      ['알 수 없는 category', { ...careBody(to), category: 'gift' }],
      ['카테고리에 없는 항목', careBody(to, { place: { text: '집' } })],
      ['알 수 없는 항목', careBody(to, { hack: 1 })],
      ['채비 물건 없음', careBody(to, { item: undefined })],
      ['채비 물건 빈 글', careBody(to, { item: '   ' })],
      ['채비 물건 너무 김', careBody(to, { item: 'x'.repeat(61) })],
      ['채비 timing 잘못', careBody(to, { timing: 'now' })],
      ['메모 너무 김', careBody(to, { memo: 'x'.repeat(101) })],
      ['메모 숫자', careBody(to, { memo: 3 })],
      ['받는 사람 없음', { ...careBody(to), recipient: undefined }],
      ['받는 사람 둘', careBody({ memberId: s.dad.memberId, carRef: 'x' })],
      ['받는 사람 빈 객체', careBody({})],
      ['들르기 장소 없음', stopBody(to, { place: undefined })],
      ['장소 글자 없음', stopBody(to, { place: { lat: 1, lng: 2 } })],
      ['lat만', stopBody(to, { place: { text: '약국', lat: 35 } })],
      ['좌표 범위 밖', stopBody(to, { place: { text: '약국', lat: 91, lng: 2 } })],
      ['좌표 숫자 아님', stopBody(to, { place: { text: '약국', lat: '1', lng: '2' } })],
      ['장소에 알 수 없는 항목', stopBody(to, { place: { text: '약국', id: 'p1' } })],
      ['들르기 물건 없음', stopBody(to, { item: undefined })],
      ['기한 없음', stopBody(to, { deadline: undefined })],
      ['기한 시각 형식', stopBody(to, { deadline: { type: 'by', time: '25:00' } })],
      ['기한 종류', stopBody(to, { deadline: { type: 'week' } })],
      ['약속 시각 없음', appointmentBody(to, { at: undefined })],
      ['약속 시각 오프셋 없음', appointmentBody(to, { at: '2026-11-15T18:00:00' })],
      ['약속 date 항목', appointmentBody(to, { date: '2026-11-15' })],
      ['함께 가는 사람 배열 아님', appointmentBody(to, { companions: '동생' })],
      ['함께 가는 사람 너무 많음', appointmentBody(to, { companions: Array.from({ length: 11 }, (_, i) => `사람${i}`) })],
      ['함께 가는 사람 빈 이름', appointmentBody(to, { companions: [''] })],
      ['픽업 누구 없음', rideBody(to, { who: undefined })],
      ['픽업 출발지 없음', rideBody(to, { pickup: undefined })],
      ['픽업 도착지 없음', rideBody(to, { dropoff: undefined })],
      ['픽업 시각 없음', rideBody(to, { at: undefined })],
      ['픽업에 date', rideBody(to, { date: '2026-11-15' })],
    ];
    for (const [label, body] of bad) {
      const res = await phoneCall(s.t, s.mom, 'POST', '/requests', body);
      expect(res.status, label).toBe(400);
      expect(res.body.reason, label).toBe('bad-request');
    }
    expect(s.t.familyRequests.storedRequests()).toBe(0);
  });

  it('받는 사람 검증: 자기 자신·다른 가족·없는 사람·차가 아닌 가리킴값은 400, 가족이 없으면 409', async () => {
    const s = await setup();
    const strangerCar = await connect(s.t, '남의폰');
    const other = await call(s.t, 'POST', '/family/invite', { token: strangerCar.phoneToken, body: { name: '남' } });
    const stranger = other.body.family.members[0].memberId as string;
    const post = (from: Phone, recipient: unknown) => phoneCall(s.t, from, 'POST', '/requests', careBody(recipient));
    expect((await post(s.mom, { memberId: s.mom.memberId })).body.reason).toBe('self');
    expect((await post(s.mom, { memberId: stranger })).body.reason).toBe('unknown-recipient');
    expect((await post(s.mom, { memberId: 'nobody' })).body.reason).toBe('unknown-recipient');
    expect((await post(s.mom, { carRef: 'car-nope' })).body.reason).toBe('unknown-car');
    // 다른 가족의 차를 가리키는 값으로는 보낼 수 없다
    expect((await post(s.mom, { carRef: other.body.family.cars[0].carRef })).body.reason).toBe('unknown-car');
    const lonely = await connect(s.t, '혼자폰'); // 폰 토큰만 있고 구성원에게 묶이지 않음
    const noFamily = await phoneCall(s.t, { phoneToken: lonely.phoneToken } as Phone, 'POST', '/requests', careBody({ memberId: s.mom.memberId }));
    expect(noFamily.status).toBe(409);
    expect(noFamily.body.reason).toBe('not-in-family');
  });

  it('차에 연결하지 않은 폰(구성원 비밀값만)도 보낼 수 있고, 한 사람이 동시에 보낼 수 있는 요청 수에 상한이 있다', async () => {
    const s = await setup();
    for (let i = 0; i < MAX_REQUESTS_PER_MEMBER; i++) await send(s, s.uncle, careBody({ memberId: s.mom.memberId }));
    const over = await phoneCall(s.t, s.uncle, 'POST', '/requests', careBody({ memberId: s.mom.memberId }));
    expect(over.status).toBe(429);
    expect(over.body.reason).toBe('too-many-requests');
    await send(s, s.dad, careBody({ memberId: s.mom.memberId })); // 다른 사람은 영향 없다
  });
});

describe('전달 규칙', () => {
  it('사람에게 보낸 요청은 그 사람 폰이 연결된 자리로만 간다(같은 차의 다른 자리·다른 차에는 안 보임)', async () => {
    const s = await setup();
    const toMom = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    expect((await carList(s, s.mom, s.mom)).map((r) => r.id)).toEqual([toMom.id]);
    expect(await carList(s, s.mom, s.dad)).toEqual([]); // 같은 차의 아빠 자리
    expect(await carList(s, s.kid, s.kid)).toEqual([]); // 다른 차
    const row = (await carList(s, s.mom, s.mom))[0];
    expect(row).toMatchObject({ category: 'care', item: '우산', status: 'sent', via: 'seat', from: { name: '아빠' }, date: '2026-11-15', createdAt: toMom.createdAt });
    expect(Object.keys(row)).not.toContain('to');
  });

  it('받는 사람 폰이 어느 차에도 연결되지 않았으면 그 사람 폰 앱에만 보인다(차 조회에 안 나옴)', async () => {
    const s = await setup();
    const toUncle = await send(s, s.mom, stopBody({ memberId: s.uncle.memberId }));
    expect(toUncle.reachable).toBe(false);
    for (const [car, seat] of [[s.mom, s.mom], [s.mom, s.dad], [s.kid, s.kid]] as const) expect(await carList(s, car, seat)).toEqual([]);
    const received = (await phoneCall(s.t, s.uncle, 'GET', '/requests')).body.received;
    expect(received.map((r: any) => r.id)).toEqual([toUncle.id]);
    expect(received[0].from.name).toBe('엄마');
    // 삼촌이 나중에 차에 연결하면 그 자리로 간다
    // (삼촌의 비밀값과 새 폰 토큰이 같이 오는 요청에서 자리가 삼촌에게 묶인다)
    const phone = await connect(s.t, '삼촌폰');
    const unclePhone = { ...s.uncle, ...phone } as Phone;
    expect(await carList(s, unclePhone, unclePhone)).toEqual([]);
    expect((await phoneCall(s.t, unclePhone, 'GET', '/requests')).body.received[0].reachable).toBe(true);
    expect((await carList(s, unclePhone, unclePhone)).map((r) => r.id)).toEqual([toUncle.id]);
  });

  it("'우리 차'는 그 차의 어느 운전자 자리로 조회해도 포함되고 다른 차에는 없다", async () => {
    const s = await setup();
    const ours = await send(s, s.kid, rideBody({ carRef: s.carRef(s.mom) }));
    expect(ours.reachable).toBe(true);
    for (const seat of [s.mom, s.dad]) expect((await carList(s, s.mom, seat)).map((r) => [r.id, r.via])).toEqual([[ours.id, 'car']]);
    expect(await carList(s, s.kid, s.kid)).toEqual([]);
    // 우리 차 요청은 그 차에 연결된 가족의 '받은 요청'에 보인다(보낸 사람 본인은 보낸 쪽에만)
    for (const who of [s.mom, s.dad]) expect((await phoneCall(s.t, who, 'GET', '/requests')).body.received.map((r: any) => r.id)).toEqual([ours.id]);
    const kid = (await phoneCall(s.t, s.kid, 'GET', '/requests')).body;
    expect(kid.received).toEqual([]);
    expect(kid.sent.map((r: any) => r.id)).toEqual([ours.id]);
  });

  it('GET /requests?date=&driver=: 그날 것만, 끝나지 않은 것(보냄·전달·수락)만, 최근 것부터. date 기본은 오늘', async () => {
    const s = await setup();
    const a = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    s.t.clock.ms += MINUTE;
    const b = await send(s, s.dad, stopBody({ memberId: s.mom.memberId }));
    const tomorrow = await send(s, s.dad, careBody({ memberId: s.mom.memberId }, { date: '2026-11-16' }));
    const declined = await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId }));
    for (const status of ['delivered', 'declined']) expect((await patch(s, s.mom, s.mom, declined.id, status)).status).toBe(200);
    expect((await carList(s, s.mom, s.mom)).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await carList(s, s.mom, s.mom, '?date=2026-11-15')).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await carList(s, s.mom, s.mom, '?date=2026-11-16')).map((r) => r.id)).toEqual([tomorrow.id]);
    expect((await carList(s, s.mom, s.mom, '?date=2026-11-17'))).toEqual([]);
    const res = await carCall(s.t, s.mom, s.mom, 'GET', '/requests?date=2026-11-16');
    expect(res.body).toMatchObject({ driver: s.mom.seatId, date: '2026-11-16', serverTime: new Date(s.t.clock.ms).toISOString() });
    expect((await carCall(s.t, s.mom, s.mom, 'GET', '/requests?date=2026-02-30')).status).toBe(400);
    expect((await carCall(s.t, s.mom, s.mom, 'GET', '/requests?date=내일')).status).toBe(400);
  });

  it('폰 조회: 보낸 것과 받은 것을 나눠 주고 ?date= 로 그날만 준다', async () => {
    const s = await setup();
    const sent = await send(s, s.mom, careBody({ memberId: s.dad.memberId }));
    const later = await send(s, s.mom, careBody({ memberId: s.dad.memberId }, { date: '2026-11-16' }));
    const mine = (await phoneCall(s.t, s.mom, 'GET', '/requests')).body;
    expect(mine.sent.map((r: any) => r.id).sort()).toEqual([sent.id, later.id].sort());
    expect(mine.received).toEqual([]);
    expect((await phoneCall(s.t, s.mom, 'GET', '/requests?date=2026-11-16')).body.sent.map((r: any) => r.id)).toEqual([later.id]);
    expect((await phoneCall(s.t, s.dad, 'GET', '/requests')).body.received).toHaveLength(2);
    expect((await phoneCall(s.t, s.mom, 'GET', '/requests?date=bad')).status).toBe(400);
  });

  it('요청마다 만든 시각을 준다(주행 중에 온 요청을 말하지 않는 판단은 차의 몫)', async () => {
    const s = await setup();
    const early = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    s.t.clock.ms += 5 * MINUTE;
    const late = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    const rows = await carList(s, s.mom, s.mom);
    expect(rows.find((r) => r.id === early.id).createdAt).toBe(new Date(T0).toISOString());
    expect(rows.find((r) => r.id === late.id).createdAt).toBe(new Date(T0 + 5 * MINUTE).toISOString());
  });
});

describe('상태 전이 표', () => {
  /** 정책서 10.10 + docs/family-requests.md의 표를 그대로 옮긴 기대값(구현의 TRANSITIONS를 가져오지 않는다). */
  const EXPECTED: Record<Category, Record<Status, PatchableStatus[]>> = {
    care: { sent: ['delivered'], delivered: ['completed'], accepted: [], declined: [], completed: [] },
    stop: { sent: ['delivered'], delivered: ['accepted', 'declined', 'completed'], accepted: ['completed'], declined: [], completed: [] },
    appointment: { sent: ['delivered'], delivered: ['accepted', 'declined', 'completed'], accepted: ['completed'], declined: [], completed: [] },
    ride: { sent: ['delivered'], delivered: ['accepted', 'declined', 'completed'], accepted: ['completed'], declined: [], completed: [] },
  };
  /** 각 상태에 닿는 허용된 경로(차의 PATCH 순서). */
  const path = (category: Category, status: Status): PatchableStatus[] | null => {
    if (category === 'care' && (status === 'accepted' || status === 'declined')) return null; // 채비는 수락·거절에 닿을 수 없다
    if (status === 'sent') return [];
    if (status === 'delivered') return ['delivered'];
    if (status === 'accepted') return ['delivered', 'accepted'];
    if (status === 'declined') return ['delivered', 'declined'];
    return category === 'care' ? ['delivered', 'completed'] : ['delivered', 'accepted', 'completed'];
  };

  it('표(TRANSITIONS)가 기대값과 같다', () => {
    expect(TRANSITIONS).toEqual(EXPECTED);
    for (const category of CATEGORIES) for (const from of STATUSES) for (const to of PATCHABLE_STATUSES) expect(canTransition(category, from, to)).toBe(EXPECTED[category][from].includes(to));
  });

  it('도달할 수 있는 모든 (카테고리, 현재 상태) × 바꿀 상태 4의 조합이 표대로 동작한다(허용은 200, 같은 상태는 200 무변화, 그 밖은 409)', async () => {
    let combos = 0;
    for (const category of CATEGORIES) {
      for (const from of STATUSES) {
        const steps = path(category, from);
        if (steps === null) continue;
        const s = await setup(); // 보낸 사람 한 명의 동시 요청 상한을 넘지 않게 조합 묶음마다 새로 만든다
        for (const to of PATCHABLE_STATUSES) {
          const req = await send(s, s.dad, bodyOf(category, { memberId: s.mom.memberId }));
          for (const step of steps) expect((await patch(s, s.mom, s.mom, req.id, step)).status, `${category} 준비 ${step}`).toBe(200);
          const before = inbox(s.t, s.dad.seatId!).length;
          const res = await patch(s, s.mom, s.mom, req.id, to);
          const label = `${category}: ${from} → ${to}`;
          if (from === to) {
            expect(res.status, label).toBe(200);
            expect(res.body.changed, label).toBe(false);
            expect(inbox(s.t, s.dad.seatId!).length, `${label} 알림 없음`).toBe(before);
          } else if (EXPECTED[category][from].includes(to)) {
            expect(res.status, label).toBe(200);
            expect(res.body.changed, label).toBe(true);
            expect(res.body.request.status, label).toBe(to);
            expect(inbox(s.t, s.dad.seatId!).length, `${label} 알림 1건`).toBe(before + 1);
          } else {
            expect(res.status, label).toBe(409);
            expect(res.body).toMatchObject({ reason: 'invalid-transition', from, to });
            expect(inbox(s.t, s.dad.seatId!).length, `${label} 알림 없음`).toBe(before);
          }
          // 상태는 거절된 전이로 바뀌지 않았다
          const now = (await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent.find((r: any) => r.id === req.id);
          expect(now.status, label).toBe(from === to || !EXPECTED[category][from].includes(to) ? from : to);
          combos += 1;
        }
      }
    }
    expect(combos).toBe(72); // 채비는 3개 상태(보냄·전달·완료) × 4 + 나머지 3개 카테고리 × 5개 상태 × 4
  });

  it("'보냄'은 차가 되돌릴 수 없고 모르는 상태 값은 400이다", async () => {
    const s = await setup();
    const req = await send(s, s.dad, stopBody({ memberId: s.mom.memberId }));
    await patch(s, s.mom, s.mom, req.id, 'delivered');
    expect((await patch(s, s.mom, s.mom, req.id, 'sent')).status).toBe(400);
    expect((await patch(s, s.mom, s.mom, req.id, 'done')).status).toBe(400);
    expect((await carCall(s.t, s.mom, s.mom, 'PATCH', `/requests/${req.id}`, {})).status).toBe(400);
    expect((await carCall(s.t, s.mom, s.mom, 'PATCH', `/requests/${req.id}`, { status: 'accepted', reason: '피곤' })).status).toBe(400);
    expect((await carCall(s.t, s.mom, s.mom, 'PATCH', `/requests/${req.id}`, { status: 'declined', reply: '다음에' })).status).toBe(400);
  });

  it('전이 규칙은 차에서 온 요청도 같다(우리 차 요청의 수락·완료)', async () => {
    const s = await setup();
    const req = await send(s, s.kid, rideBody({ carRef: s.carRef(s.mom) }));
    for (const [seat, status] of [[s.dad, 'delivered'], [s.mom, 'accepted'], [s.dad, 'completed']] as const) {
      expect((await patch(s, s.mom, seat, req.id, status)).status).toBe(200);
    }
    expect((await patch(s, s.mom, s.mom, req.id, 'declined')).status).toBe(409);
  });
});

describe('PATCH·eta의 권한과 자리 격리', () => {
  it('받는 사람이 아닌 차·자리는 바꿀 수 없다(없는 요청과 같은 404)', async () => {
    const s = await setup();
    const req = await send(s, s.mom, stopBody({ memberId: s.dad.memberId }));
    for (const [car, seat] of [[s.mom, s.mom], [s.kid, s.kid], [s.mom, s.dad]] as const) {
      if (car === s.mom && seat === s.dad) continue; // 받는 사람 자리
      const res = await patch(s, car, seat, req.id, 'delivered');
      expect(res.status, `${seat.seatId}`).toBe(404);
      expect(res.body.reason).toBe('not-found');
    }
    expect((await patch(s, s.mom, s.dad, req.id, 'delivered')).status).toBe(200);
    expect((await patch(s, s.mom, s.mom, 'nope', 'delivered')).status).toBe(404);
    expect((await carCall(s.t, s.mom, s.dad, 'POST', `/requests/${req.id}/eta`, { stage: 'soon' })).status).toBe(409); // 약속·픽업이 아님
    expect((await carCall(s.t, s.kid, s.kid, 'POST', `/requests/${req.id}/eta`, { stage: 'soon' })).status).toBe(404);
  });

  it("'우리 차' 요청은 그 차만 바꾼다(다른 차는 404)", async () => {
    const s = await setup();
    const req = await send(s, s.dad, appointmentBody({ carRef: s.carRef(s.kid) }));
    expect((await patch(s, s.mom, s.mom, req.id, 'delivered')).status).toBe(404);
    expect((await patch(s, s.kid, s.kid, req.id, 'delivered')).status).toBe(200);
  });

  it('다른 가족의 요청은 읽지도 바꾸지도 못한다', async () => {
    const s = await setup();
    const req = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    const strangerPhone = await connect(s.t, '남의폰');
    const strangerMade = await call(s.t, 'POST', '/family/invite', { token: strangerPhone.phoneToken, body: { name: '남' } });
    const stranger = { ...strangerPhone, memberToken: strangerMade.body.memberToken } as Phone;
    expect((await phoneCall(s.t, stranger, 'GET', '/requests')).body).toMatchObject({ sent: [], received: [] });
    expect(await carList(s, stranger, stranger)).toEqual([]);
    expect((await patch(s, stranger, stranger, req.id, 'delivered')).status).toBe(404);
    expect((await patch(s, s.mom, s.mom, req.id, 'delivered')).status).toBe(200);
  });

  it('식별: 차 토큰 없음·폰 토큰·모르는 토큰은 401, driver 없음은 400 driver-required, 그 차의 자리가 아니면 403', async () => {
    const s = await setup();
    const req = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    const url = `/requests/${req.id}`;
    const body = { status: 'delivered' };
    expect((await call(s.t, 'PATCH', `${url}?driver=${s.mom.seatId}`, { body })).status).toBe(401);
    expect((await call(s.t, 'PATCH', `${url}?driver=${s.mom.seatId}`, { token: s.mom.phoneToken, body })).status).toBe(401);
    expect((await call(s.t, 'PATCH', `${url}?driver=${s.mom.seatId}`, { member: s.mom.memberToken, body })).status).toBe(401);
    expect((await call(s.t, 'PATCH', `${url}?driver=${s.mom.seatId}`, { token: 'f'.repeat(64), body })).status).toBe(401);
    const noDriver = await call(s.t, 'PATCH', url, { token: s.mom.carToken, body });
    expect(noDriver.status).toBe(400);
    expect(noDriver.body.reason).toBe('driver-required');
    // driver 판정은 자리 정하기 가드(seatScope.ts)와 같다: 빈 값·그 차의 자리가 아닌 값은 403, 같은 이름이 여럿이면 첫 값
    expect((await call(s.t, 'PATCH', `${url}?driver=`, { token: s.mom.carToken, body })).status).toBe(403);
    expect((await call(s.t, 'PATCH', `${url}?driver=a&driver=${s.mom.seatId}`, { token: s.mom.carToken, body })).status).toBe(403);
    expect((await call(s.t, 'PATCH', `${url}?driver=${s.mom.seatId}&driver=a`, { token: s.mom.carToken, body })).status).toBe(200);
    const foreign = await call(s.t, 'PATCH', `${url}?driver=${s.kid.seatId}`, { token: s.mom.carToken, body });
    expect(foreign.status).toBe(403);
    expect((await call(s.t, 'PATCH', `${url}?driver=nope`, { token: s.mom.carToken, body })).status).toBe(403);
    // 같은 규칙: GET /requests·eta·drive-state
    expect((await call(s.t, 'GET', '/requests', { token: s.mom.carToken })).body.reason).toBe('driver-required');
    expect((await call(s.t, 'GET', `/requests?driver=${s.kid.seatId}`, { token: s.mom.carToken })).status).toBe(403);
    expect((await call(s.t, 'POST', `${url}/eta`, { token: s.mom.carToken, body: { stage: 'soon' } })).status).toBe(400);
    expect((await call(s.t, 'POST', '/drive-state', { token: s.mom.carToken, body: { driving: true } })).status).toBe(400);
    expect((await call(s.t, 'POST', `/drive-state?driver=${s.kid.seatId}`, { token: s.mom.carToken, body: { driving: true } })).status).toBe(403);
    expect((await call(s.t, 'POST', `/drive-state?driver=${s.mom.seatId}`, { body: { driving: true } })).status).toBe(401);
  });

  it('옛 차 앱 호환 읽기(legacyDriverFallback)는 새 API에 적용되지 않는다: 식별 없는 요청은 실제 자리의 요청을 읽지 못한다', async () => {
    for (const legacyDriverFallback of [true, false]) {
      const s = await (async () => {
        const t = fresh({ legacyDriverFallback });
        const momPhone = await connect(t, '엄마폰');
        const made = (await call(t, 'POST', '/family/invite', { token: momPhone.phoneToken, body: { name: '엄마' } })).body;
        const mom = { ...momPhone, memberToken: made.memberToken, memberId: made.family.me.memberId } as Phone;
        const joined = (await call(t, 'POST', '/family/join', { body: { code: made.code, name: '아빠' } })).body;
        const dad = { memberToken: joined.memberToken, memberId: joined.family.me.memberId } as Phone;
        return { t, mom, dad };
      })();
      // 서버에 자리 있는 차가 정확히 하나 — 옛 호환이면 식별 없는 읽기가 그 자리를 볼 수 있는 상황
      await phoneCall(s.t, s.dad, 'POST', '/requests', careBody({ memberId: s.mom.memberId }));
      expect((await call(s.t, 'GET', '/requests')).status).toBe(401);
      expect((await call(s.t, 'GET', `/requests?driver=${s.mom.seatId}`)).status).toBe(401);
      const carOnly = await call(s.t, 'GET', '/requests', { token: s.mom.carToken });
      expect(carOnly.status).toBe(400); // 차 토큰만(driver 없음)으로 '그 차의 지난번 자리'를 고르지 않는다
      expect((await call(s.t, 'PATCH', '/requests/x', { body: { status: 'delivered' } })).status).toBe(401);
      expect((await call(s.t, 'POST', '/drive-state', { body: { driving: true } })).status).toBe(401);
      expect((await carCall(s.t, s.mom, s.mom, 'GET', '/requests')).body.requests).toHaveLength(1); // 명시한 자리는 읽힌다
    }
  });
});

describe('보낸 사람 폰 알림함 (family-status)', () => {
  it('전달·수락·거절·완료가 바뀔 때마다 보낸 사람에게만 알림이 가고 받는 사람 폰에는 가지 않는다', async () => {
    const s = await setup();
    const req = await send(s, s.dad, stopBody({ memberId: s.mom.memberId }));
    expect(inbox(s.t, s.dad.seatId!)).toEqual([]); // 보내기만으로는 알림이 없다
    await patch(s, s.mom, s.mom, req.id, 'delivered');
    await patch(s, s.mom, s.mom, req.id, 'accepted');
    await patch(s, s.mom, s.mom, req.id, 'completed');
    const notes = inbox(s.t, s.dad.seatId!);
    expect(notes.map((n) => [n.kind, n.title, n.body, n.data.status])).toEqual([
      ['family-status', '엄마에게 보낸 들르기', '전달했어요', 'delivered'],
      ['family-status', '엄마에게 보낸 들르기', '수락했어요', 'accepted'],
      ['family-status', '엄마에게 보낸 들르기', '들렀어요', 'completed'],
    ]);
    expect(notes[0]!.data).toEqual({ requestId: req.id, category: 'stop', status: 'delivered' });
    for (const who of [s.mom, s.kid]) expect(inbox(s.t, who.seatId!)).toEqual([]);
    // 폰이 읽는 알림함(GET /notifications)도 보낸 사람만 받는다
    expect((await call(s.t, 'GET', '/notifications', { token: s.dad.phoneToken })).body.notifications).toHaveLength(3);
    expect((await call(s.t, 'GET', '/notifications', { token: s.mom.phoneToken })).body.notifications).toEqual([]);
  });

  it("거절은 '이번엔 어려워요'만 가고 이유·답장 항목은 없다", async () => {
    const s = await setup();
    const req = await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId }));
    await patch(s, s.mom, s.mom, req.id, 'delivered');
    await patch(s, s.mom, s.mom, req.id, 'declined');
    const declined = inbox(s.t, s.dad.seatId!).at(-1)!;
    expect(declined.body).toBe('이번엔 어려워요');
    expect(declined.data).toEqual({ requestId: req.id, category: 'appointment', status: 'declined' });
    const view = (await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent[0];
    expect(view.status).toBe('declined');
    expect(Object.keys(view)).not.toContain('reason');
  });

  it('카테고리별 문구: 약속은 출발했어요·도착했어요, 픽업은 수락했어요·도착했어요, 채비는 전달했어요·챙기라고 전했어요. 우리 차는 "우리 차에 보낸"', async () => {
    const s = await setup();
    const run = async (category: 'care' | 'appointment' | 'ride', recipient: unknown, steps: PatchableStatus[], car: Phone, seat: Phone) => {
      const req = await send(s, s.kid, bodyOf(category, recipient));
      for (const step of steps) await patch(s, car, seat, req.id, step);
      return inbox(s.t, s.kid.seatId!).filter((n) => n.data.requestId === req.id).map((n) => [n.title, n.body]);
    };
    expect(await run('appointment', { memberId: s.mom.memberId }, ['delivered', 'accepted', 'completed'], s.mom, s.mom)).toEqual([
      ['엄마에게 보낸 약속 가기', '전달했어요'], ['엄마에게 보낸 약속 가기', '출발했어요'], ['엄마에게 보낸 약속 가기', '도착했어요'],
    ]);
    expect(await run('ride', { carRef: s.carRef(s.mom) }, ['delivered', 'accepted', 'completed'], s.mom, s.dad)).toEqual([
      ['우리 차에 보낸 데려다주기·픽업', '전달했어요'], ['우리 차에 보낸 데려다주기·픽업', '수락했어요'], ['우리 차에 보낸 데려다주기·픽업', '도착했어요'],
    ]);
    expect(await run('care', { memberId: s.mom.memberId }, ['delivered', 'completed'], s.mom, s.mom)).toEqual([
      ['엄마에게 보낸 채비', '전달했어요'], ['엄마에게 보낸 채비', '챙기라고 전했어요'],
    ]);
  });

  it('차에 연결하지 않은 보낸 사람(기기 id만)은 알림함이 없어 알림을 건너뛰고, 상태 조회로는 볼 수 있다', async () => {
    const s = await setup();
    const req = await send(s, s.uncle, careBody({ memberId: s.mom.memberId }));
    expect((await patch(s, s.mom, s.mom, req.id, 'delivered')).status).toBe(200);
    expect((await phoneCall(s.t, s.uncle, 'GET', '/requests')).body.sent[0].status).toBe('delivered');
    for (const who of [s.mom, s.dad, s.kid]) expect(inbox(s.t, who.seatId!)).toEqual([]);
  });

  it('같은 상태를 다시 보내도 알림은 한 번이고, 다른 요청의 알림과는 따로다', async () => {
    const s = await setup();
    const a = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    const b = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    await patch(s, s.mom, s.mom, a.id, 'delivered');
    await patch(s, s.mom, s.mom, a.id, 'delivered');
    await patch(s, s.mom, s.mom, b.id, 'delivered');
    expect(inbox(s.t, s.dad.seatId!).map((n) => n.data.requestId)).toEqual([a.id, b.id]);
  });
});

describe('도착 예정 공유와 eta·주행 중 표시', () => {
  const ready = async (category: 'appointment' | 'ride' = 'appointment') => {
    const s = await setup();
    const req = await send(s, s.dad, bodyOf(category, { memberId: s.mom.memberId }));
    await patch(s, s.mom, s.mom, req.id, 'delivered');
    await patch(s, s.mom, s.mom, req.id, 'accepted');
    return { s, req };
  };
  const eta = (s: Setup, id: string, body: unknown) => carCall(s.t, s.mom, s.mom, 'POST', `/requests/${id}/eta`, body);
  const senderNotes = (s: Setup) => inbox(s.t, s.dad.seatId!).filter((n) => n.data.stage !== undefined);

  it('공유를 켜지 않았으면(기본) eta는 받기만 하고 알림도 etaStage도 없다', async () => {
    const { s, req } = await ready();
    expect((await eta(s, req.id, { stage: 'soon', etaAt: '2026-11-15T18:05:00+09:00' })).body).toEqual({ notified: false });
    expect((await eta(s, req.id, { stage: 'arrived' })).body).toEqual({ notified: false });
    expect(senderNotes(s)).toEqual([]);
    expect((await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent[0].etaStage).toBeNull();
  });

  it('공유를 켜면 5분 전 알림이 가고(도착 예정 시각은 전달만, 저장 안 함) 끄면 멈춘다', async () => {
    const { s, req } = await ready();
    await share(s, s.mom, s.dad);
    const soon = await eta(s, req.id, { stage: 'soon', etaAt: '2026-11-15T18:05:00+09:00' });
    expect(soon.body).toEqual({ notified: true });
    const [note] = senderNotes(s);
    expect(note).toMatchObject({ kind: 'family-status', title: '엄마에게 보낸 약속 가기', body: '5분 뒤 도착해요' });
    expect(note!.data).toEqual({ requestId: req.id, category: 'appointment', status: 'accepted', stage: 'soon', etaAt: '2026-11-15T09:05:00.000Z' });
    // 보낸 사람 조회에는 단계만 있고 시각은 없다(가족에게 보인 도착 예정 시각은 저장하지 않는다)
    const view = (await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent[0];
    expect(view.etaStage).toBe('soon');
    expect(JSON.stringify(view)).not.toContain('18:05');
    expect(JSON.stringify(view)).not.toContain('09:05');
    // 받는 사람 폰에는 알림이 가지 않는다
    expect(inbox(s.t, s.mom.seatId!)).toEqual([]);
    // 같은 5분 전을 다시 보내도 알림은 한 번
    await eta(s, req.id, { stage: 'soon' });
    expect(senderNotes(s)).toHaveLength(1);
    // 공유를 끄면 단계도 가려지고, 새 요청의 eta는 알림이 없다
    await share(s, s.mom, s.dad, false);
    expect((await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent[0].etaStage).toBeNull();
    const other = await send(s, s.dad, rideBody({ memberId: s.mom.memberId }));
    await patch(s, s.mom, s.mom, other.id, 'delivered');
    expect((await eta(s, other.id, { stage: 'soon' })).body).toEqual({ notified: false });
    expect(senderNotes(s)).toHaveLength(1);
  });

  it('픽업은 "곧 도착해요", 도착(arrived)은 완료 알림과 합쳐져 두 번 울리지 않는다', async () => {
    const { s, req } = await ready('ride');
    await share(s, s.mom, s.dad);
    await eta(s, req.id, { stage: 'soon' });
    expect(senderNotes(s)[0]!.body).toBe('곧 도착해요');
    expect((await eta(s, req.id, { stage: 'arrived' })).body).toEqual({ notified: true });
    expect(senderNotes(s).at(-1)).toMatchObject({ body: '도착했어요', data: { stage: 'arrived' } });
    const before = inbox(s.t, s.dad.seatId!).length;
    expect((await patch(s, s.mom, s.mom, req.id, 'completed')).body.changed).toBe(true);
    expect(inbox(s.t, s.dad.seatId!)).toHaveLength(before); // 도착(eta)으로 이미 알렸다
    // 요청이 끝나면 공유도 끝난다: 끝난 요청의 eta는 받지 않는다
    expect((await eta(s, req.id, { stage: 'soon' })).status).toBe(409);
    expect((await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent[0].etaStage).toBeNull();
  });

  it('완료를 먼저 PATCH하면 완료 알림이 가고 뒤의 arrived는 두 번째 알림을 만들지 않는다(끝난 요청이라 409)', async () => {
    const { s, req } = await ready();
    await share(s, s.mom, s.dad);
    await patch(s, s.mom, s.mom, req.id, 'completed');
    expect(inbox(s.t, s.dad.seatId!).filter((n) => n.body === '도착했어요')).toHaveLength(1);
    expect((await eta(s, req.id, { stage: 'arrived' })).status).toBe(409);
  });

  it('eta는 약속 가기·데려다주기·픽업만, 전달된(전달·수락) 요청만 받는다', async () => {
    const s = await setup();
    await share(s, s.mom, s.dad);
    for (const category of ['care', 'stop'] as const) {
      const req = await send(s, s.dad, bodyOf(category, { memberId: s.mom.memberId }));
      await patch(s, s.mom, s.mom, req.id, 'delivered');
      const res = await eta(s, req.id, { stage: 'soon' });
      expect(res.status, category).toBe(409);
      expect(res.body.reason).toBe('not-eta-category');
    }
    const fresh1 = await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId }));
    const early = await eta(s, fresh1.id, { stage: 'soon' });
    expect(early.status).toBe(409);
    expect(early.body.reason).toBe('not-in-progress');
    await patch(s, s.mom, s.mom, fresh1.id, 'delivered');
    expect((await eta(s, fresh1.id, { stage: 'soon' })).status).toBe(200); // 전달만 된 약속도 진행 중
    await patch(s, s.mom, s.mom, fresh1.id, 'declined');
    expect((await eta(s, fresh1.id, { stage: 'soon' })).status).toBe(409);
    expect((await eta(s, 'nope', { stage: 'soon' })).status).toBe(404);
  });

  it('eta 본문 검증: stage와 etaAt', async () => {
    const { s, req } = await ready();
    for (const body of [{}, { stage: 'now' }, { stage: 'soon', extra: 1 }, { stage: 'soon', etaAt: '곧' }, { stage: 'soon', etaAt: '2026-11-15T18:05:00' }, { stage: 'arrived', etaAt: '2026-11-15T18:05:00+09:00' }, { stage: 'soon', etaAt: 5 }]) {
      expect((await eta(s, req.id, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("'우리 차'로 보낸 요청에는 도착 예정 공유가 없다(알림 없음)", async () => {
    const s = await setup();
    await share(s, s.mom, s.kid);
    const req = await send(s, s.kid, appointmentBody({ carRef: s.carRef(s.mom) }));
    await patch(s, s.mom, s.mom, req.id, 'delivered');
    expect((await carCall(s.t, s.mom, s.mom, 'POST', `/requests/${req.id}/eta`, { stage: 'soon' })).body).toEqual({ notified: false });
    expect(inbox(s.t, s.kid.seatId!).filter((n) => n.data.stage !== undefined)).toEqual([]);
  });

  describe('drive-state와 보냄 상태의 drivingNow', () => {
    const driveState = (s: Setup, seat: Phone, driving: unknown, car: Phone = s.mom) => carCall(s.t, car, seat, 'POST', '/drive-state', { driving });
    const drivingNow = async (s: Setup, id: string) => (await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent.find((r: any) => r.id === id).drivingNow;

    it('받는 사람이 공유를 켰고 지금 주행 중이면 보냄 상태에서 true, 그 밖에는 false(공유를 안 켰으면 주행 여부가 새지 않는다)', async () => {
      const s = await setup();
      const req = await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId }));
      expect(await drivingNow(s, req.id)).toBe(false);
      await driveState(s, s.mom, true);
      expect(await drivingNow(s, req.id)).toBe(false); // 공유 꺼짐 — 주행 중이어도 모른다
      expect(JSON.stringify((await phoneCall(s.t, s.dad, 'GET', '/requests')).body)).not.toContain('"drivingNow":true');
      await share(s, s.mom, s.dad);
      expect(await drivingNow(s, req.id)).toBe(true);
      await share(s, s.dad, s.mom); // 반대 방향(내가 상대에게 켠 것)은 상관없다
      await share(s, s.mom, s.dad, false);
      expect(await drivingNow(s, req.id)).toBe(false);
      await share(s, s.mom, s.dad, true);
      await driveState(s, s.mom, false);
      expect(await drivingNow(s, req.id)).toBe(false);
      await driveState(s, s.mom, true);
      expect(await drivingNow(s, req.id)).toBe(true);
      // 전달된 뒤에는 '보냄' 문구가 아니므로 false
      await patch(s, s.mom, s.mom, req.id, 'delivered');
      expect(await drivingNow(s, req.id)).toBe(false);
    });

    it('다른 자리의 주행은 상관없고(받는 사람 자리만), 차에 연결 안 한 받는 사람·우리 차는 늘 false', async () => {
      const s = await setup();
      await share(s, s.mom, s.dad);
      await share(s, s.uncle, s.dad);
      const toMom = await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId }));
      const toUncle = await send(s, s.dad, appointmentBody({ memberId: s.uncle.memberId }));
      const toCar = await send(s, s.dad, appointmentBody({ carRef: s.carRef(s.mom) }));
      await driveState(s, s.dad, true); // 아빠(보낸 사람 자신)의 자리가 달리는 중
      await driveState(s, s.kid, true, s.kid);
      for (const r of [toMom, toUncle, toCar]) expect(await drivingNow(s, r.id)).toBe(false);
      await driveState(s, s.mom, true);
      expect(await drivingNow(s, toMom.id)).toBe(true);
      expect(await drivingNow(s, toUncle.id)).toBe(false);
      expect(await drivingNow(s, toCar.id)).toBe(false);
    });

    it('주행 상태는 그날까지만 유효하다(날짜가 바뀌면 주행 중이 아님), 자리가 끊기면 지워진다', async () => {
      const s = await setup();
      await share(s, s.mom, s.dad);
      const req = await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId }, { at: '2026-11-16T10:00:00+09:00' }));
      await driveState(s, s.mom, true);
      expect(await drivingNow(s, req.id)).toBe(true);
      s.t.clock.ms += DAY; // 다음 날 10시: 어제 값
      expect(await drivingNow(s, req.id)).toBe(false);
      await driveState(s, s.mom, true);
      expect(await drivingNow(s, req.id)).toBe(true);
      await call(s.t, 'DELETE', '/pair', as(s.mom));
      expect(await drivingNow(s, req.id)).toBe(false);
    });

    it('drivingNow는 약속 가기·데려다주기·픽업에서만 계산한다(채비·들르기는 공유를 켜고 주행 중이어도 늘 false)', async () => {
      const s = await setup();
      await share(s, s.mom, s.dad);
      await driveState(s, s.mom, true);
      const rows = {
        care: await send(s, s.dad, careBody({ memberId: s.mom.memberId })),
        stop: await send(s, s.dad, stopBody({ memberId: s.mom.memberId })),
        appointment: await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId })),
        ride: await send(s, s.dad, rideBody({ memberId: s.mom.memberId })),
      };
      expect(await drivingNow(s, rows.care.id)).toBe(false);
      expect(await drivingNow(s, rows.stop.id)).toBe(false);
      expect(await drivingNow(s, rows.appointment.id)).toBe(true);
      expect(await drivingNow(s, rows.ride.id)).toBe(true);
    });

    it('POST /drive-state: 바뀔 때만 바뀐 시각을 새로 하고, 위치 같은 다른 항목은 받지 않는다', async () => {
      const s = await setup();
      const first = await driveState(s, s.mom, true);
      expect(first.body).toEqual({ seatId: s.mom.seatId, driving: true, changedAt: new Date(T0).toISOString() });
      s.t.clock.ms += 3 * MINUTE;
      expect((await driveState(s, s.mom, true)).body.changedAt).toBe(new Date(T0).toISOString());
      expect((await driveState(s, s.mom, false)).body).toEqual({ seatId: s.mom.seatId, driving: false, changedAt: new Date(T0 + 3 * MINUTE).toISOString() });
      for (const body of [{}, { driving: 'yes' }, { driving: true, lat: 35.1 }, { driving: true, lng: 126.8 }]) {
        expect((await carCall(s.t, s.mom, s.mom, 'POST', '/drive-state', body)).status, JSON.stringify(body)).toBe(400);
      }
    });
  });
});

describe('보관: 날짜가 지나면 삭제(완료·거절도 그날까지 보관)', () => {
  it('날짜가 지난 요청은 조회에서 보이지 않고 purge(정기 작업)가 지운다. 내일 날짜 요청은 남는다', async () => {
    const s = await setup();
    const today = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    const tomorrow = await send(s, s.dad, careBody({ memberId: s.mom.memberId }, { date: '2026-11-16' }));
    expect(s.t.familyRequests.purge(new Date(s.t.clock.ms)).requests).toBe(0);
    // 같은 날 23:59:59까지는 남는다
    s.t.clock.ms = Date.parse('2026-11-15T23:59:59+09:00');
    expect((await carList(s, s.mom, s.mom)).map((r) => r.id)).toEqual([today.id]);
    expect(s.t.familyRequests.purge(new Date(s.t.clock.ms)).requests).toBe(0);
    // 자정이 지나면 보이지 않는다(정기 작업이 아직 안 돌았어도)
    s.t.clock.ms = Date.parse('2026-11-16T00:00:00+09:00');
    expect(s.t.familyRequests.storedRequests()).toBe(2);
    expect((await carList(s, s.mom, s.mom, '?date=2026-11-15'))).toEqual([]);
    expect((await carList(s, s.mom, s.mom)).map((r) => r.id)).toEqual([tomorrow.id]); // 오늘(16일)이 된 요청
    expect((await patch(s, s.mom, s.mom, today.id, 'delivered')).status).toBe(404);
    expect((await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent.map((r: any) => r.id)).toEqual([tomorrow.id]);
    expect((await carList(s, s.mom, s.mom, '?date=2026-11-16')).map((r) => r.id)).toEqual([tomorrow.id]);
    const purged = s.t.familyRequests.purge(new Date(s.t.clock.ms));
    expect(purged.requests).toBe(1);
    expect(s.t.familyRequests.storedRequests()).toBe(1);
    expect(s.t.familyRequests.purge(new Date(s.t.clock.ms)).requests).toBe(0); // 자주 불려도 안전
    // 끝나지 않은 채 날짜가 지난 약속(수락됨)도 지운다
    const a = await send(s, s.dad, appointmentBody({ memberId: s.mom.memberId }, { at: '2026-11-16T09:00:00+09:00' }));
    await patch(s, s.mom, s.mom, a.id, 'delivered');
    s.t.clock.ms += DAY;
    expect(s.t.familyRequests.purge(new Date(s.t.clock.ms)).requests).toBe(2);
    expect(s.t.familyRequests.storedRequests()).toBe(0);
  });

  it('스케줄러에 등록한 작업이 주입한 시계로 날짜 지난 요청을 지운다(자주 돌아도 안전)', async () => {
    const s = await setup();
    const now = () => new Date(s.t.clock.ms);
    const scheduler = createScheduler({ now });
    registerFamilyRequestJobs(scheduler, s.t.familyRequests);
    expect(scheduler.jobNames()).toEqual([FAMILY_REQUESTS_EXPIRE_JOB]);
    await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    await send(s, s.dad, careBody({ memberId: s.mom.memberId }, { date: '2026-11-16' }));
    await scheduler.tick();
    expect(s.t.familyRequests.storedRequests()).toBe(2);
    s.t.clock.ms = Date.parse('2026-11-16T05:00:00+09:00'); // 다음 날 새벽
    await scheduler.tick();
    await scheduler.tick();
    expect(s.t.familyRequests.storedRequests()).toBe(1);
    s.t.clock.ms = Date.parse('2026-11-17T00:00:00+09:00');
    await scheduler.tick();
    expect(s.t.familyRequests.storedRequests()).toBe(0);
  });

  it('주입한 시계로 서울 날짜를 판정한다: UTC 날짜가 같아도 서울 자정이 지나면 지운다', async () => {
    const s = await setup();
    s.t.clock.ms = Date.parse('2026-11-15T14:30:00Z'); // 서울 23:30
    const req = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    expect(req.date).toBe('2026-11-15');
    s.t.clock.ms = Date.parse('2026-11-15T15:00:00Z'); // 서울 자정, UTC는 아직 15일
    expect(s.t.familyRequests.purge(new Date(s.t.clock.ms)).requests).toBe(1);
  });

  it('완료·거절된 요청은 모두 그날(서울 날짜)이 끝날 때까지 두어 보낸 사람이 상태를 볼 수 있다(정책서 원문 \'완료되면 삭제\'와 다른 점, 문서에 이유)', async () => {
    const s = await setup();
    const done = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    const declined = await send(s, s.dad, stopBody({ memberId: s.mom.memberId }));
    for (const step of ['delivered', 'completed']) await patch(s, s.mom, s.mom, done.id, step);
    for (const step of ['delivered', 'declined']) await patch(s, s.mom, s.mom, declined.id, step);
    const statuses = async () => (await phoneCall(s.t, s.dad, 'GET', '/requests')).body.sent.map((r: any) => [r.id, r.status]).sort();
    s.t.clock.ms += 13 * 60 * MINUTE; // 같은 날 22:59
    expect(await statuses()).toEqual([[done.id, 'completed'], [declined.id, 'declined']].sort());
    expect(s.t.familyRequests.purge(new Date(s.t.clock.ms)).requests).toBe(0);
    s.t.clock.ms = Date.parse('2026-11-16T00:00:00+09:00');
    expect(await statuses()).toEqual([]);
    expect(s.t.familyRequests.purge(new Date(s.t.clock.ms)).requests).toBe(2);
  });
});

describe('자리 이벤트와 요청', () => {
  it('받는 사람의 차 연결이 끊기면 요청은 차 조회에서 빠지고 앱에만 남는다(요청은 지워지지 않는다)', async () => {
    const s = await setup();
    const req = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    expect(await carList(s, s.mom, s.mom)).toHaveLength(1);
    await call(s.t, 'DELETE', '/pair', as(s.mom));
    const received = (await call(s.t, 'GET', '/requests', memberOnly(s.mom))).body.received;
    expect(received.map((r: any) => [r.id, r.reachable])).toEqual([[req.id, false]]);
  });

  it('차곡 초기화(DELETE /car)는 자리를 지우지만 가족·요청은 구성원 비밀값으로 남는다', async () => {
    const s = await setup();
    const req = await send(s, s.dad, careBody({ memberId: s.mom.memberId }));
    expect((await call(s.t, 'DELETE', '/car', { token: s.mom.carToken })).status).toBe(200);
    expect((await call(s.t, 'GET', '/requests', memberOnly(s.mom))).body.received.map((r: any) => r.id)).toEqual([req.id]);
    expect((await call(s.t, 'GET', '/requests', memberOnly(s.dad))).body.sent[0].reachable).toBe(false);
    expect((await call(s.t, 'GET', '/family', memberOnly(s.mom))).body.family.members).toHaveLength(4);
  });
});

describe('J6 정기 정리와 가족 저장소(자리 삭제 이벤트)', () => {
  it('무소식 자리 정리(pruneSilentSeats)가 자리를 지우면 가족 저장소도 같은 removed 이벤트로 정리된다: 그 차 앞 요청은 지우고 구성원·구성원 앞 요청은 남긴다', async () => {
    const s = await setup();
    const toKidCar = await send(s, s.dad, rideBody({ carRef: s.carRef(s.kid) }));
    const toKidMember = await send(s, s.mom, careBody({ memberId: s.kid.memberId }));
    expect(await carList(s, s.kid, s.kid)).toHaveLength(2);
    const stored = s.t.familyRequests.storedRequests();

    // 엄마·아빠는 2시간 반 뒤 일정을 보내고, 아들 폰만 조용하다. 3시간 뒤 '2시간 무소식' 기준으로 정리한다(같은 날이라 요청 날짜는 그대로).
    s.t.clock.ms = T0 + 150 * MINUTE;
    for (const who of [s.mom, s.dad]) expect((await call(s.t, 'PUT', '/events', { token: who.phoneToken, body: { events: [] } })).status).toBe(200);
    s.t.clock.ms = T0 + 180 * MINUTE;
    const removed = pruneSilentSeats({ seats: s.t.seats, now: new Date(s.t.clock.ms), afterMs: 120 * MINUTE });
    expect(removed).toEqual([s.kid.seatId]);
    expect(s.t.seats.seat(s.kid.seatId as string)).toBeNull();

    // 가족 저장소: 아들 차 앞으로 간 요청은 지워지고(차에 아들 자리가 없어짐), 아들 앞 요청과 구성원은 구성원 비밀값으로 남는다.
    expect(s.t.familyRequests.storedRequests()).toBe(stored - 1);
    const received = (await call(s.t, 'GET', '/requests', memberOnly(s.kid))).body.received as any[];
    expect(received.map((r) => [r.id, r.reachable])).toEqual([[toKidMember.id, false]]);
    expect(received.some((r) => r.id === toKidCar.id)).toBe(false);
    expect((await call(s.t, 'GET', '/family', memberOnly(s.mom))).body.family.members).toHaveLength(4);
    // 다른 자리(엄마·아빠)는 그대로다.
    expect(s.t.seats.seat(s.mom.seatId as string)).not.toBeNull();
    expect(s.t.seats.seat(s.dad.seatId as string)).not.toBeNull();
    expect((await call(s.t, 'GET', '/pair', as(s.mom))).status).toBe(200);
  });
});

describe('기존 일정 보내기(픽스처 가족)는 그대로', () => {
  it('POST /schedules/:id/family-request는 전달됨으로 저장하고 새 가족·요청과 섞이지 않는다', async () => {
    const t = fresh();
    const res = await call(t, 'POST', '/schedules/gwangju-kia/family-request', { body: { memberId: 'family-mom' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'gwangju-kia:family-mom', memberId: 'family-mom', status: 'delivered' });
    expect((await call(t, 'GET', '/family/requests')).body.requests).toHaveLength(1);
    // 새 가족에는 픽스처 가족의 id를 받는 사람으로 쓸 수 없다
    const { family, memberToken } = (await call(t, 'POST', '/family/invite', { body: { name: '엄마' } })).body;
    expect(family.members).toHaveLength(1);
    const bad = await call(t, 'POST', '/requests', { member: memberToken, body: careBody({ memberId: 'family-mom' }) });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('unknown-recipient');
    expect((await call(t, 'GET', '/requests', { member: memberToken })).body).toMatchObject({ sent: [], received: [] });
  });
});
