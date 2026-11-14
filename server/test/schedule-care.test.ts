import { describe, expect, it } from 'vitest';
import { MAX_CARE_LENGTH } from '../src/limits.js';
import { newApp } from './helpers.js';

type App = ReturnType<typeof newApp>;
type Row = { id: string; care: string | null };

const at = 'at=2026-11-06T00%3A20%3A00Z'; // 09:20 KST
const putCare = (app: App, id: string, body: unknown) =>
  app.request(`/schedules/${id}/care`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const careOf = async (app: App, path: 'today' | 'places', id: string) => {
  const res = await app.request(`/schedules/${path}?${at}`);
  return ((await res.json()) as { schedules: Row[] }).schedules.find((s) => s.id === id)?.care;
};

describe('PUT /schedules/:id/care', () => {
  it('일정 하나에 채비 한 줄을 저장하고 차량 응답과 3단계 응답에 싣는다. 다른 일정은 null이다', async () => {
    const app = newApp();
    const res = await putCare(app, 'gwangju-kia', { care: '유니폼·응원봉·티켓' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'gwangju-kia', care: '유니폼·응원봉·티켓' });
    expect(await careOf(app, 'today', 'gwangju-kia')).toBe('유니폼·응원봉·티켓');
    expect(await careOf(app, 'places', 'gwangju-kia')).toBe('유니폼·응원봉·티켓');
    expect(await careOf(app, 'today', 'gwangju-lunch')).toBeNull();
  });

  it('앞뒤 공백을 지우고 줄바꿈·연속 공백은 공백 하나로 줄인다. 빈 글이나 null은 지운다', async () => {
    const app = newApp();
    await putCare(app, 'gwangju-kia', { care: '  유니폼\n응원봉   티켓 ' });
    expect(await careOf(app, 'today', 'gwangju-kia')).toBe('유니폼 응원봉 티켓');
    expect(await (await putCare(app, 'gwangju-kia', { care: '   ' })).json()).toEqual({ id: 'gwangju-kia', care: null });
    expect(await careOf(app, 'today', 'gwangju-kia')).toBeNull();
    await putCare(app, 'gwangju-kia', { care: '티켓' });
    await putCare(app, 'gwangju-kia', { care: null });
    expect(await careOf(app, 'today', 'gwangju-kia')).toBeNull();
  });

  it.each([null, [], {}, { care: 1 }, { care: true }, { care: 'x', extra: 1 }, { memo: 'x' }, { care: 'x'.repeat(MAX_CARE_LENGTH + 1) }])(
    '잘못된 본문 %j는 400이고 저장하지 않는다',
    async (body) => {
      const app = newApp();
      await putCare(app, 'gwangju-kia', { care: '티켓' });
      expect((await putCare(app, 'gwangju-kia', body)).status).toBe(400);
      expect(await careOf(app, 'today', 'gwangju-kia')).toBe('티켓');
    },
  );

  it('상한 글자 수까지는 받는다', async () => {
    const app = newApp();
    expect((await putCare(app, 'gwangju-kia', { care: '가'.repeat(MAX_CARE_LENGTH) })).status).toBe(200);
  });

  it('없거나 선택하지 않은 캘린더의 일정은 404, 종일 일정에는 하루 전체 채비를 둘 수 있다', async () => {
    const app = newApp();
    expect((await putCare(app, 'unknown', { care: '티켓' })).status).toBe(404);
    expect((await putCare(app, 'gwangju-kia-doosan', { care: '티켓' })).status).toBe(404);
    expect((await putCare(app, 'gwangju-allday', { care: '보조배터리' })).status).toBe(200);
    expect(await careOf(app, 'today', 'gwangju-allday')).toBe('보조배터리');
  });

  it('앱 인스턴스마다 따로 가진다', async () => {
    const app = newApp();
    await putCare(app, 'gwangju-kia', { care: '티켓' });
    expect(await careOf(newApp(), 'today', 'gwangju-kia')).toBeNull();
  });

  it('폰 일정이 바뀌어 사라진 일정의 채비는 버린다', async () => {
    const app = newApp({ now: () => new Date('2026-11-11T10:00:00+09:00') });
    const ev = (id: string) => ({
      id, calendarId: 'cal-1', title: id, start: '2026-11-11T14:00:00+09:00', end: '2026-11-11T15:00:00+09:00',
      allDay: false, locationText: null, notes: null, attendees: [],
    });
    const send = (ids: string[]) =>
      app.request('/events', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: ids.map(ev) }) });
    await send(['a', 'b']);
    expect((await putCare(app, 'a', { care: '노트북' })).status).toBe(200);
    expect((await putCare(app, 'b', { care: '명함' })).status).toBe(200);
    await send(['b']);
    await send(['a', 'b']);
    const rows = ((await (await app.request('/schedules/today')).json()) as { schedules: Row[] }).schedules;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.care]))).toEqual({ a: null, b: '명함' });
  });
});
