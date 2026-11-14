import { describe, expect, it } from 'vitest';
import { createSelectionStore } from '../src/routes/calendars.js';
import { parseDayFixture } from '../src/fixtures.js';
import { calendars, catalog, fixture, newApp } from './helpers.js';

const makeApp = () => newApp();
const put = (app: ReturnType<typeof newApp>, id: string, body: unknown) => app.request(`/schedules/${id}/place`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
type Row = { id: string; place: unknown; noTravel?: boolean; locationText: string | null; suggestion?: { placeId: string; name: string } | null };
const get = async (app: ReturnType<typeof newApp>, path = 'places') => (await app.request(`/schedules/${path}?at=2026-11-06T00%3A20%3A00Z`)).json() as Promise<{ schedules: Row[] }>;
const row = (rows: Row[], id: string) => rows.find((s) => s.id === id)!;

describe('일정별 장소 보정', () => {
  it('선택한 캘린더의 일반 일정만 시작순으로 보여 주고 빈 일정 두 개를 계산할 수 있다', async () => {
    const { schedules } = await get(makeApp());
    expect(schedules.map((s) => s.id)).toEqual(['gwangju-lunch', 'gwangju-kia', 'gwangju-kongmul', 'gwangju-friend', 'gwangju-dentist']);
    expect(schedules.filter((s) => !s.place && !s.noTravel).map((s) => s.id)).toEqual(['gwangju-friend', 'gwangju-dentist']);
  });

  it('일정 하나를 채우면 폰 재조회와 차량 응답에 같은 좌표가 반영되며 원본·다른 일정은 그대로다', async () => {
    const app = makeApp();
    const before = await get(app);
    const p = catalog.places[0];
    const expected = { name: p.name, lat: p.lat, lng: p.lng };
    const response = await put(app, 'gwangju-friend', { placeId: p.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'gwangju-friend', place: expected, locationText: p.name, noTravel: false, noTravelReason: null });
    expect(row((await get(app)).schedules, 'gwangju-friend').place).toEqual(expected);
    expect(row((await get(app, 'today')).schedules, 'gwangju-friend').place).toEqual(expected);
    expect((await get(app)).schedules.filter((s) => s.id !== 'gwangju-friend')).toEqual(before.schedules.filter((s) => s.id !== 'gwangju-friend'));
    expect(fixture.schedules.find((s) => s.id === 'gwangju-friend')?.place).toBeNull();
    expect(row((await get(makeApp())).schedules, 'gwangju-friend').place).toBeNull();
  });

  it('이동 없음은 차량에서 제외되고 재전송해도 같으며 장소를 넣으면 복원된다', async () => {
    const app = makeApp();
    for (let i = 0; i < 2; i++) expect((await put(app, 'gwangju-friend', { noTravel: true })).status).toBe(200);
    expect(row((await get(app)).schedules, 'gwangju-friend')).toMatchObject({ place: null, noTravel: true });
    expect((await get(app, 'today')).schedules.map((s) => s.id)).not.toContain('gwangju-friend');
    await put(app, 'gwangju-friend', { placeId: catalog.places[0].id });
    expect((await get(app, 'today')).schedules.map((s) => s.id)).toContain('gwangju-friend');
    await put(app, 'gwangju-friend', { placeId: null });
    expect(row((await get(app)).schedules, 'gwangju-friend')).toMatchObject({ place: null, noTravel: false });
  });

  it.each([null, [], {}, { placeId: 'unknown' }, { placeId: 1 }, { placeId: '' }, { noTravel: false }, { noTravel: true, placeId: 'x' }, { placeId: null, extra: true }])('잘못된 변경 %j는 400이고 저장하지 않는다', async (body) => {
    const app = makeApp();
    expect((await put(app, 'gwangju-friend', body)).status).toBe(400);
    expect(row((await get(app)).schedules, 'gwangju-friend')).toMatchObject({ place: null, noTravel: false });
  });

  it('알 수 없는 일정·선택 해제한 일정은 404, 종일은 409', async () => {
    const app = makeApp();
    expect((await put(app, 'unknown', { noTravel: true })).status).toBe(404);
    expect((await put(app, 'gwangju-kia-doosan', { noTravel: true })).status).toBe(404);
    expect((await put(app, 'gwangju-allday', { noTravel: true })).status).toBe(409);
  });

  it('선택이 바뀌면 숨겨지고 다시 선택하면 보정값을 복원한다', async () => {
    const store = createSelectionStore();
    const app = newApp({ store });
    await put(app, 'gwangju-friend', { placeId: catalog.places[0].id });
    const select = (selectedIds: string[], revision: number) => app.request('/calendars/selection', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedIds, revision }) });
    await select([], 1);
    expect((await get(app)).schedules).toEqual([]);
    expect((await put(app, 'gwangju-friend', { noTravel: true })).status).toBe(404);
    await select(['mock-my'], 2);
    expect(row((await get(app)).schedules, 'gwangju-friend').place).not.toBeNull();
  });

  it('잘못된 JSON과 큰 본문을 거절한다', async () => {
    const app = makeApp();
    expect((await app.request('/schedules/gwangju-friend/place', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
    expect((await put(app, 'gwangju-friend', { placeId: 'x'.repeat(70_000) })).status).toBe(413);
    expect((await app.request('/schedules/places?at=bad')).status).toBe(400);
  });
});

describe('기억한 장소 후보', () => {
  it('같은 제목의 장소 없는 일정에만 후보를 내고 나머지는 null이다', async () => {
    const { schedules } = await get(makeApp());
    expect(row(schedules, 'gwangju-dentist').suggestion).toEqual({ placeId: 'mock-dentist', name: '예시치과의원' });
    expect(schedules.filter((s) => s.suggestion).map((s) => s.id)).toEqual(['gwangju-dentist']);
  });

  it('후보를 저장하면 장소가 채워지고 후보는 사라지며 다른 날 일정은 차량 응답에 없다', async () => {
    const app = makeApp();
    const saved = await put(app, 'gwangju-dentist', { placeId: 'mock-dentist' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ id: 'gwangju-dentist', locationText: '예시치과의원', noTravel: false });
    expect(row((await get(app)).schedules, 'gwangju-dentist')).toMatchObject({ place: { name: '예시치과의원' }, suggestion: null });
    expect((await get(app, 'today')).schedules.map((s) => s.id)).not.toContain('gwangju-dentist');
  });

  it('이동 없음이면 후보를 숨기고 보정을 지우면 다시 낸다', async () => {
    const app = makeApp();
    await put(app, 'gwangju-dentist', { noTravel: true });
    expect(row((await get(app)).schedules, 'gwangju-dentist').suggestion).toBeNull();
    await put(app, 'gwangju-dentist', { placeId: null });
    expect(row((await get(app)).schedules, 'gwangju-dentist').suggestion).toEqual({ placeId: 'mock-dentist', name: '예시치과의원' });
  });
});

describe('GET /schedules/today 날짜 기준', () => {
  const sched = (id: string, startOffsetMinutes: number, endOffsetMinutes: number, allDay = false) => ({
    id, calendarId: 'mock-my', title: id, startOffsetMinutes, endOffsetMinutes, allDay,
    locationText: null, place: null, memo: null, attendees: [],
  });
  const day = (...schedules: ReturnType<typeof sched>[]) => parseDayFixture({ id: 'd', name: 'n', schedules }, calendars);
  const todayIds = async (app: ReturnType<typeof newApp>, at: string) =>
    ((await (await app.request(`/schedules/today?at=${encodeURIComponent(at)}`)).json()) as { schedules: { id: string }[] }).schedules.map((s) => s.id);

  it('서울 날짜가 같은 일정만 내려주고 다음 날 일정은 뺀다', async () => {
    // anchor 09:20 KST: +879분 = 23:59 KST(오늘 마지막), +880분 = 다음 날 00:00 KST
    const app = newApp({ fixture: day(sched('last', 879, 900), sched('next', 880, 900), sched('later', 3220, 3280)) });
    expect(await todayIds(app, '2026-11-06T09:20:00+09:00')).toEqual(['last']);
    expect((await get(app)).schedules.map((s) => s.id)).toEqual(['last', 'next', 'later']);
  });

  it('날짜는 UTC가 아니라 서울 기준이다', async () => {
    // anchor 2026-11-05T15:30Z = 11-06 00:30 KST. 전날(11-05 UTC) 안의 +60분은 같은 서울 날짜다.
    const app = newApp({ fixture: day(sched('early', 60, 120), sched('prev', -60, -30)) });
    expect(await todayIds(app, '2026-11-05T15:30:00Z')).toEqual(['early']);
  });

  it('자정을 넘겨 끝나는 일정은 시작 날짜에 포함하고, 전날 시작해 아직 끝나지 않은 일정도 포함한다', async () => {
    const app = newApp({ fixture: day(sched('overnight', 800, 1000), sched('tomorrow', 900, 960)) });
    expect(await todayIds(app, '2026-11-06T09:20:00+09:00')).toEqual(['overnight']);
    // anchor 00:10 KST: 전날 23:40 시작·00:40 종료는 아직 진행 중, 전날 22:00~23:00은 끝남
    const midnight = newApp({ fixture: day(sched('ongoing', -30, 30), sched('ended', -130, -70)) });
    expect(await todayIds(midnight, '2026-11-06T00:10:00+09:00')).toEqual(['ongoing']);
  });
});
