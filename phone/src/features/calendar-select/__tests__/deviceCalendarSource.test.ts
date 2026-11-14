import { CalendarPermissionError } from '../calendarSource';
import { ATTENDEE_LOOKUP_LIMIT, attendeeEmails, deviceCalendarSource, isDefaultSelected, MAX_EVENTS } from '../deviceCalendarSource';

const mockCalendar = {
  getCalendarPermissionsAsync: jest.fn(),
  requestCalendarPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  getEventsAsync: jest.fn(),
  getAttendeesForEventAsync: jest.fn(),
  EntityTypes: { EVENT: 'event' },
};
jest.mock('expo-calendar/legacy', () => mockCalendar);

const granted = { granted: true, canAskAgain: true };
const denied = (canAskAgain: boolean) => ({ granted: false, canAskAgain });

beforeEach(() => {
  Object.values(mockCalendar).forEach((m) => typeof m === 'function' && (m as jest.Mock).mockReset());
  mockCalendar.getAttendeesForEventAsync.mockResolvedValue([]);
});

const calendar = (over: Record<string, unknown> = {}) => ({
  id: '1',
  title: '내 캘린더',
  color: '#3367d6',
  source: { name: 'me@gmail.com', type: 'com.google' },
  ownerAccount: 'me@gmail.com',
  isPrimary: true,
  accessLevel: 'owner',
  isVisible: true,
  ...over,
});

