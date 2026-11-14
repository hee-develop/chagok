import { describe, expect, it } from 'vitest';
import { loadDayFixture, parseDayFixture, resolveFixtureLocation } from '../src/fixtures.js';
import { calendars, newApp } from './helpers.js';

// PT 시연 일정(fixtures/schedules/pt-day.json). 고정 기준 시각 12/3 08:50(서울)이라 폰(at 없음)과 차(데모 시계 at)가 같은 시각을 본다.
const pt = loadDayFixture(resolveFixtureLocation('fixtures/schedules/pt-day.json'), calendars);
// 서버 시계·차의 at이 PT 날짜가 아니어도 시각은 픽스처 기준 시각에서 나온다.
const makeApp = () => newApp({ fixture: pt, now: () => new Date('2026-11-14T05:00:00Z') });
type Row = { id: string; title: string; start: string; place: unknown; locationText: string | null; memo?: string | null; noTravel?: boolean; noTravelReason?: string | null };
const json = async (res: Response) => (await res.json()) as { anchor: string; schedules: Row[] };
const put = (app: ReturnType<typeof makeApp>, path: string, body: unknown) =>
  app.request(`/schedules/${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('PT 시연 일정', () => {
  it('차가 받는 오늘 일정: 08:50 기준 육전집 점심 13:00(장소 비움), 메모는 모두 비고 화상회의는 빠진다', async () => {
    const today = await json(await makeApp().request('/schedules/today?at=2026-11-14T00%3A20%3A00Z'));
    expect(today.anchor).toBe('2026-12-02T23:50:00.000Z');
    expect(today.schedules.map((s) => [s.title, s.start])).toEqual([
      ['광주 직관', '2026-12-02T15:00:00.000Z'],
      ['육전집 점심', '2026-12-03T04:00:00.000Z'],
      ['KIA 직관', '2026-12-03T08:00:00.000Z'],
      ['콩물 픽업', '2026-12-03T12:00:00.000Z'],
    ]);
    expect(today.schedules.find((s) => s.title === '육전집 점심')).toMatchObject({ place: null, locationText: null });
    expect(today.schedules.every((s) => s.memo === null)).toBe(true);
  });

  it('폰 3단계(at 없음)도 같은 시각이고, 화상회의는 이동 없음 · 온라인 회의로 흐리게 보인다', async () => {
    const places = await json(await makeApp().request('/schedules/places'));
    expect(places.schedules.map((s) => [s.title, s.start])).toEqual([
      ['주간 회의', '2026-12-03T01:00:00.000Z'],
      ['육전집 점심', '2026-12-03T04:00:00.000Z'],
      ['KIA 직관', '2026-12-03T08:00:00.000Z'],
      ['콩물 픽업', '2026-12-03T12:00:00.000Z'],
    ]);
    expect(places.schedules[0]).toMatchObject({ noTravel: true, noTravelReason: 'online' });
  });

  it('폰에서 육전집 장소와 채비를 넣으면 차가 받는 일정에 그대로 실린다', async () => {
    const app = makeApp();
    expect((await put(app, 'pt-lunch/place', { placeId: 'mock-yukjeon' })).status).toBe(200);
    expect((await put(app, 'pt-kia/care', { care: '유니폼 · 응원봉' })).status).toBe(200);
    const today = await json(await app.request('/schedules/today?at=2026-12-02T23%3A50%3A00Z'));
    expect(today.schedules.find((s) => s.id === 'pt-lunch')).toMatchObject({ place: { name: '광주 육전집', lat: 35.1595, lng: 126.8526 } });
    expect(today.schedules.find((s) => s.id === 'pt-kia')).toMatchObject({ care: '유니폼 · 응원봉' });
  });
});

describe('픽스처 고정 기준 시각(anchor)', () => {
  const base = { id: 'd', name: 'n', schedules: [] };
  it('오프셋 있는 ISO8601이면 통과하고 아니면 거부한다', () => {
    expect(parseDayFixture({ ...base, anchor: '2026-12-03T08:50:00+09:00' }).anchor).toBe('2026-12-03T08:50:00+09:00');
    expect(() => parseDayFixture({ ...base, anchor: '2026-12-03 08:50' })).toThrow(/anchor/);
    expect(() => parseDayFixture({ ...base, anchor: '2026-12-03T08:50:00' })).toThrow(/anchor/);
    expect(() => parseDayFixture({ ...base, anchor: 850 })).toThrow(/anchor/);
  });

  it('기본 픽스처는 기준 시각이 없어 지금처럼 요청의 at을 따른다', () => {
    expect(loadDayFixture(undefined, calendars).anchor).toBeUndefined();
  });
});
