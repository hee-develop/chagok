import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectNoTravel, travelFilterReason } from '../src/noTravel.js';
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

describe('온라인 표시(정책서 12장과 오탐 방지)', () => {
  const online = (over: { title?: string; locationText?: string | null; notes?: string | null }) => detect(over) === 'online';

  it.each([
    ['장소: 온라인', { locationText: '온라인' }],
    ['장소 전체가 화상', { locationText: '화상' }],
    ['장소 전체가 비대면', { locationText: ' 비대면 ' }],
    ['장소: 비대면 회의', { locationText: '비대면 회의' }],
    ['장소: 화상 미팅', { locationText: '화상 미팅' }],
    ['제목: 비대면회의', { title: '고객사 비대면회의' }],
    ['메모의 주소 없는 호스트', { notes: '참여 zoom.us/j/123456' }],
    ['메모의 teams 호스트 문장 끝 마침표', { notes: '링크는 teams.microsoft.com.' }],
    ['장소의 호스트(주소 앞 서브도메인)', { locationText: 'us02web.zoom.us/j/1' }],
    ['장소 칸의 호스트 이름만', { locationText: 'zoom.us' }],
    ['장소 칸이 비었을 때 메모에 호스트 이름만', { notes: '발표자료는 zoom.us 녹화본 참고' }],
    ['메모의 경로 있는 호스트는 장소가 있어도', { locationText: '코엑스', notes: '접속 zoom.us/j/123' }],
    ['메모의 스킴 있는 주소는 장소가 있어도', { locationText: '서울 강남구 테헤란로 152', notes: '못 오시면 https://zoom.us/j/1' }],
    ['장소 칸이 비었을 때 제목의 온라인 회의', { title: '온라인 회의 준비' }],
    ['장소: 온라인으로', { locationText: '온라인으로' }],
    ['장소: 온라인(Zoom)', { locationText: '온라인(Zoom)' }],
    ['장소: 온라인 미팅', { locationText: '온라인 미팅' }],
    ['webex 호스트', { notes: '접속: company.webex.com/meet/kim' }],
  ])('온라인이다: %s', (_name, over) => {
    expect(online(over)).toBe(true);
  });

  it.each([
    ['장소에 섞인 화상(병원)', { locationText: '베스티안 화상전문병원' }],
    ['장소에 섞인 비대면(진료센터)', { locationText: '비대면진료센터 본점' }],
    ['제목의 화상 한 단어', { title: '화상 치료' }],
    ['이메일 주소', { notes: '문의: help@zoom.us' }],
    ['다른 주소의 일부', { notes: 'https://example.com/redirect?to=zoom.us' }],
    ['뒤에 다른 도메인이 붙음', { notes: 'zoom.us.example.com/j/1' }],
    ['앞에 글자가 붙은 호스트', { notes: 'myzoom.us/j/1' }],
    ['장소 칸이 비어 있고 표시도 없음', {}],
    // 낱말 경계: 다른 말 안에 섞인 표시
    ['온라인으로 시작하는 단체 이름', { locationText: '온라인마케팅협회 강남사무소' }],
    ['zoom으로 시작하는 가게 이름', { locationText: 'zoomcafe 강남' }],
    ['줌이 든 스튜디오', { locationText: '줌 스튜디오' }],
    ['화상 병원(장소 전체가 화상이 아님)', { locationText: '화상 병원' }],
    ['teams가 든 사무실', { locationText: 'teams 사무실' }],
    // 제목만으로 보는 규칙은 장소 칸이 비었을 때만
    ['제목이 온라인 회의 준비이고 장소가 카페', { title: '온라인 회의 준비', locationText: '스타벅스 강남점' }],
    ['제목이 화상회의 후기이고 장소가 있음', { title: '화상회의 후기 모임', locationText: '광주 육전집' }],
    // 메모에 호스트 이름만 스쳐 언급되고 장소 칸에 실제 장소가 있음
    ['메모에 zoom.us가 문장 속에 있고 장소가 있음', { locationText: '코엑스', notes: '발표자료는 zoom.us 녹화본 참고' }],
    ['메모에 teams 호스트가 문장 속에 있고 장소가 있음', { locationText: '광주 육전집', notes: 'teams.microsoft.com 사용법 공유' }],
  ])('온라인이 아니다: %s', (_name, over) => {
    expect(online(over)).toBe(false);
  });
});