describe('권한', () => {
  it('이미 허용돼 있으면 묻지 않고 목록을 읽는다', async () => {
    mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(granted);
    mockCalendar.getCalendarsAsync.mockResolvedValue([]);
    await deviceCalendarSource.list();
    expect(mockCalendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('목록을 읽을 때는 권한을 요청하고 허용되면 읽는다', async () => {
    mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(denied(true));
    mockCalendar.requestCalendarPermissionsAsync.mockResolvedValue(granted);
    mockCalendar.getCalendarsAsync.mockResolvedValue([calendar()]);
    expect(await deviceCalendarSource.list()).toHaveLength(1);
    expect(mockCalendar.requestCalendarPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('거부하면 CalendarPermissionError를 던지고 캘린더를 읽지 않는다(목으로 넘어가지 않는다)', async () => {
    mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(denied(true));
    mockCalendar.requestCalendarPermissionsAsync.mockResolvedValue(denied(false));
    await expect(deviceCalendarSource.list()).rejects.toMatchObject({ name: 'CalendarPermissionError', canAskAgain: false });
    expect(mockCalendar.getCalendarsAsync).not.toHaveBeenCalled();
  });

  it('다시 묻을 수 없으면 요청 없이 바로 던진다', async () => {
    mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(denied(false));
    await expect(deviceCalendarSource.list()).rejects.toBeInstanceOf(CalendarPermissionError);
    expect(mockCalendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('일정 읽기는 권한 창을 띄우지 않고 던진다', async () => {
    mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(denied(true));
    await expect(deviceCalendarSource.listEvents(['1'])).rejects.toBeInstanceOf(CalendarPermissionError);
    expect(mockCalendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(mockCalendar.getEventsAsync).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  beforeEach(() => mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(granted));

  it('이름·계정·색을 옮기고 숨긴 캘린더는 뺀다. 기본 체크는 접근 수준이 소유·편집 가능인 캘린더', async () => {
    mockCalendar.getCalendarsAsync.mockResolvedValue([
      calendar(),
      calendar({ id: '2', title: '구독', isPrimary: false, accessLevel: 'read', source: { name: 'Holidays' } }),
      calendar({ id: '3', title: '숨김', isVisible: false }),
      calendar({ id: '4', title: '가족', isPrimary: false, accessLevel: 'owner' }),
      calendar({ id: '5', title: '공유', isPrimary: false, accessLevel: 'editor', source: { name: 'Team' } }),
    ]);
    expect(await deviceCalendarSource.list()).toEqual([
      { id: '1', name: '내 캘린더', source: 'me@gmail.com', color: '#3367d6', defaultSelected: true },
      { id: '2', name: '구독', source: 'Holidays', color: '#3367d6', defaultSelected: false },
      { id: '4', name: '가족', source: 'me@gmail.com', color: '#3367d6', defaultSelected: true },
      { id: '5', name: '공유', source: 'Team', color: '#3367d6', defaultSelected: true },
    ]);
    expect(mockCalendar.getCalendarsAsync).toHaveBeenCalledWith('event');
  });
});

describe('기본 체크(접근 수준, 정책서 10.2 종류 가르기)', () => {
  it.each([
    ['owner', true],
    ['root', true],
    ['editor', true],
    ['contributor', true],
    ['read', false],
    ['respond', false],
    ['freebusy', false],
    ['none', false],
    ['override', false],
  ])('접근 수준 %s → 체크 %s', (accessLevel, expected) => {
    expect(isDefaultSelected({ accessLevel })).toBe(expected);
  });

  it('읽기 전용이면 기본 캘린더 표시가 있어도 해제한다(공휴일·구독)', () => {
    expect(isDefaultSelected({ accessLevel: 'read', isPrimary: true })).toBe(false);
  });

  it('소유 캘린더는 기본 캘린더가 아니어도 체크한다(공유·가족)', () => {
    expect(isDefaultSelected({ accessLevel: 'editor', isPrimary: false })).toBe(true);
  });

  it('접근 수준을 모를 때만 기본 캘린더 표시를 따른다', () => {
    expect(isDefaultSelected({ isPrimary: true })).toBe(true);
    expect(isDefaultSelected({ isPrimary: false })).toBe(false);
    expect(isDefaultSelected({})).toBe(false);
  });
});

describe('참석자 이름', () => {
  beforeEach(() => mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(granted));
  const now = new Date('2026-11-11T10:00:00+09:00');
  const raw = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    calendarId: '1',
    title: '회의',
    location: null,
    notes: '',
    startDate: '2026-11-11T05:00:00.000Z',
    endDate: '2026-11-11T06:00:00.000Z',
    allDay: false,
    ...over,
  });

  it('본인·주최자·이메일 형식 이름·빈 이름은 빼고 이름만 보낸다', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue([raw('1', { organizerEmail: 'boss@corp.com' })]);
    mockCalendar.getAttendeesForEventAsync.mockResolvedValue([
      { name: '나', email: 'me@corp.com', isCurrentUser: true },
      { name: '팀장', email: 'BOSS@corp.com' },
      { name: 'kim@corp.com', email: 'kim@corp.com' },
      { name: '', email: 'x@corp.com' },
      { name: '김철수', email: 'cs@corp.com' },
    ]);
    const [event] = await deviceCalendarSource.listEvents(['1'], now);
    expect(event.attendees).toEqual(['김철수']);
  });

  it('참석자는 앞쪽 50개 일정까지만 읽고 한 번에 10개씩 병렬로 읽는다', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue(Array.from({ length: 80 }, (_, i) => raw(`e${i}`)));
    let active = 0;
    let peak = 0;
    mockCalendar.getAttendeesForEventAsync.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return [{ name: '김철수' }];
    });
    const events = await deviceCalendarSource.listEvents(['1'], now);
    expect(events).toHaveLength(80);
    expect(mockCalendar.getAttendeesForEventAsync).toHaveBeenCalledTimes(ATTENDEE_LOOKUP_LIMIT);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(10);
    expect(events[49].attendees).toEqual(['김철수']);
    expect(events[50].attendees).toEqual([]);
  });
});

describe('listEvents', () => {
  beforeEach(() => mockCalendar.getCalendarPermissionsAsync.mockResolvedValue(granted));
  // 서울 2026-11-11 10:00
  const now = new Date('2026-11-11T10:00:00+09:00');
  const raw = (over: Record<string, unknown> = {}) => ({
    id: '10',
    calendarId: '1',
    title: '팀 회의',
    location: '광주 육전집',
    notes: '자료 챙기기',
    startDate: '2026-11-11T05:00:00.000Z',
    endDate: '2026-11-11T06:00:00.000Z',
    allDay: false,
    ...over,
  });

  it('선택한 캘린더의 서울 오늘 0시~모레 0시를 조회한다', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue([]);
    await deviceCalendarSource.listEvents(['1', '2'], now);
    const [ids, start, end] = mockCalendar.getEventsAsync.mock.calls[0];
    expect(ids).toEqual(['1', '2']);
    expect((start as Date).toISOString()).toBe('2026-11-10T15:00:00.000Z'); // 11-11 00:00 KST
    expect((end as Date).toISOString()).toBe('2026-11-12T15:00:00.000Z'); // 11-13 00:00 KST
  });

  it('고른 캘린더가 없으면 읽지 않고 빈 목록', async () => {
    expect(await deviceCalendarSource.listEvents([], now)).toEqual([]);
    expect(mockCalendar.getEventsAsync).not.toHaveBeenCalled();
  });

  it('제목·시작·종료·장소 칸·메모와 참석자 이름·이메일을 옮긴다(참석자는 폰 안에서 연락 상대를 찾는 데만 쓰고 서버로 보내지 않는다)', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue([raw()]);
    mockCalendar.getAttendeesForEventAsync.mockResolvedValue([
      { name: '김철수', email: 'kim@example.com' },
      { name: ' ', email: 'nobody@example.com' },
      { name: '이영희' },
    ]);
    expect(await deviceCalendarSource.listEvents(['1'], now)).toEqual([
      {
        id: '10@1794373200000',
        calendarId: '1',
        title: '팀 회의',
        start: '2026-11-11T05:00:00.000Z',
        end: '2026-11-11T06:00:00.000Z',
        allDay: false,
        locationText: '광주 육전집',
        notes: '자료 챙기기',
        attendees: ['김철수', '이영희'],
        attendeeEmails: ['kim@example.com', 'nobody@example.com'],
      },
    ]);
  });

  it('반복 일정은 날짜별 인스턴스마다 다른 id를 받는다', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue([
      raw({ startDate: '2026-11-11T05:00:00.000Z' }),
      raw({ startDate: '2026-11-12T05:00:00.000Z', endDate: '2026-11-12T06:00:00.000Z' }),
    ]);
    const events = await deviceCalendarSource.listEvents(['1'], now);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
    expect(mockCalendar.getAttendeesForEventAsync).toHaveBeenCalledWith('10', { instanceStartDate: '2026-11-12T05:00:00.000Z' });
  });

  it('빈 장소·메모는 null, 참석자를 못 읽어도 일정은 보낸다', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue([raw({ location: '', notes: '  ' })]);
    mockCalendar.getAttendeesForEventAsync.mockRejectedValue(new Error('x'));
    const [event] = await deviceCalendarSource.listEvents(['1'], now);
    expect(event).toMatchObject({ locationText: null, notes: null, attendees: [], attendeeEmails: [] });
  });

  it('종일 일정은 UTC 날짜를 서울 날짜 자정으로 바꾸고 끝은 다음 날 자정(미포함)', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue([
      raw({ allDay: true, startDate: '2026-11-11T00:00:00.000Z', endDate: '2026-11-12T00:00:00.000Z' }),
      raw({ id: '11', allDay: true, startDate: '2026-11-12T00:00:00.000Z', endDate: '2026-11-12T00:00:00.000Z' }),
    ]);
    const events = await deviceCalendarSource.listEvents(['1'], now);
    expect(events[0]).toMatchObject({ start: '2026-11-10T15:00:00.000Z', end: '2026-11-11T15:00:00.000Z', allDay: true });
    expect(events[1]).toMatchObject({ start: '2026-11-11T15:00:00.000Z', end: '2026-11-12T15:00:00.000Z' });
  });

  it('서버 상한에 맞춰 긴 글을 자르고 일정은 200개까지만 보낸다', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue(
      Array.from({ length: MAX_EVENTS + 5 }, (_, i) => raw({ id: `e${i}`, title: 'x'.repeat(500), notes: 'y'.repeat(5000), location: 'z'.repeat(500) })),
    );
    mockCalendar.getAttendeesForEventAsync.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ name: `n${i}${'a'.repeat(200)}` })));
    const events = await deviceCalendarSource.listEvents(['1'], now);
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[0].title).toHaveLength(200);
    expect(events[0].notes).toHaveLength(2000);
    expect(events[0].locationText).toHaveLength(300);
    expect(events[0].attendees).toHaveLength(50);
    expect(events[0].attendees[0]).toHaveLength(100);
  });

  it('날짜를 읽을 수 없는 일정은 건너뛴다', async () => {
    mockCalendar.getEventsAsync.mockResolvedValue([raw({ startDate: 'garbage' }), raw({ id: '12' })]);
    expect((await deviceCalendarSource.listEvents(['1'], now)).map((e) => e.id.split('@')[0])).toEqual(['12']);
  });
});

describe('attendeeEmails', () => {
  it('소문자·중복 없음으로 모으고 본인·주최자·이메일 모양이 아닌 값은 뺀다', () => {
    expect(
      attendeeEmails(
        [
          { email: 'Kim@Example.com' },
          { email: ' kim@example.com ' },
          { email: 'me@example.com', isCurrentUser: true },
          { email: 'ORG@example.com' },
          { email: 'not-an-email' },
          { email: '' },
          {},
          { email: 'lee@example.com' },
        ],
        'org@example.com',
      ),
    ).toEqual(['kim@example.com', 'lee@example.com']);
  });

  it('참석자 상한(50명)까지만 모은다', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ email: `p${i}@example.com` }));
    expect(attendeeEmails(many)).toHaveLength(50);
  });
});
