import { describe, expect, it } from 'vitest';
import type { createApp } from '../src/app.js';
import { fixture, newApp } from './helpers.js';

const app = newApp();

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
    expect(body.schedules.map((x) => x.id)).toEqual(['gwangju-allday', 'gwangju-lunch', 'gwangju-kia', 'gwangju-kongmul']);

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

describe('GET /schedules/today 캘린더 선택 반영', () => {
  const at = encodeURIComponent('2026-11-06T09:20:00+09:00');
  const ids = async (a: ReturnType<typeof createApp>) => {
    const res = await a.request(`/schedules/today?at=${at}`);
    return ((await res.json()) as { schedules: { id: string }[] }).schedules.map((x) => x.id);
  };
  const select = (a: ReturnType<typeof createApp>, selectedIds: string[]) =>
    a.request('/calendars/selection', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedIds, revision: 1 }),
    });

  it('저장 전에는 기본 선택 캘린더의 일정만 내려준다(KIA 구독 일정 제외)', async () => {
    expect(await ids(newApp())).toEqual(['gwangju-allday', 'gwangju-lunch', 'gwangju-kia', 'gwangju-kongmul']);
  });

  it('KIA 캘린더를 더해 저장하면 KIA vs 두산이 포함된다', async () => {
    const a = newApp();
    expect((await select(a, ['mock-my', 'mock-work', 'mock-family', 'mock-kia'])).status).toBe(200);
    const list = await ids(a);
    expect(list).toContain('gwangju-kia-doosan');
    expect(list).toHaveLength(5);
    const res = await a.request(`/schedules/today?at=${at}`);
    const doosan = ((await res.json()) as { schedules: { id: string; title: string; start: string; locationText: string }[] }).schedules.find(
      (x) => x.id === 'gwangju-kia-doosan',
    );
    expect(doosan).toMatchObject({ title: 'KIA vs 두산', start: '2026-11-06T09:30:00.000Z', locationText: '광주-기아 챔피언스필드' });
  });

  it('저장한 캘린더의 일정만 내려준다', async () => {
    const a = newApp();
    await select(a, ['mock-kia']);
    expect(await ids(a)).toEqual(['gwangju-kia-doosan']);
  });

  it('일정이 없는 캘린더만 고르면 빈 목록이다', async () => {
    const a = newApp();
    await select(a, ['mock-holidays']);
    expect(await ids(a)).toEqual([]);
  });

  it('앱 인스턴스마다 선택을 따로 가진다', async () => {
    const a = newApp();
    await select(a, ['mock-kia']);
    expect(await ids(newApp())).toHaveLength(4);
  });
});
