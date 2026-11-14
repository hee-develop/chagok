import { describe, expect, it } from 'vitest';
import { parseFamilyMembers } from '../src/fixtures.js';
import { newApp } from './helpers.js';

type App = ReturnType<typeof newApp>;
type Request = { id: string; scheduleId: string; memberId: string; memberName: string; title: string; locationText: string | null; place: unknown; care: string | null; status: string; sentAt: string };

/** 시계를 고정한다(보낸 시각 확인용). 픽스처 일정은 이 시각 기준 상대 시각이다. */
let clockMs = Date.parse('2026-11-06T09:20:00+09:00');
const makeApp = () => {
  clockMs = Date.parse('2026-11-06T09:20:00+09:00');
  return newApp({ now: () => new Date(clockMs) });
};
const send = (app: App, scheduleId: string, body: unknown) =>
  app.request(`/schedules/${scheduleId}/family-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const requests = async (app: App, query = '') => ((await (await app.request(`/family/requests${query}`)).json()) as { requests: Request[] }).requests;
const placeRow = async (app: App, id: string) =>
  ((await (await app.request('/schedules/places')).json()) as { schedules: { id: string; familyRequests: unknown[] }[] }).schedules.find((s) => s.id === id)!;

describe('가족', () => {
  it('미리 묶어 둔 가족을 내려준다', async () => {
    const res = await makeApp().request('/family/members');
    expect(await res.json()).toEqual({ members: [{ id: 'family-mom', name: '엄마' }, { id: 'family-brother', name: '동생' }] });
  });

  it('가족 목록은 한 명 이상이고 id·이름이 있으며 id가 겹치지 않아야 한다', () => {
    expect(() => parseFamilyMembers({ members: [] })).toThrow();
    expect(() => parseFamilyMembers({ members: [{ id: 'a', name: '' }] })).toThrow();
    expect(() => parseFamilyMembers({ members: [{ id: 'a', name: '엄마' }, { id: 'a', name: '아빠' }] })).toThrow();
    expect(parseFamilyMembers({ members: [{ id: 'a', name: '엄마', extra: 1 }] })).toEqual([{ id: 'a', name: '엄마' }]);
  });
});

describe('POST /schedules/:id/family-request', () => {
  it('보낼 때의 일정 내용(보정한 주소·채비)을 담아 전달됨으로 저장하고 3단계 응답에 상태를 싣는다', async () => {
    const app = makeApp();
    await app.request('/schedules/gwangju-kia/care', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ care: '유니폼·티켓' }) });
    const res = await send(app, 'gwangju-kia', { memberId: 'family-brother' });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as Request;
    expect(saved).toMatchObject({
      id: 'gwangju-kia:family-brother', scheduleId: 'gwangju-kia', memberId: 'family-brother', memberName: '동생', title: 'KIA 직관',
      locationText: '광주-기아 챔피언스필드', care: '유니폼·티켓', status: 'delivered', sentAt: '2026-11-06T00:20:00.000Z',
    });
    expect(saved.place).toMatchObject({ name: '광주-기아 챔피언스필드' });
    expect((await placeRow(app, 'gwangju-kia')).familyRequests).toEqual([
      { memberId: 'family-brother', name: '동생', status: 'delivered', sentAt: '2026-11-06T00:20:00.000Z' },
    ]);
    expect((await placeRow(app, 'gwangju-lunch')).familyRequests).toEqual([]);
  });

  it('같은 일정을 같은 가족에게 다시 보내면 하나로 두고 내용과 보낸 시각을 새로 한다. 다른 가족은 따로 둔다', async () => {
    const app = makeApp();
    await send(app, 'gwangju-kia', { memberId: 'family-mom' });
    clockMs += 60_000;
    await app.request('/schedules/gwangju-kia/care', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ care: '티켓' }) });
    await send(app, 'gwangju-kia', { memberId: 'family-mom' });
    clockMs += 60_000;
    await send(app, 'gwangju-lunch', { memberId: 'family-brother' });
    const all = await requests(app);
    expect(all.map((r) => r.id)).toEqual(['gwangju-lunch:family-brother', 'gwangju-kia:family-mom']); // 최근 보낸 것 먼저
    expect(all[1]).toMatchObject({ care: '티켓', sentAt: '2026-11-06T00:21:00.000Z' });
    expect((await requests(app, '?scheduleId=gwangju-kia')).map((r) => r.memberId)).toEqual(['family-mom']);
  });

  it.each([null, [], {}, { memberId: 1 }, { memberId: 'stranger' }, { memberId: 'family-mom', extra: true }])('잘못된 본문 %j는 400이고 저장하지 않는다', async (body) => {
    const app = makeApp();
    expect((await send(app, 'gwangju-kia', body)).status).toBe(400);
    expect(await requests(app)).toEqual([]);
  });

  it('없거나 선택하지 않은 캘린더의 일정은 404, 종일 일정은 409', async () => {
    const app = makeApp();
    expect((await send(app, 'unknown', { memberId: 'family-mom' })).status).toBe(404);
    expect((await send(app, 'gwangju-kia-doosan', { memberId: 'family-mom' })).status).toBe(404);
    expect((await send(app, 'gwangju-allday', { memberId: 'family-mom' })).status).toBe(409);
    expect(await requests(app)).toEqual([]);
  });

  it('잘못된 scheduleId 조회는 400, 앱 인스턴스마다 따로 가진다', async () => {
    const app = makeApp();
    expect((await app.request(`/family/requests?scheduleId=${'x'.repeat(101)}`)).status).toBe(400);
    await send(app, 'gwangju-kia', { memberId: 'family-mom' });
    expect(await requests(makeApp())).toEqual([]);
  });
});
