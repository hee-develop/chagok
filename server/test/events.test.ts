import { describe, expect, it } from 'vitest';
import { MAX_ATTENDEES, MAX_EVENTS, MAX_LOCATION_LENGTH, MAX_NOTES_LENGTH, MAX_TITLE_LENGTH } from '../src/limits.js';
import { catalog, newApp } from './helpers.js';

/** 시계를 고정한다: 서울 2026-11-11 10:00. 오늘·내일은 11-11, 11-12. */
const NOW = '2026-11-11T10:00:00+09:00';
let clockMs = Date.parse(NOW);
const makeApp = () => {
  clockMs = Date.parse(NOW);
  return newApp({ now: () => new Date(clockMs) });
};
type App = ReturnType<typeof makeApp>;

const ev = (over: Record<string, unknown> = {}) => ({
  id: 'e1@1',
  calendarId: 'cal-1',
  title: '팀 회의',
  start: '2026-11-11T14:00:00+09:00',
  end: '2026-11-11T15:00:00+09:00',
  allDay: false,
  locationText: null,
  notes: null,
  attendees: [],
  ...over,
});
const put = (app: App, body: unknown) =>
  app.request('/events', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getEvents = async (app: App, date?: string) => {
  const res = await app.request(date === undefined ? '/events' : `/events?date=${date}`);
  return { status: res.status, body: (await res.json()) as { date: string; receivedAt: string | null; events: { id: string; title: string; start: string }[] } };
};

describe('PUT /events', () => {
  it('일정을 저장하고 저장·제외 개수를 돌려준다', async () => {
    const app = makeApp();
    const res = await put(app, { events: [ev(), ev({ id: 'e2@2', start: '2026-11-12T09:00:00+09:00', end: '2026-11-12T10:00:00+09:00' })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receivedAt: new Date(clockMs).toISOString(), stored: 2, dropped: 0 });
  });

  it('오늘·내일(서울) 밖 일정은 걸러 저장하지 않는다', async () => {
    const app = makeApp();
    const res = await put(app, {
      events: [
        ev({ id: 'yesterday', start: '2026-11-10T14:00:00+09:00', end: '2026-11-10T15:00:00+09:00' }),
        ev({ id: 'today' }),
        ev({ id: 'day-after', start: '2026-11-13T00:00:00+09:00', end: '2026-11-13T01:00:00+09:00' }),
        // 어제 종일 일정: 끝이 오늘 0시(미포함)라 오늘과 겹치지 않는다.
        ev({ id: 'allday-yesterday', allDay: true, start: '2026-11-10T00:00:00+09:00', end: '2026-11-11T00:00:00+09:00' }),
        // 어제 밤에 시작해 오늘 새벽까지 이어지는 일정은 오늘과 겹친다.
        ev({ id: 'overnight', start: '2026-11-10T23:00:00+09:00', end: '2026-11-11T01:00:00+09:00' }),
      ],
    });
    expect(await res.json()).toMatchObject({ stored: 2, dropped: 3 });
    const { body } = await getEvents(app, '2026-11-11');
    expect(body.events.map((e) => e.id)).toEqual(['overnight', 'today']);
  });

  it('PUT은 전체 교체다', async () => {
    const app = makeApp();
    await put(app, { events: [ev({ id: 'a' }), ev({ id: 'b' })] });
    await put(app, { events: [ev({ id: 'c' })] });
    expect((await getEvents(app, '2026-11-11')).body.events.map((e) => e.id)).toEqual(['c']);
  });

  it('일정 0건으로 교체해도 받은 시각이 남는다', async () => {
    const app = makeApp();
    await put(app, { events: [] });
    const { body } = await getEvents(app);
    expect(body.events).toEqual([]);
    expect(body.receivedAt).toBe(new Date(clockMs).toISOString());
  });

  it('시각은 UTC ISO로, 장소 칸·메모·참석자 이름은 그대로 돌려준다', async () => {
    const app = makeApp();
    await put(app, { events: [ev({ locationText: '광주 육전집', notes: '메모', attendees: ['김철수', '이영희'] })] });
    const { body } = await getEvents(app, '2026-11-11');
    expect(body.events[0]).toEqual({
      id: 'e1@1',
      calendarId: 'cal-1',
      title: '팀 회의',
      start: '2026-11-11T05:00:00.000Z',
      end: '2026-11-11T06:00:00.000Z',
      allDay: false,
      locationText: '광주 육전집',
      notes: '메모',
      attendees: ['김철수', '이영희'],
    });
  });

  const bad: [string, unknown][] = [
    ['본문이 배열', []],
    ['events 없음', {}],
    ['events가 배열이 아님', { events: 'x' }],
    ['항목이 객체가 아님', { events: [1] }],
    ['id 빈 문자열', { events: [ev({ id: '' })] }],
    ['id 너무 김', { events: [ev({ id: 'x'.repeat(101) })] }],
    ['id 중복', { events: [ev(), ev()] }],
    ['calendarId 없음', { events: [ev({ calendarId: undefined })] }],
    ['title 숫자', { events: [ev({ title: 1 })] }],
    ['title 너무 김', { events: [ev({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })] }],
    ['locationText 너무 김', { events: [ev({ locationText: 'x'.repeat(MAX_LOCATION_LENGTH + 1) })] }],
    ['notes 너무 김', { events: [ev({ notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) })] }],
    ['notes undefined', { events: [ev({ notes: undefined })] }],
    ['참석자 너무 많음', { events: [ev({ attendees: Array.from({ length: MAX_ATTENDEES + 1 }, (_, i) => `n${i}`) })] }],
    ['참석자 빈 이름', { events: [ev({ attendees: [' '] })] }],
    ['allDay 문자열', { events: [ev({ allDay: 'false' })] }],
    ['start 형식 오류', { events: [ev({ start: '2026-11-11 14:00' })] }],
    ['start 오프셋 없음', { events: [ev({ start: '2026-11-11T14:00:00' })] }],
    ['없는 날짜', { events: [ev({ start: '2026-02-30T00:00:00+09:00' })] }],
    ['end가 start보다 빠름', { events: [ev({ end: '2026-11-11T13:00:00+09:00' })] }],
    ['일정 개수 초과', { events: Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ev({ id: `x${i}` })) }],
  ];
  it.each(bad)('검증 실패: %s는 400이고 저장하지 않는다', async (_name, body) => {
    const app = makeApp();
    await put(app, { events: [ev({ id: 'keep' })] });
    const res = await put(app, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect((await getEvents(app, '2026-11-11')).body.events.map((e) => e.id)).toEqual(['keep']);
  });

  it('깨진 JSON은 400', async () => {
    const res = await makeApp().request('/events', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(res.status).toBe(400);
  });

  it('본문 상한(1MB)을 넘으면 413', async () => {
    const res = await put(makeApp(), { events: [ev({ notes: 'x'.repeat(MAX_NOTES_LENGTH) })], pad: 'y'.repeat(1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('상한 개수(200개)는 받는다', async () => {
    const res = await put(makeApp(), { events: Array.from({ length: MAX_EVENTS }, (_, i) => ev({ id: `x${i}` })) });
    expect(res.status).toBe(200);
  });
});

describe('GET /events', () => {
  it('받은 적이 없으면 receivedAt이 null이고 일정이 없다', async () => {
    expect((await getEvents(makeApp())).body).toEqual({ date: '2026-11-11', receivedAt: null, events: [] });
  });

  it('date를 생략하면 오늘(서울)', async () => {
    const app = makeApp();
    await put(app, { events: [ev()] });
    expect((await getEvents(app)).body.events).toHaveLength(1);
  });

  it('date로 그날 일정만 보여 준다', async () => {
    const app = makeApp();
    await put(app, { events: [ev(), ev({ id: 'tmr', start: '2026-11-12T09:00:00+09:00', end: '2026-11-12T10:00:00+09:00' })] });
    expect((await getEvents(app, '2026-11-12')).body.events.map((e) => e.id)).toEqual(['tmr']);
    expect((await getEvents(app, '2026-11-13')).body.events).toEqual([]);
  });

  it.each(['abc', '2026-13-01', '2026-02-30', '20261111', '2026-11-11T00:00:00Z', ''])('잘못된 date(%j)는 400', async (bad) => {
    const res = await makeApp().request(`/events?date=${encodeURIComponent(bad)}`);
    expect(res.status).toBe(400);
  });

  it('날짜가 지나면 지난 일정은 지워지고 오늘 일정만 남는다', async () => {
    const app = makeApp();
    await put(app, { events: [ev(), ev({ id: 'tmr', start: '2026-11-12T09:00:00+09:00', end: '2026-11-12T10:00:00+09:00' })] });
    clockMs = Date.parse('2026-11-12T00:30:00+09:00'); // 자정이 지남: 내일이 오늘이 된다
    expect((await getEvents(app, '2026-11-11')).body.events).toEqual([]);
    expect((await getEvents(app)).body.events.map((e) => e.id)).toEqual(['tmr']);
    clockMs = Date.parse('2026-11-14T08:00:00+09:00');
    const after = await getEvents(app);
    expect(after.body.events).toEqual([]);
    expect(after.body.receivedAt).not.toBeNull(); // 폰이 보낸 적이 있다는 표시는 남는다
  });
});

describe('/schedules/today·places의 출처', () => {
  const todayIds = async (app: App) =>
    ((await (await app.request('/schedules/today')).json()) as { schedules: { id: string }[] }).schedules.map((s) => s.id);
  const saveSelection = (app: App, selectedIds: string[], source?: string) =>
    app.request('/calendars/selection', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedIds, revision: 1, ...(source ? { source } : {}) }),
    });

  it('폰 일정을 받기 전에는 픽스처(at 기준 상대 시각)를 그대로 쓴다', async () => {
    const app = makeApp();
    const res = await app.request('/schedules/today');
    const body = (await res.json()) as { schedules: { id: string; start: string }[] };
    expect(body.schedules.map((s) => s.id)).toContain('gwangju-lunch');
    expect(body.schedules.find((s) => s.id === 'gwangju-lunch')!.start).toBe(new Date(clockMs + 220 * 60_000).toISOString());
  });

  it('폰 일정을 받으면 픽스처 대신 그것만 내려준다', async () => {
    const app = makeApp();
    await put(app, { events: [ev(), ev({ id: 'tmr', start: '2026-11-12T09:00:00+09:00', end: '2026-11-12T10:00:00+09:00' })] });
    expect(await todayIds(app)).toEqual(['e1@1']); // 내일 일정은 오늘 응답에 없다
    const res = await app.request('/schedules/today');
    expect(((await res.json()) as { schedules: unknown[] }).schedules[0]).toEqual({
      id: 'e1@1',
      locationText: null,
      place: null,
      title: '팀 회의',
      start: '2026-11-11T05:00:00.000Z',
      end: '2026-11-11T06:00:00.000Z',
      allDay: false,
      memo: null,
      care: null,
      attendees: [],
    });
  });

  it('폰 일정이 0건이면 빈 목록이다(목 일정으로 돌아가지 않는다)', async () => {
    const app = makeApp();
    await put(app, { events: [] });
    expect(await todayIds(app)).toEqual([]);
  });

  it('at 기준 서울 날짜로 오늘 일정을 고른다', async () => {
    const app = makeApp();
    await put(app, { events: [ev(), ev({ id: 'tmr', start: '2026-11-12T09:00:00+09:00', end: '2026-11-12T10:00:00+09:00' })] });
    const res = await app.request(`/schedules/today?at=${encodeURIComponent('2026-11-12T08:00:00+09:00')}`);
    expect(((await res.json()) as { schedules: { id: string }[] }).schedules.map((s) => s.id)).toEqual(['tmr']);
  });

  it('고른 캘린더가 있으면 그 캘린더 일정만, 고른 적 없으면 폰이 보낸 그대로 내려준다', async () => {
    const app = makeApp();
    await put(app, { events: [ev({ id: 'a', calendarId: 'cal-1' }), ev({ id: 'b', calendarId: 'cal-2' })] });
    expect(await todayIds(app)).toEqual(['a', 'b']);
    expect((await saveSelection(app, ['cal-2'], 'device')).status).toBe(200);
    expect(await todayIds(app)).toEqual(['b']);
  });

  it('device 선택은 목 캘린더 id가 아니어도 받고, source 없이는 목 id만 받는다', async () => {
    const app = makeApp();
    expect((await saveSelection(app, ['cal-2'])).status).toBe(400);
    expect((await saveSelection(app, ['cal-2'], 'device')).status).toBe(200);
    expect((await saveSelection(app, ['cal-2'], 'other')).status).toBe(400);
    expect((await saveSelection(app, [' '], 'device')).status).toBe(400);
  });

  describe('장소 매칭', () => {
    const named = catalog.places[0];
    const remembered = catalog.remembered[0];
    const rememberedPlace = [...catalog.places, ...catalog.suggestions].find((p) => p.id === remembered.placeId)!;
    type Row = { id: string; place: { name: string; lat: number; lng: number } | null; locationText: string | null; suggestion: { placeId: string; name: string } | null; noTravel: boolean };
    const rows = async (app: App, path: string) =>
      Object.fromEntries(((await (await app.request(path)).json()) as { schedules: Row[] }).schedules.map((s) => [s.id, s]));
    const fix = (app: App, id: string, body: unknown) =>
      app.request(`/schedules/${id}/place`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    it('정규화한 이름이 완전히 같을 때만 place(좌표)를 정한다. 장소 칸 글자는 그대로 둔다', async () => {
      const app = makeApp();
      await put(app, { events: [ev({ id: 'exact', locationText: `  ${named.name.toUpperCase()}  ` })] });
      const by = await rows(app, '/schedules/today');
      expect(by.exact.place).toEqual({ name: named.name, lat: named.lat, lng: named.lng });
      expect(by.exact.locationText).toBe(`  ${named.name.toUpperCase()}  `);
    });

    it('이름이 일부만 겹치면 좌표를 확정하지 않고 suggestion(확인 필요)으로만 낸다', async () => {
      const app = makeApp();
      await put(app, {
        events: [
          ev({ id: 'longer', locationText: `${named.name} 2층` }),
          ev({ id: 'short', locationText: named.name.slice(0, 2), start: '2026-11-11T16:00:00+09:00', end: '2026-11-11T17:00:00+09:00' }),
        ],
      });
      expect((await rows(app, '/schedules/today')).longer.place).toBeNull();
      const by = await rows(app, '/schedules/places');
      expect(by.longer.place).toBeNull();
      expect(by.longer.suggestion).toEqual({ placeId: named.id, name: named.name });
      expect(by.short.place).toBeNull();
    });

    it('지난번 기억(제목)도 폰 일정에서 suggestion이고 place는 null이다(픽스처 경로와 같은 계약)', async () => {
      const app = makeApp();
      await put(app, { events: [ev({ id: 'memo', title: remembered.title, locationText: null })] });
      expect((await rows(app, '/schedules/today')).memo.place).toBeNull();
      expect((await rows(app, '/schedules/places')).memo.suggestion).toEqual({ placeId: rememberedPlace.id, name: rememberedPlace.name });
    });

    it('완전 일치가 있으면 후보를 내지 않고, 아무것도 못 찾으면 둘 다 null', async () => {
      const app = makeApp();
      await put(app, {
        events: [
          ev({ id: 'both', title: remembered.title, locationText: named.name }),
          ev({ id: 'none', title: '점심', locationText: '알 수 없는 곳 xyz', start: '2026-11-11T16:00:00+09:00', end: '2026-11-11T17:00:00+09:00' }),
        ],
      });
      const by = await rows(app, '/schedules/places');
      expect(by.both.place).toMatchObject({ name: named.name });
      expect(by.both.suggestion).toBeNull();
      expect(by.none).toMatchObject({ place: null, suggestion: null });
    });

    it('3단계 보정이 가장 먼저이고, 이동 없음은 차량 응답에서 빠진다', async () => {
      const app = makeApp();
      await put(app, { events: [ev({ id: 'a', locationText: '알 수 없는 곳' })] });
      expect((await fix(app, 'a', { placeId: named.id })).status).toBe(200);
      expect((await rows(app, '/schedules/today')).a.place).toMatchObject({ name: named.name });
      await fix(app, 'a', { noTravel: true });
      expect(Object.keys(await rows(app, '/schedules/today'))).not.toContain('a');
    });

    it('일정을 교체하면 사라진 일정의 보정은 버려지고 남은 일정의 보정은 유지된다', async () => {
      const app = makeApp();
      await put(app, { events: [ev({ id: 'keep' }), ev({ id: 'gone', start: '2026-11-11T16:00:00+09:00', end: '2026-11-11T17:00:00+09:00' })] });
      await fix(app, 'keep', { placeId: named.id });
      await fix(app, 'gone', { placeId: named.id });
      await put(app, { events: [ev({ id: 'keep' })] });
      await put(app, { events: [ev({ id: 'keep' }), ev({ id: 'gone', start: '2026-11-11T16:00:00+09:00', end: '2026-11-11T17:00:00+09:00' })] });
      const by = await rows(app, '/schedules/today');
      expect(by.keep.place).toMatchObject({ name: named.name });
      expect(by.gone.place).toBeNull();
    });
  });

  it('/schedules/places는 폰 일정 중 종일을 뺀 일정을 시작순으로 보여 준다', async () => {
    const app = makeApp();
    await put(app, {
      events: [
        ev({ id: 'late', title: '나중', start: '2026-11-11T20:00:00+09:00', end: '2026-11-11T21:00:00+09:00', locationText: '미지의 곳 xyz' }),
        ev({ id: 'allday', allDay: true, start: '2026-11-11T00:00:00+09:00', end: '2026-11-12T00:00:00+09:00' }),
        ev({ id: 'early', title: '먼저', start: '2026-11-11T08:00:00+09:00', end: '2026-11-11T09:00:00+09:00' }),
      ],
    });
    const res = await app.request('/schedules/places');
    const { schedules } = (await res.json()) as { schedules: { id: string; place: unknown; noTravel: boolean; suggestion: unknown }[] };
    expect(schedules.map((s) => s.id)).toEqual(['early', 'late']);
    expect(schedules.every((s) => s.place === null && s.suggestion === null)).toBe(true);
  });

  it('폰 일정이 있는 앱과 없는 앱은 서로 독립이다', async () => {
    const a = makeApp();
    await put(a, { events: [] });
    expect((await todayIds(makeApp())).length).toBeGreaterThan(0);
  });
});

describe('선택 출처와 일정 출처의 조합', () => {
  const todayIds = async (app: App) =>
    ((await (await app.request('/schedules/today')).json()) as { schedules: { id: string }[] }).schedules.map((s) => s.id);
  const save = (app: App, selectedIds: string[], source?: 'mock' | 'device') =>
    app.request('/calendars/selection', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedIds, revision: 1, ...(source ? { source } : {}) }) });

  it('목 id 선택을 저장한 뒤 폰 일정이 와도 일정이 비지 않는다(출처가 달라 거르지 않음)', async () => {
    const app = makeApp();
    await save(app, ['mock-my']);
    await put(app, { events: [ev({ id: 'a', calendarId: '3' })] });
    expect(await todayIds(app)).toEqual(['a']);
  });

  it('기기 id 선택만 있고 폰 일정이 없으면 픽스처는 기본 선택으로 보여 준다(빈 목록이 아님)', async () => {
    const app = makeApp();
    await save(app, ['3'], 'device');
    const ids = await todayIds(app);
    expect(ids).toContain('gwangju-lunch');
    expect(ids).not.toContain('gwangju-kia-doosan');
  });

  it('목 선택은 폰 일정이 없을 때 픽스처에 그대로 적용된다', async () => {
    const app = makeApp();
    await save(app, ['mock-kia']);
    expect(await todayIds(app)).toEqual(['gwangju-kia-doosan']);
  });

  it('기기 id 선택은 폰 일정에만 적용된다', async () => {
    const app = makeApp();
    await put(app, { events: [ev({ id: 'a', calendarId: '3' }), ev({ id: 'b', calendarId: '4' })] });
    await save(app, ['4'], 'device');
    expect(await todayIds(app)).toEqual(['b']);
  });
});

describe('DELETE /events (개발·데모 초기화)', () => {
  const del = (app: App) => app.request('/events', { method: 'DELETE' });
  const local = () => {
    clockMs = Date.parse(NOW);
    return newApp({ now: () => new Date(clockMs), isLoopback: () => true });
  };

  it('같은 기기에서만 받는다(기본은 거부)', async () => {
    const app = makeApp();
    await put(app, { events: [] });
    expect((await del(app)).status).toBe(403);
    expect((await getEvents(app)).body.receivedAt).not.toBeNull();
  });

  it('초기화하면 receivedAt이 null이 되고 일정 출처가 픽스처로 돌아온다', async () => {
    const app = local();
    await put(app, { events: [ev({ id: 'phone' })] });
    expect((await (await app.request('/schedules/today')).json() as { schedules: { id: string }[] }).schedules.map((s) => s.id)).toEqual(['phone']);
    const res = await del(app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receivedAt: null });
    expect((await getEvents(app)).body).toMatchObject({ receivedAt: null, events: [] });
    const ids = ((await (await app.request('/schedules/today')).json()) as { schedules: { id: string }[] }).schedules.map((s) => s.id);
    expect(ids).toContain('gwangju-lunch');
  });
});

describe('eventsLoopbackOnly', () => {
  it('켜면 같은 기기가 아닌 요청은 모든 /events 메서드가 403이고, 같은 기기는 통과한다', async () => {
    const closed = newApp({ eventsLoopbackOnly: true, isLoopback: () => false });
    expect((await closed.request('/events')).status).toBe(403);
    expect((await put(closed as App, { events: [] })).status).toBe(403);
    const open = newApp({ eventsLoopbackOnly: true, isLoopback: () => true });
    expect((await open.request('/events')).status).toBe(200);
    expect((await put(open as App, { events: [] })).status).toBe(200);
  });

  it('끄면(기본) 누구나 쓸 수 있다', async () => {
    expect((await newApp({ isLoopback: () => false }).request('/events')).status).toBe(200);
  });
});

describe('저장소 정리', () => {
  it('replace에 지난 일정이 섞여 있어도 저장하지 않는다', async () => {
    const { createEventsStore } = await import('../src/routes/events.js');
    const store = createEventsStore(() => new Date(NOW));
    const base = { calendarId: 'c', title: 't', allDay: false, locationText: null, notes: null, attendees: [] };
    store.replace([
      { ...base, id: 'old', start: Date.parse('2026-11-09T10:00:00+09:00'), end: Date.parse('2026-11-09T11:00:00+09:00') },
      { ...base, id: 'now', start: Date.parse('2026-11-11T10:00:00+09:00'), end: Date.parse('2026-11-11T11:00:00+09:00') },
    ]);
    expect(store.get()!.events.map((e) => e.id)).toEqual(['now']);
  });
});
