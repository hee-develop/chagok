import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadDayFixture } from '../src/fixtures.js';

const fixture = loadDayFixture();
const app = createApp(fixture);

describe('GET /health', () => {
  it('200과 { ok: true }를 돌려준다', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /schedules/today', () => {
  const at = '2026-11-06T09:20:00+09:00';

  it('at이 있으면 at + 오프셋으로 시작·종료 시각을 만든다', async () => {
    const res = await app.request(`/schedules/today?at=${encodeURIComponent(at)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      anchor: string;
      schedules: { id: string; title: string; start: string; end: string; allDay: boolean; place: unknown; memo: string | null }[];
    };
    expect(body.anchor).toBe('2026-11-06T00:20:00.000Z');
    expect(body.schedules).toHaveLength(fixture.schedules.length);

    const lunch = body.schedules.find((s) => s.id === 'gwangju-lunch');
    expect(lunch).toMatchObject({
      title: '육전집 점심',
      start: '2026-11-06T04:00:00.000Z', // 13:00 KST
      end: '2026-11-06T05:00:00.000Z',
      allDay: false,
      locationText: '광주 육전집',
      place: { name: '광주 육전집', lat: 35.1595, lng: 126.8526 },
      memo: '유니폼·응원봉·티켓',
      attendees: [],
    });
    const allDay = body.schedules.find((s) => s.allDay);
    expect(allDay).toMatchObject({ title: '광주 직관', start: body.anchor, locationText: null, place: null, memo: null });
  });

  it('at을 생략하면 현재 시각을 기준으로 한다', async () => {
    const before = Date.now();
    const res = await app.request('/schedules/today');
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { anchor: string; schedules: { start: string }[] };
    const anchor = Date.parse(body.anchor);
    expect(anchor).toBeGreaterThanOrEqual(before);
    expect(anchor).toBeLessThanOrEqual(after);
    expect(Date.parse(body.schedules[1].start) - anchor).toBe(fixture.schedules[1].startOffsetMinutes * 60_000);
  });

  it.each([
    'abc',
    '2026-11-06',
    '2026-11-06T09:20:00',
    '2026-13-45T99:99:00Z',
    '',
    '2026-02-30T09:20:00+09:00',
    '2026-02-29T09:20:00Z',
    '2026-11-31T09:20:00Z',
    '2026-11-06T24:00:00Z',
    '2026-11-06T24:00+09:00',
    '2026-11-06T09:60:00Z',
    '2026-11-06T09:20:60Z',
    '2026-11-06T09:20:00+24:00',
    '0099-02-29T00:00:00Z',
    '0100-02-29T00:00:00Z',
  ])('잘못된 at(%j)은 400', async (bad) => {
    const res = await app.request(`/schedules/today?at=${encodeURIComponent(bad)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe('GET /schedules/today at 경계값', () => {
  it.each(['2028-02-29T09:20:00Z', '2026-11-06T23:59:59+09:00', '2026-11-06T00:00Z', '0000-02-29T00:00:00Z', '0096-02-29T00:00:00Z'])('유효한 at(%s)은 200', async (ok) => {
    const res = await app.request(`/schedules/today?at=${encodeURIComponent(ok)}`);
    expect(res.status).toBe(200);
  });
});