describe('건물 안 표시(정책서 12장)', () => {
  const indoor = (locationText: string | null) => detect({ locationText }) === 'meetingRoom';

  it.each([
    '회의실',
    '7층 대회의실',
    '3A룸',
    '본사 3층 대회의실',
    '미팅룸 B',
    '스터디룸',
    '룸',
    '룸 2',
    '라운지',
    '2층 라운지',
    '세미나실 1',
    '대강당',
    '3층',
    '지하 1층',
    '301호',
    '301호실',
    'A동 301호',
    'Meeting Room A',
    'Conference Room 4F',
    'Lounge',
    '본사 5층',
    '본사 2층 라운지',
    '12 층',
    // 영문 표시와 일반 말(정책서 12장 "실내 표시만 있다")
    'Room 301',
    '7F',
    '3F',
    'B1층',
    '지하1층',
    '7F 회의실',
    'Lounge 3F',
    'Meeting Room B, 3rd floor',
    'Room A',
    'board room',
    'Boardroom',
    'seminar room 2',
    'HQ 3F',
    '강당',
    '공동 회의실',
    '본사 7층 대회의실 (출입구 옆)',
    '3층 비상구 회의실',
    '1층 로비 회의실',
    // 주소가 아닌 말(세미나실로·오른쪽으로·합동·이동 가능·출입구·비상구)
    '세미나실로',
    '오른쪽으로 회의실',
    '합동 세미나실',
    '회의실 이동 가능',
    '회의실 출입구 옆',
    '회의실 5분 이동',
  ])('실내 표시와 일반 말만 있으면 건물 안이다: %s', (text) => {
    expect(indoor(text)).toBe(true);
  });

  it.each([
    ['주소(로)가 함께 있음', '서울 강남구 테헤란로 152 7층 회의실'],
    ['주소(길)가 함께 있음', '사직로8길 39 3층'],
    ['주소(동)가 함께 있음', '역삼동 301호'],
    ['주소(번지)가 함께 있음', '대치동 890-1번지 5층'],
    ['주소(대로)가 함께 있음', '세종대로 110 라운지'],
    ['주소(구)가 함께 있음', '강남구 스터디룸'],
    ['주소(시)가 함께 있음', '광주시 3층 강당'],
    ['쇼룸은 찾아가는 곳', '현대 모터스튜디오 쇼룸'],
    ['건물 이름 뒤의 층', '챔피언스필드 2층'],
    ['몰 안의 층', '롯데월드몰 8층'],
    ['공항 라운지', '인천공항 라운지'],
    // 고유한 장소 이름(영문 포함)이 함께 있으면 찾아가는 곳
    ['영문 건물명 뒤의 층(Starbucks)', 'Starbucks 2층'],
    ['영문 건물명 뒤의 층(WeWork)', 'WeWork 7층'],
    ['영문 건물명 뒤의 층(COEX)', 'COEX 3층'],
    ['영문 건물명이 길어도', 'Lotte World Mall 8층'],
    ['영문 이름 뒤의 라운지', 'IFC 라운지'],
    ['영문 이름 뒤의 LOUNGE', 'SKY LOUNGE'],
    ['두 글자 영문 이름 뒤의 층', 'LG 3층'],
    ['한글 건물명 뒤의 강당', '서울시청 강당'],
    ['학교 강당', '학교 강당'],
    ['식당의 VIP룸', '강남 레스토랑 VIP룸'],
    ['한정식 룸', '한정식 룸'],
    ['노래방 룸', '노래방 3번룸'],
    ['PC룸', 'PC룸'],
    ['파티룸', '파티룸'],
    ['건물 이름 뒤의 회의실', '강남 위워크 3층 회의실'],
    ['사옥 이름이 있는 회의실', '판교 사옥 회의실'],
    ['회의실 뒤에 다른 장소가 이어짐', '3층 회의실 or 강남역'],
    ['아파트 동·호 주소', '102동 1203호'],
    ['아파트 단지 이름이 있는 동·호 주소', '우리집 102동 1203호'],

    ['호선', '2호선 강남역'],
    ['호점', '교촌치킨 1호점'],
    ['호기', '3호기 앞'],
    ['층간', '층간 소음 상담'],
    ['실내 표시 없음', '광주 육전집'],
    ['베드룸', '베드룸 인테리어'],
    ['빈 장소', ''],
  ])('거르지 않는다: %s', (_name, text) => {
    expect(indoor(text)).toBe(false);
  });

  it('장소 칸이 없으면 거르지 않는다', () => {
    expect(indoor(null)).toBe(false);
  });

  it('온라인 표시가 같이 있으면 온라인이 먼저다', () => {
    expect(detect({ locationText: '3층 회의실', notes: 'https://meet.google.com/abc' })).toBe('online');
  });
});

