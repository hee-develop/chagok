import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIXTURE_URL,
  loadDayFixture,
  loadMockCalendars,
  parseDayFixture,
  parseMockCalendars,
  resolveFixtureLocation,
} from '../src/fixtures.js';

const schedule = {
  id: 's1',
  calendarId: 'mock-my',
  title: '점심',
  startOffsetMinutes: 0,
  endOffsetMinutes: 60,
  allDay: false,
  locationText: '광주 육전집',
  place: { name: '광주 육전집', lat: 35.1, lng: 126.8 },
  memo: null,
  attendees: [],
};
const day = (s: unknown) => ({ id: 'd', name: 'n', schedules: [s] });

describe('parseDayFixture', () => {
  it('올바른 픽스처는 통과한다', () => {
    expect(parseDayFixture(day(schedule)).schedules).toHaveLength(1);
    expect(parseDayFixture(day({ ...schedule, place: null, locationText: null }))).toBeTruthy();
  });

  it('place.alias(말·버튼에 쓰는 짧은 이름)는 비어 있지 않은 문자열만 받는다', () => {
    expect(parseDayFixture(day({ ...schedule, place: { name: '광주-기아 챔피언스필드', alias: '챔필', lat: 35.1, lng: 126.8 } })).schedules[0]!.place).toMatchObject({ alias: '챔필' });
    expect(() => parseDayFixture(day({ ...schedule, place: { name: 'x', alias: '', lat: 1, lng: 2 } }))).toThrow(/픽스처 일정 형식/);
    expect(() => parseDayFixture(day({ ...schedule, place: { name: 'x', alias: 3, lat: 1, lng: 2 } }))).toThrow(/픽스처 일정 형식/);
  });

  it.each([
    ['place.lat이 문자열', { ...schedule, place: { name: 'x', lat: '35.1', lng: 126.8 } }],
    ['place.lng가 없음', { ...schedule, place: { name: 'x', lat: 35.1 } }],
    ['place.lat이 NaN', { ...schedule, place: { name: 'x', lat: Number.NaN, lng: 1 } }],
    ['place가 undefined', { ...schedule, place: undefined }],
    ['memo가 숫자', { ...schedule, memo: 3 }],
    ['locationText가 undefined', { ...schedule, locationText: undefined }],
    ['attendees가 문자열 아님', { ...schedule, attendees: [1] }],
    ['attendees가 배열 아님', { ...schedule, attendees: 'a' }],
  ])('%s이면 거부한다', (_name, bad) => {
    expect(() => parseDayFixture(day(bad))).toThrow(/픽스처 일정 형식/);
  });
});

describe('parseDayFixture 값 검증', () => {
  it.each([
    ['id가 빈 문자열', { ...schedule, id: '' }],
    ['시작 오프셋이 소수', { ...schedule, startOffsetMinutes: 1.5 }],
    ['종료 오프셋이 소수', { ...schedule, endOffsetMinutes: 59.9 }],
    ['오프셋이 7일 초과', { ...schedule, endOffsetMinutes: 7 * 24 * 60 + 1 }],
    ['오프셋이 -7일 미만', { ...schedule, startOffsetMinutes: -7 * 24 * 60 - 1 }],
    ['end가 start보다 앞', { ...schedule, startOffsetMinutes: 60, endOffsetMinutes: 30 }],
  ])('%s이면 거부한다', (_name, bad) => {
    expect(() => parseDayFixture(day(bad))).toThrow(/픽스처 일정/);
  });

  it('id가 겹치면 거부한다', () => {
    expect(() => parseDayFixture({ id: 'd', name: 'n', schedules: [schedule, schedule] })).toThrow(/id/);
  });

  it('경계값(±7일, end == start)은 통과한다', () => {
    const edge = { ...schedule, id: 'e', startOffsetMinutes: -7 * 24 * 60, endOffsetMinutes: -7 * 24 * 60 };
    expect(parseDayFixture({ id: 'd', name: 'n', schedules: [edge, { ...schedule, endOffsetMinutes: 7 * 24 * 60 }] })).toBeTruthy();
  });
});

describe('calendarId 검증', () => {
  it.each([
    ['calendarId 없음', { ...schedule, calendarId: undefined }],
    ['calendarId가 숫자', { ...schedule, calendarId: 1 }],
  ])('%s이면 거부한다', (_name, bad) => {
    expect(() => parseDayFixture(day(bad))).toThrow(/픽스처 일정 형식/);
  });

  it('목 캘린더에 없는 calendarId면 거부한다', () => {
    expect(() => parseDayFixture(day({ ...schedule, calendarId: 'nope' }))).toThrow(/calendarId/);
  });

  it('기본 픽스처의 모든 일정 calendarId가 목 캘린더에 있다', () => {
    const ids = new Set(loadMockCalendars().map((c) => c.id));
    for (const s of loadDayFixture().schedules) expect(ids.has(s.calendarId)).toBe(true);
  });
});

describe('parseMockCalendars', () => {
  const cal = { id: 'a', name: 'n', account: 'x', color: '#000000', defaultSelected: true };

  it('기본 목 캘린더는 6개이고 기본 선택은 3개다', () => {
    const list = loadMockCalendars();
    expect(list).toHaveLength(6);
    expect(list.filter((c) => c.defaultSelected).map((c) => c.id)).toEqual(['mock-my', 'mock-work', 'mock-family']);
  });

  it.each([
    ['calendars 없음', {}],
    ['빈 배열', { calendars: [] }],
    ['id가 빈 문자열', { calendars: [{ ...cal, id: '' }] }],
    ['defaultSelected가 문자열', { calendars: [{ ...cal, defaultSelected: 'yes' }] }],
    ['id 중복', { calendars: [cal, cal] }],
  ])('%s이면 거부한다', (_name, bad) => {
    expect(() => parseMockCalendars(bad)).toThrow(/목 캘린더/);
  });
});

describe('resolveFixtureLocation', () => {
  it('값이 없으면 기본 픽스처(저장소 루트 fixtures/)다', () => {
    expect(resolveFixtureLocation(undefined)).toBe(DEFAULT_FIXTURE_URL);
    expect(loadDayFixture(resolveFixtureLocation(undefined)).schedules.length).toBeGreaterThan(0);
  });

  it('상대 경로는 작업 폴더가 아니라 저장소 루트 기준이다', () => {
    const resolved = resolveFixtureLocation('fixtures/schedules/gwangju-day.json') as string;
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved.endsWith('/fixtures/schedules/gwangju-day.json')).toBe(true);
    const before = process.cwd();
    process.chdir('/');
    try {
      expect(loadDayFixture(resolveFixtureLocation('fixtures/schedules/gwangju-day.json')).schedules.length).toBeGreaterThan(0);
    } finally {
      process.chdir(before);
    }
  });

  it('절대 경로는 그대로 쓴다', () => {
    expect(resolveFixtureLocation('/tmp/x.json')).toBe('/tmp/x.json');
  });

  it('없는 파일은 경로가 담긴 오류다', () => {
    expect(() => loadDayFixture('/nonexistent/x.json')).toThrow(/픽스처를 읽을 수 없습니다.*x\.json/);
  });
});
