import { allDayToSeoulMidnight, DAY_MS, todayAndTomorrow } from '../calendar-sync/seoulTime';
import { CalendarPermissionError, type CalendarSource, type DeviceCalendar, type DeviceEvent } from './calendarSource';

// 서버 limits.ts와 같은 값. 넘기면 서버가 400으로 거절하므로 보내기 전에 자른다.
export const MAX_EVENTS = 200;
const MAX_ID = 100;
const MAX_TITLE = 200;
const MAX_LOCATION = 300;
const MAX_NOTES = 2000;
const MAX_ATTENDEES = 50;
const MAX_ATTENDEE_NAME = 100;
/** 참석자를 읽는 일정 수와 한 번에 읽는 수. 네이티브 호출이 한꺼번에 몰리지 않게 한다. */
export const ATTENDEE_LOOKUP_LIMIT = 50;
const ATTENDEE_CONCURRENCY = 10;
const EMAIL_LIKE = /^\S+@\S+\.\S+$/;

// expo-calendar는 처음 쓸 때 불러온다. 목 출처로 돌 때는 네이티브 모듈을 건드리지 않는다.
// 새 객체 API(expo-calendar)는 Expo Go에서 쓸 수 없어 legacy 함수 API를 쓴다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadCalendar = async () => require('expo-calendar/legacy') as typeof import('expo-calendar/legacy');

async function ensurePermission(ask: boolean): Promise<void> {
  const Calendar = await loadCalendar();
  let response = await Calendar.getCalendarPermissionsAsync();
  if (!response.granted && ask && response.canAskAgain) response = await Calendar.requestCalendarPermissionsAsync();
  if (!response.granted) throw new CalendarPermissionError(response.canAskAgain);
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);
const toMs = (value: string | Date) => new Date(value).getTime();
/** 참석자 이름만 남긴다. 본인(isCurrentUser)·주최자 이메일과 같은 사람·이메일 형식 이름·빈 이름은 뺀다. */
export function attendeeNames(list: { name?: string; email?: string; isCurrentUser?: boolean }[], organizerEmail?: string): string[] {
  return list
    .filter((a) => a.isCurrentUser !== true && !(organizerEmail && a.email && a.email.toLowerCase() === organizerEmail.toLowerCase()))
    .map((a) => (a.name ?? '').trim())
    .filter((name) => name !== '' && !EMAIL_LIKE.test(name))
    .slice(0, MAX_ATTENDEES)
    .map((name) => clip(name, MAX_ATTENDEE_NAME));
}

/**
 * 참석자 이메일(소문자, 중복 없음). 폰 안에서 연락처의 이메일과 맞춰 연락 상대를 찾는 데만 쓰고 서버로 보내지 않는다(`docs/contacts.md`).
 * 본인(isCurrentUser)·주최자 이메일과 같은 사람·이메일 모양이 아닌 값은 뺀다.
 */
export function attendeeEmails(list: { email?: string; isCurrentUser?: boolean }[], organizerEmail?: string): string[] {
  const seen = new Set<string>();
  for (const a of list) {
    const email = (a.email ?? '').trim().toLowerCase();
    if (a.isCurrentUser === true || !EMAIL_LIKE.test(email) || email === (organizerEmail ?? '').trim().toLowerCase()) continue;
    seen.add(email);
    if (seen.size >= MAX_ATTENDEES) break;
  }
  return [...seen];
}

const nonEmpty = (value: string | null | undefined) => (value === null || value === undefined || value.trim() === '' ? null : value);

/**
 * 기본 체크(정책서 10.2 종류 가르기): Android 접근 수준이 소유·편집 가능(owner·root·editor·contributor)이면 내 것·공유 캘린더라 체크하고,
 * 읽기 전용(read·respond·freebusy·none…)인 공휴일·생일·구독 캘린더는 해제한다. 접근 수준을 모르는 캘린더만 기본 캘린더(isPrimary)를 따른다.
 */
const WRITABLE_ACCESS = new Set(['owner', 'root', 'editor', 'contributor']);
export const isDefaultSelected = (c: { isPrimary?: boolean; accessLevel?: string }) =>
  c.accessLevel === undefined || c.accessLevel === '' ? c.isPrimary === true : WRITABLE_ACCESS.has(c.accessLevel);

export const deviceCalendarSource: CalendarSource = {
  kind: 'device',

  async list() {
    await ensurePermission(true);
    const Calendar = await loadCalendar();
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return calendars
      .filter((c) => c.isVisible !== false)
      .map((c): DeviceCalendar => ({
        id: c.id,
        name: c.title,
        source: c.source?.name || c.ownerAccount || '',
        color: c.color,
        defaultSelected: isDefaultSelected(c),
      }));
  },

  async listEvents(calendarIds, now = new Date()) {
    await ensurePermission(false);
    if (calendarIds.length === 0) return [];
    const Calendar = await loadCalendar();
    const { start, end } = todayAndTomorrow(now);
    // 반복 일정은 Android에서 해당 기간의 인스턴스로 펼쳐져 나온다.
    const raw = await Calendar.getEventsAsync(calendarIds, start, end);
    const events: DeviceEvent[] = [];
    const sources: { e: (typeof raw)[number]; startMs: number }[] = [];
    for (const e of raw) {
      const startMs = toMs(e.startDate);
      const endMs = toMs(e.endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || e.calendarId === '') continue;
      const id = clip(`${e.id}@${startMs}`, MAX_ID); // 같은 반복 일정의 날짜별 인스턴스를 구분한다
      // 종일 일정은 UTC 자정 날짜로 오므로 서울 날짜로 다시 읽는다. 끝은 마지막 날 다음 자정(미포함).
      const s = e.allDay ? allDayToSeoulMidnight(startMs) : startMs;
      let t = e.allDay ? allDayToSeoulMidnight(endMs) : endMs;
      if (t < s || (e.allDay && t === s)) t = e.allDay ? s + DAY_MS : s;
      events.push({
        id,
        calendarId: clip(e.calendarId, MAX_ID),
        title: clip(e.title ?? '', MAX_TITLE),
        start: new Date(s).toISOString(),
        end: new Date(t).toISOString(),
        allDay: e.allDay,
        locationText: nonEmpty(e.location) === null ? null : clip(e.location as string, MAX_LOCATION),
        notes: nonEmpty(e.notes) === null ? null : clip(e.notes, MAX_NOTES),
        attendees: [],
      });
      sources.push({ e, startMs });
      if (events.length >= MAX_EVENTS) break;
    }
    // 참석자는 앞쪽 일정부터 ATTENDEE_LOOKUP_LIMIT건까지만, 한 번에 ATTENDEE_CONCURRENCY건씩 병렬로 읽는다.
    const lookups = Math.min(events.length, ATTENDEE_LOOKUP_LIMIT);
    for (let from = 0; from < lookups; from += ATTENDEE_CONCURRENCY) {
      const chunk = sources.slice(from, Math.min(from + ATTENDEE_CONCURRENCY, lookups));
      const found = await Promise.all(
        chunk.map(async ({ e, startMs }) => {
          try {
            const list = await Calendar.getAttendeesForEventAsync(e.id, { instanceStartDate: new Date(startMs).toISOString() });
            return { names: attendeeNames(list, e.organizerEmail), emails: attendeeEmails(list, e.organizerEmail) };
          } catch {
            return { names: [], emails: [] }; // 참석자를 못 읽어도 일정은 보낸다
          }
        }),
      );
      found.forEach(({ names, emails }, i) => {
        events[from + i].attendees = names;
        events[from + i].attendeeEmails = emails;
      });
    }
    return events;
  },
};