describe('폰이 거르는 이유(정책서 10.3 표 1~3번)', () => {
  const reason = (over: { allDay?: boolean; title?: string; locationText?: string | null; notes?: string | null }) =>
    travelFilterReason({ allDay: false, title: '팀 회의', locationText: null, notes: null, ...over });

  it('종일 일정이 먼저다. 장소나 온라인 표시가 있어도 종일이다', () => {
    expect(reason({ allDay: true })).toBe('allDay');
    expect(reason({ allDay: true, locationText: '온라인' })).toBe('allDay');
  });

  it('온라인 → 건물 안 순서로 본다', () => {
    expect(reason({ locationText: 'Zoom' })).toBe('online');
    expect(reason({ locationText: '7층 대회의실' })).toBe('meetingRoom');
    expect(reason({ locationText: '3층 회의실', notes: 'https://zoom.us/j/1' })).toBe('online');
  });

  it('장소 칸이 빈 일정과 보통 일정은 거르지 않는다', () => {
    expect(reason({})).toBeNull();
    expect(reason({ locationText: '' })).toBeNull();
    expect(reason({ locationText: '광주 육전집' })).toBeNull();
    expect(reason({ locationText: '서울 강남구 테헤란로 152 7층 회의실' })).toBeNull();
  });
});

describe('noTravel.ts는 다른 모듈을 가져오지 않는다(폰의 Metro가 소스 그대로 읽는다)', () => {
  const source = readFileSync(new URL('../src/noTravel.ts', import.meta.url), 'utf8');
  // 주석은 빼고 코드만 본다.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('import·require·동적 import·export from이 없다', () => {
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\bexport\s+(?:\*|\{[^}]*\})\s+from\b/);
  });

  it('이 검사가 실제로 import를 알아본다', () => {
    expect("import { x } from './a.js';\nexport const y = 1;").toMatch(/^\s*import\b/m);
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

  it('폰에서 "이동 일정이에요"로 바꾼 일정(travelConfirmed)은 안전망이 거르지 않고 차량 응답에 남는다', async () => {
    const app = makeApp();
    const res = await json(app, 'PUT', '/events', {
      events: [
        ev('zoom', { title: '주간 회의', notes: 'https://zoom.us/j/1', travelConfirmed: true }),
        ev('room', { title: '기획 리뷰', locationText: '본사 3층 회의실', travelConfirmed: false }),
      ],
    });
    expect(res.status).toBe(200);
    const rows = await places(app);
    expect(rows.zoom).toMatchObject({ noTravel: false, noTravelReason: null });
    expect(rows.room).toMatchObject({ noTravel: true, noTravelReason: 'meetingRoom' });
    expect((await today(app)).map((s) => s.id)).toEqual(['zoom']);
    const stored = (await (await app.request('/events?date=2026-11-11')).json()) as { events: Record<string, unknown>[] };
    expect(stored.events.find((e) => e.id === 'zoom')?.travelConfirmed).toBe(true);
    expect(stored.events.find((e) => e.id === 'room')).not.toHaveProperty('travelConfirmed');
  });

  it('travelConfirmed가 boolean이 아니면 400이다', async () => {
    const app = makeApp();
    expect((await json(app, 'PUT', '/events', { events: [ev('x', { travelConfirmed: 'yes' })] })).status).toBe(400);
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

  it('종일 일정은 장소 칸이 온라인·건물 안 표시여도 거르지 않는다(차가 첫 탑승 인사에 이름을 쓴다)', async () => {
    const app = makeApp();
    const res = await json(app, 'PUT', '/events', {
      events: [
        ev('trip', { title: '제주 출장', allDay: true, start: '2026-11-11T00:00:00+09:00', end: '2026-11-12T00:00:00+09:00', locationText: '온라인' }),
        ev('workshop', { title: '팀 워크숍', allDay: true, start: '2026-11-11T00:00:00+09:00', end: '2026-11-12T00:00:00+09:00', locationText: '본사 3층 회의실', notes: 'https://zoom.us/j/1' }),
        ev('room', { title: '기획 리뷰', locationText: '본사 3층 회의실' }),
      ],
    });
    expect(res.status).toBe(200);
    const car = (await today(app)) as { id: string; allDay?: boolean; title: string }[];
    expect(car.map((s) => s.id).sort()).toEqual(['trip', 'workshop']);
    expect(car.map((s) => s.title).sort()).toEqual(['제주 출장', '팀 워크숍']);
    // 종일은 3단계 목록에 없다(이동 대상이 아님). 거르는 이동 없음 이유도 붙지 않는다.
    expect(Object.keys(await places(app))).toEqual(['room']);
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
