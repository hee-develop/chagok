import { describe, expect, it } from 'vitest';
import { loadDayFixture } from '../src/fixtures.js';
import { createSelectionStore } from '../src/routes/calendars.js';
import { calendars, catalog, newApp } from './helpers.js';

const fixture = loadDayFixture(new URL('../../fixtures/schedules/fill-places-day.json', import.meta.url), calendars);
const makeApp = () => newApp({ fixture });
const put = (app: ReturnType<typeof newApp>, id: string, body: unknown) => app.request(`/schedules/${id}/place`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const get = async (app: ReturnType<typeof newApp>, path = 'places') => (await app.request(`/schedules/${path}?at=2026-11-06T00%3A20%3A00Z`)).json() as Promise<{ schedules: { id: string; place: unknown; noTravel?: boolean; locationText: string | null }[] }>;

describe('일정별 장소 보정', () => {
  it('선택한 캘린더의 일반 일정만 보여 주고 빈 일정 두 개를 계산할 수 있다', async () => {
    const { schedules } = await get(makeApp());
    expect(schedules.map((s) => s.id)).toEqual(['gwangju-lunch', 'gwangju-kia', 'gwangju-kongmul', 'gwangju-dentist']);
    expect(schedules.filter((s) => !s.place && !s.noTravel)).toHaveLength(2);
  });

  it('일정 하나를 채우면 폰 재조회와 차량 응답에 같은 좌표가 반영되며 원본·다른 일정은 그대로다', async () => {
    const app = makeApp();
    const before = await get(app);
    const p = catalog.places[0];
    const expected = { name: p.name, lat: p.lat, lng: p.lng };
    const response = await put(app, 'gwangju-lunch', { placeId: p.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'gwangju-lunch', place: expected, locationText: p.name, noTravel: false });
    expect((await get(app)).schedules[0].place).toEqual(expected);
    expect((await get(app, 'today')).schedules.find((s) => s.id === 'gwangju-lunch')?.place).toEqual(expected);
    expect((await get(app)).schedules.slice(1)).toEqual(before.schedules.slice(1));
    expect(fixture.schedules.find((s) => s.id === 'gwangju-lunch')?.place).toBeNull();
    expect((await get(makeApp())).schedules[0].place).toBeNull();
  });

  it('이동 없음은 차량에서 제외되고 재전송해도 같으며 장소를 넣으면 복원된다', async () => {
    const app = makeApp();
    for (let i = 0; i < 2; i++) expect((await put(app, 'gwangju-lunch', { noTravel: true })).status).toBe(200);
    expect((await get(app)).schedules[0]).toMatchObject({ place: null, noTravel: true });
    expect((await get(app, 'today')).schedules.map((s) => s.id)).not.toContain('gwangju-lunch');
    await put(app, 'gwangju-lunch', { placeId: catalog.places[0].id });
    expect((await get(app, 'today')).schedules.map((s) => s.id)).toContain('gwangju-lunch');
    await put(app, 'gwangju-lunch', { placeId: null });
    expect((await get(app)).schedules[0]).toMatchObject({ place: null, noTravel: false });
  });

  it.each([null, [], {}, { placeId: 'unknown' }, { placeId: 1 }, { placeId: '' }, { noTravel: false }, { noTravel: true, placeId: 'x' }, { placeId: null, extra: true }])('잘못된 변경 %j는 400이고 저장하지 않는다', async (body) => {
    const app = makeApp();
    expect((await put(app, 'gwangju-lunch', body)).status).toBe(400);
    expect((await get(app)).schedules[0]).toMatchObject({ place: null, noTravel: false });
  });

  it('알 수 없는 일정·선택 해제한 일정은 404, 종일은 409', async () => {
    const app = makeApp();
    expect((await put(app, 'unknown', { noTravel: true })).status).toBe(404);
    expect((await put(app, 'gwangju-kia-doosan', { noTravel: true })).status).toBe(404);
    expect((await put(app, 'gwangju-allday', { noTravel: true })).status).toBe(409);
  });

  it('선택이 바뀌면 숨겨지고 다시 선택하면 보정값을 복원한다', async () => {
    const store = createSelectionStore();
    const app = newApp({ fixture, store });
    await put(app, 'gwangju-lunch', { placeId: catalog.places[0].id });
    const select = (selectedIds: string[], revision: number) => app.request('/calendars/selection', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedIds, revision }) });
    await select([], 1);
    expect((await get(app)).schedules).toEqual([]);
    expect((await put(app, 'gwangju-lunch', { noTravel: true })).status).toBe(404);
    await select(['mock-family'], 2);
    expect((await get(app)).schedules[0].place).not.toBeNull();
  });

  it('잘못된 JSON과 큰 본문을 거절한다', async () => {
    const app = makeApp();
    expect((await app.request('/schedules/gwangju-lunch/place', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
    expect((await put(app, 'gwangju-lunch', { placeId: 'x'.repeat(70_000) })).status).toBe(413);
    expect((await app.request('/schedules/places?at=bad')).status).toBe(400);
  });
});
