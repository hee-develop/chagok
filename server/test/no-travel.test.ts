import { describe, expect, it } from 'vitest';
import { detectNoTravel } from '../src/noTravel.js';
import { newApp } from './helpers.js';

const detect = (over: { title?: string; locationText?: string | null; notes?: string | null }) =>
  detectNoTravel({ title: '팀 회의', locationText: null, notes: null, ...over });

describe('이동 없는 일정 알아보기', () => {
  it('장소 칸이나 메모에 화상 회의 주소가 있으면 온라인 회의다', () => {
    expect(detect({ locationText: 'https://us02web.zoom.us/j/123?pwd=x' })).toBe('online');
    expect(detect({ notes: '참여: https://meet.google.com/abc-defg-hij' })).toBe('online');
    expect(detect({ notes: 'Teams 링크 https://teams.microsoft.com/l/meetup-join/xyz' })).toBe('online');
    expect(detect({ notes: 'http://company.webex.com/meet/kim' })).toBe('online');
  });

  it('비슷하게 생긴 다른 주소는 온라인 회의가 아니다', () => {
    expect(detect({ notes: 'https://zoom.us.example.com/j/1' })).toBeNull();
    expect(detect({ notes: '자료: https://docs.google.com/document/d/1' })).toBeNull();
  });

  it('장소 칸의 온라인 표시와 제목의 화상회의는 온라인 회의다', () => {
    for (const locationText of ['온라인', 'Zoom', 'Google Meet', '구글 미트', 'Microsoft Teams', '팀즈', '줌', 'Teams', '화상회의']) {
      expect(detect({ locationText }), locationText).toBe('online');
    }
    expect(detect({ title: '주간 화상회의' })).toBe('online');
    expect(detect({ title: '고객사 온라인 미팅' })).toBe('online');
  });

  it('다른 말 안에 섞인 짧은 말은 온라인 회의로 보지 않는다', () => {
    expect(detect({ locationText: '줌바 댄스 스튜디오' })).toBeNull();
    expect(detect({ locationText: '베스티안 화상전문병원' })).toBeNull();
    expect(detect({ title: '화상 치료' })).toBeNull();
  });

  it('장소 칸이 회의실이면 회의실 일정이다. 온라인 표시가 같이 있으면 온라인 회의다', () => {
    expect(detect({ locationText: '본사 3층 대회의실' })).toBe('meetingRoom');
    expect(detect({ locationText: 'Meeting Room A' })).toBe('meetingRoom');
    expect(detect({ locationText: '3층 회의실', notes: 'https://zoom.us/j/1' })).toBe('online');
  });

  it('보통 장소나 빈 장소는 해당하지 않는다', () => {
    expect(detect({ locationText: '광주 육전집' })).toBeNull();
    expect(detect({})).toBeNull();
  });
});

describe('/schedules의 이동 없는 일정', () => {
  /** 시계를 고정한다: 서울 2026-11-11 10:00. */
  const makeApp = () => newApp({ now: () => new Date('2026-11-11T10:00:00+09:00') });
  type App = ReturnType<typeof makeApp>;
  const ev = (id: string, over: Record<string, unknown> = {}) => ({
    id,
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
  const json = (app: App, method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  type Row = { id: string; noTravel: boolean; noTravelReason: string | null; place: unknown; locationText: string | null };
  const places = async (app: App) =>
    Object.fromEntries(((await (await app.request('/schedules/places')).json()) as { schedules: Row[] }).schedules.map((s) => [s.id, s]));
  const today = async (app: App) =>
    ((await (await app.request('/schedules/today')).json()) as { schedules: Record<string, unknown>[] }).schedules;

  const sendDay = (app: App) =>
    json(app, 'PUT', '/events', {
      events: [
        ev('zoom', { title: '주간 회의', notes: 'https://zoom.us/j/1' }),
        ev('room', { title: '기획 리뷰', locationText: '본사 3층 회의실' }),
        ev('lunch', { title: '점심', locationText: '광주 육전집' }),
      ],
    });

  it('온라인 회의·회의실은 저절로 이동 없음이 되어 차량 응답에서 빠지고, 3단계에는 이유와 함께 남는다', async () => {
    const app = makeApp();
    expect((await sendDay(app)).status).toBe(200);
    const rows = await places(app);
    expect(rows.zoom).toMatchObject({ noTravel: true, noTravelReason: 'online', place: null, locationText: null });
    expect(rows.room).toMatchObject({ noTravel: true, noTravelReason: 'meetingRoom', place: null, locationText: null });
    expect(rows.lunch).toMatchObject({ noTravel: false, noTravelReason: null });
    const car = await today(app);
    expect(car.map((s) => s.id)).toEqual(['lunch']);
    expect(car[0]).not.toHaveProperty('noTravelReason');
  });

  it('장소를 넣으면 다시 차로 가고, 보정을 지우면 저절로 거르는 상태로 돌아간다', async () => {
    const app = makeApp();
    await sendDay(app);
    const saved = await json(app, 'PUT', '/schedules/room/place', { placeId: 'mock-work-gwangju' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ noTravel: false, noTravelReason: null, place: { name: '광주 예시 업무지구' } });
    expect((await today(app)).map((s) => s.id).sort()).toEqual(['lunch', 'room']);

    await json(app, 'PUT', '/schedules/room/place', { placeId: null });
    expect((await places(app)).room).toMatchObject({ noTravel: true, noTravelReason: 'meetingRoom' });
    expect((await today(app)).map((s) => s.id)).toEqual(['lunch']);
  });

  it('사용자가 직접 이동 없음으로 고른 일정은 이유가 없다', async () => {
    const app = makeApp();
    await sendDay(app);
    await json(app, 'PUT', '/schedules/zoom/place', { noTravel: true });
    await json(app, 'PUT', '/schedules/lunch/place', { noTravel: true });
    const rows = await places(app);
    expect(rows.zoom).toMatchObject({ noTravel: true, noTravelReason: null });
    expect(rows.lunch).toMatchObject({ noTravel: true, noTravelReason: null });
  });

  it('픽스처 일정은 바뀌지 않는다(데모·차량 E2E 경로)', async () => {
    const app = newApp();
    const res = await app.request('/schedules/today?at=2026-11-06T00%3A20%3A00Z');
    const ids = ((await res.json()) as { schedules: { id: string }[] }).schedules.map((s) => s.id);
    expect(ids).toEqual(['gwangju-allday', 'gwangju-lunch', 'gwangju-kia', 'gwangju-kongmul', 'gwangju-friend']);
    const rows = Object.values(await places(app));
    expect(rows.every((r) => r.noTravelReason === null)).toBe(true);
  });
});
