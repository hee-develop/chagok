import { describe, expect, it } from 'vitest';
import { createSeatStore } from '../src/seats.js';
import { newApp } from './helpers.js';

const NOW = '2026-11-11T10:00:00+09:00';
const makeApp = () => {
  const now = () => new Date(NOW);
  return newApp({ now, seats: createSeatStore(now) });
};
type App = ReturnType<typeof makeApp>;

const event = (over: Record<string, unknown> = {}) => ({
  id: 'e1', calendarId: 'cal', title: '민수랑 저녁', start: '2026-11-11T19:00:00+09:00', end: '2026-11-11T20:00:00+09:00',
  allDay: false, locationText: '광주 서구', notes: null, ...over,
});
const put = async (app: App, events: unknown[]) => {
  const res = await app.request('/events', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }) });
  return { status: res.status, body: (await res.json()) as any };
};
const today = async (app: App) => ((await (await app.request('/schedules/today')).json()) as any).schedules as any[];
const stored = async (app: App) => ((await (await app.request('/events?date=2026-11-11')).json()) as any).events as any[];

describe('PUT /events · contacts', () => {
  it('연락 상대 표시 이름(0~2개)을 저장하고 /events와 /schedules/today에 싣는다', async () => {
    const app = makeApp();
    const res = await put(app, [event({ contacts: ['김민수'] }), event({ id: 'e2', title: '회의', contacts: ['김민수', '이민수'] }), event({ id: 'e3', title: '치과', contacts: [] })]);
    expect(res.status).toBe(200);
    expect((await stored(app)).map((e) => [e.id, e.contacts])).toEqual([['e1', ['김민수']], ['e2', ['김민수', '이민수']], ['e3', []]]);
    expect((await today(app)).map((e) => [e.id, e.contacts])).toEqual([['e1', ['김민수']], ['e2', ['김민수', '이민수']], ['e3', []]]);
  });

  it('contacts를 보내지 않은 옛 폰은 빈 목록으로 본다', async () => {
    const app = makeApp();
    expect((await put(app, [event()])).status).toBe(200);
    expect((await stored(app))[0].contacts).toEqual([]);
    expect((await today(app))[0].contacts).toEqual([]);
  });

  it('이름 앞뒤 공백을 떼어 저장한다', async () => {
    const app = makeApp();
    await put(app, [event({ contacts: ['  김민수  '] })]);
    expect((await stored(app))[0].contacts).toEqual(['김민수']);
  });

  const bad: [string, unknown][] = [
    ['3개 이상(후보는 2명까지)', ['a', 'b', 'c']],
    ['문자열이 아닌 항목', ['김민수', 1]],
    ['빈 이름', ['']],
    ['공백뿐인 이름', ['   ']],
    ['너무 긴 이름(100자 초과)', ['가'.repeat(101)]],
    ['배열이 아님', '김민수'],
    ['null', null],
    ['객체', { name: '김민수' }],
  ];
  it.each(bad)('contacts가 %s면 400이고 아무것도 저장하지 않는다', async (_name, contacts) => {
    const app = makeApp();
    const res = await put(app, [event({ contacts })]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contacts/);
    expect(await stored(app)).toEqual([]);
  });

  // Android의 DISPLAY_NAME은 이름 없는 연락처에서 번호·이메일로 채워진다. 그대로 서버에 나가면 안 된다(정책서 10.5).
  const leaks: [string, string][] = [
    ['전화번호', '010-1234-5678'],
    ['국제 전화번호', '+82 10 1234 5678'],
    ['붙여 쓴 전화번호', '01012345678'],
    ['괄호·점이 낀 전화번호', '(010) 1234.5678'],
    ['이메일', 'partner@corp.example'],
    ['@만 든 글자', '@'],
    ['숫자뿐', '12345'],
    ['기호뿐', '---'],
    ['이름에 번호가 섞임', '김과장 010-1234-5678'],
    ['이름에 이메일이 섞임', '김과장 kim@corp.example'],
    ['전각 숫자 번호', '０１０１２３４５６７８'],
  ];
  it.each(leaks)('연락 상대 이름이 %s 모양이면(%s) 400이고 저장하지 않는다', async (_label, name) => {
    const app = makeApp();
    const res = await put(app, [event({ contacts: [name] })]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contacts/);
    expect(await stored(app)).toEqual([]);
    // 두 번째 자리에 섞여 있어도 거절한다(앞 이름이 정상이어도 일정 전체가 400).
    expect((await put(app, [event({ contacts: ['김민수', name] })])).status).toBe(400);
  });

  it.each(['김민수', '7-Eleven', 'Dr. Kim 2', '이 과장 (3팀)', '엄마', '민수2'])('이름 모양이면(%s) 받는다', async (name) => {
    const app = makeApp();
    expect((await put(app, [event({ contacts: [name] })])).status).toBe(200);
    expect((await stored(app))[0].contacts).toEqual([name]);
  });

  it('이름이 100자면 받는다', async () => {
    const app = makeApp();
    expect((await put(app, [event({ contacts: ['가'.repeat(100)] })])).status).toBe(200);
  });
});

describe('참석자(attendees)는 더는 저장하지 않는다', () => {
  it('옛 폰이 attendees를 보내도 검증하지 않고(잘못된 값도 400이 아니다) 저장·응답하지 않는다', async () => {
    const app = makeApp();
    const res = await put(app, [event({ attendees: ['김철수', '이영희'], contacts: ['김민수'] }), event({ id: 'e2', attendees: 123 })]);
    expect(res.status).toBe(200);
    const events = await stored(app);
    expect(events.every((e) => !('attendees' in e))).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/김철수|이영희/);
  });

  it('/schedules/today의 attendees(옛 차 앱 호환 필드)는 폰 일정에서는 늘 빈 목록이다', async () => {
    const app = makeApp();
    await put(app, [event({ attendees: ['김철수'] })]);
    expect((await today(app))[0].attendees).toEqual([]);
  });
});
