import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DayFixture, FamilyMember, MockCalendar, MockPlace, PlaceSuggestion, PlacesCatalog, RememberedPlace } from './fixture-types.js';

export type { DayFixture, MockCalendar, PlaceFixture, ScheduleFixture } from './fixture-types.js';

/** 저장소 루트 fixtures/schedules/gwangju-day.json. 이 파일 기준 상대 경로로 푼다(src와 dist 모두 server/ 아래). */
export const DEFAULT_FIXTURE_URL = new URL('../../fixtures/schedules/gwangju-day.json', import.meta.url);

/** 저장소 루트. FIXTURE_PATH의 상대 경로는 현재 작업 폴더가 아니라 여기를 기준으로 푼다. */
export const REPO_ROOT_URL = new URL('../../', import.meta.url);

/**
 * FIXTURE_PATH 값을 읽을 위치로 바꾼다. 없으면 기본 픽스처, 절대 경로는 그대로, 상대 경로는 저장소 루트 기준.
 */
export function resolveFixtureLocation(fixturePath: string | undefined): URL | string {
  if (fixturePath === undefined || fixturePath === '') return DEFAULT_FIXTURE_URL;
  return isAbsolute(fixturePath) ? fixturePath : fileURLToPath(new URL(fixturePath, REPO_ROOT_URL));
}

/** 저장소 루트 fixtures/calendars/mock-device.json. 폰 앱의 목 캘린더 목록과 같은 파일이다. */
export const MOCK_CALENDARS_URL = new URL('../../fixtures/calendars/mock-device.json', import.meta.url);

export function parseMockCalendars(value: unknown): MockCalendar[] {
  const list = (value as { calendars?: unknown } | null)?.calendars;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('목 캘린더 형식이 올바르지 않습니다: calendars 배열이 필요합니다');
  }
  const ids = new Set<string>();
  for (const c of list) {
    const ok =
      typeof c?.id === 'string' &&
      c.id !== '' &&
      typeof c.name === 'string' &&
      typeof c.account === 'string' &&
      typeof c.color === 'string' &&
      typeof c.defaultSelected === 'boolean';
    if (!ok) throw new Error(`목 캘린더 항목 형식이 올바르지 않습니다: ${JSON.stringify(c)}`);
    if (ids.has(c.id)) throw new Error(`목 캘린더 id가 중복되었습니다: ${JSON.stringify(c.id)}`);
    ids.add(c.id);
  }
  return list as MockCalendar[];
}

export function loadMockCalendars(location: URL | string = MOCK_CALENDARS_URL): MockCalendar[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(location, 'utf8'));
  } catch (e) {
    throw new Error(`목 캘린더를 읽을 수 없습니다(${String(location)}): ${(e as Error).message}`);
  }
  return parseMockCalendars(parsed);
}

export function loadDayFixture(
  location: URL | string = DEFAULT_FIXTURE_URL,
  calendars: MockCalendar[] = loadMockCalendars(),
): DayFixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(location, 'utf8'));
  } catch (e) {
    throw new Error(`픽스처를 읽을 수 없습니다(${String(location)}): ${(e as Error).message}`);
  }
  return parseDayFixture(parsed, calendars);
}

/** 시작·종료 오프셋(분)의 허용 범위. ±7일 */
const MAX_OFFSET_MINUTES = 7 * 24 * 60;

const isNullableString = (v: unknown) => v === null || typeof v === 'string';

function isPlace(v: unknown): boolean {
  const p = v as Record<string, unknown> | null;
  return (
    !!p &&
    typeof p.name === 'string' &&
    typeof p.lat === 'number' &&
    Number.isFinite(p.lat) &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lng)
  );
}

export function parseDayFixture(value: unknown, calendars: MockCalendar[] = loadMockCalendars()): DayFixture {
  const root = value as Partial<DayFixture> | null;
  if (!root || typeof root.id !== 'string' || typeof root.name !== 'string' || !Array.isArray(root.schedules)) {
    throw new Error('픽스처 형식이 올바르지 않습니다: id, name, schedules가 필요합니다');
  }
  const ids = new Set<string>();
  const calendarIds = new Set(calendars.map((c) => c.id));
  for (const s of root.schedules) {
    const ok =
      typeof s?.id === 'string' &&
      typeof s.calendarId === 'string' &&
      typeof s.title === 'string' &&
      Number.isFinite(s.startOffsetMinutes) &&
      Number.isFinite(s.endOffsetMinutes) &&
      typeof s.allDay === 'boolean' &&
      isNullableString(s.locationText) &&
      isNullableString(s.memo) &&
      (s.place === null || isPlace(s.place)) &&
      Array.isArray(s.attendees) &&
      s.attendees.every((a) => typeof a === 'string');
    if (!ok) {
      throw new Error(
        `픽스처 일정 형식이 올바르지 않습니다(locationText·memo는 문자열 또는 null, place는 {name, lat, lng} 또는 null, attendees는 문자열 배열): ${JSON.stringify(s)}`,
      );
    }
    if (s.id === '' || ids.has(s.id)) {
      throw new Error(`픽스처 일정 id는 비어 있지 않고 서로 달라야 합니다: ${JSON.stringify(s.id)}`);
    }
    ids.add(s.id);
    if (!calendarIds.has(s.calendarId)) {
      throw new Error(`픽스처 일정 calendarId가 목 캘린더 id에 없습니다: ${JSON.stringify(s.calendarId)}`);
    }
    const inRange = (m: number) => Number.isInteger(m) && Math.abs(m) <= MAX_OFFSET_MINUTES;
    if (!inRange(s.startOffsetMinutes) || !inRange(s.endOffsetMinutes) || s.endOffsetMinutes < s.startOffsetMinutes) {
      throw new Error(
        `픽스처 일정 시각 오프셋은 정수(분)이고 ±${MAX_OFFSET_MINUTES}분 이내이며 end가 start 이상이어야 합니다: ${JSON.stringify(s.id)}`,
      );
    }
  }
  return root as DayFixture;
}

/** 저장소 루트 fixtures/places/ 아래의 장소 검색 대상 목록과 추천. */
export const MOCK_PLACES_URL = new URL('../../fixtures/places/mock-places.json', import.meta.url);
export const PLACE_SUGGESTIONS_URL = new URL('../../fixtures/places/suggestions.json', import.meta.url);
export const REMEMBERED_PLACES_URL = new URL('../../fixtures/places/remembered.json', import.meta.url);

function isMockPlace(v: unknown): v is MockPlace {
  const p = v as Record<string, unknown> | null;
  return (
    !!p &&
    typeof p.id === 'string' &&
    p.id !== '' &&
    typeof p.name === 'string' &&
    p.name !== '' &&
    typeof p.address === 'string' &&
    typeof p.lat === 'number' &&
    Number.isFinite(p.lat) &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lng) &&
    (p.fictional === undefined || typeof p.fictional === 'boolean')
  );
}

/**
 * 목 장소 목록과 추천을 검증한다. 같은 목록 안에서 id가 겹치면 안 되고,
 * 두 목록에 같은 id가 있으면 이름·주소·좌표가 같아야 한다(같은 장소를 가리킨다).
 */
export function parsePlacesCatalog(placesValue: unknown, suggestionsValue: unknown, rememberedValue: unknown = { remembered: [] }): PlacesCatalog {
  const places = (placesValue as { places?: unknown } | null)?.places;
  const suggestions = (suggestionsValue as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(places) || places.length === 0) {
    throw new Error('목 장소 형식이 올바르지 않습니다: places 배열이 필요합니다');
  }
  if (!Array.isArray(suggestions)) {
    throw new Error('장소 추천 형식이 올바르지 않습니다: suggestions 배열이 필요합니다');
  }
  const byId = new Map<string, MockPlace>();
  for (const p of places) {
    if (!isMockPlace(p)) throw new Error(`목 장소 항목 형식이 올바르지 않습니다: ${JSON.stringify(p)}`);
    if (byId.has(p.id)) throw new Error(`목 장소 id가 중복되었습니다: ${JSON.stringify(p.id)}`);
    byId.set(p.id, p);
  }
  const suggestionIds = new Set<string>();
  for (const s of suggestions) {
    if (!isMockPlace(s) || typeof (s as { hint?: unknown }).hint !== 'string') {
      throw new Error(`장소 추천 항목 형식이 올바르지 않습니다: ${JSON.stringify(s)}`);
    }
    if (suggestionIds.has(s.id)) throw new Error(`장소 추천 id가 중복되었습니다: ${JSON.stringify(s.id)}`);
    suggestionIds.add(s.id);
    const same = byId.get(s.id);
    if (same && (same.name !== s.name || same.address !== s.address || same.lat !== s.lat || same.lng !== s.lng)) {
      throw new Error(`목 장소와 추천의 같은 id가 다른 장소를 가리킵니다: ${JSON.stringify(s.id)}`);
    }
  }
  const remembered = (rememberedValue as { remembered?: unknown } | null)?.remembered;
  if (!Array.isArray(remembered)) {
    throw new Error('기억한 장소 형식이 올바르지 않습니다: remembered 배열이 필요합니다');
  }
  const titles = new Set<string>();
  for (const r of remembered) {
    const ok = typeof r?.title === 'string' && r.title !== '' && typeof r.placeId === 'string';
    if (!ok) throw new Error(`기억한 장소 항목 형식이 올바르지 않습니다: ${JSON.stringify(r)}`);
    if (titles.has(r.title)) throw new Error(`기억한 장소 제목이 중복되었습니다: ${JSON.stringify(r.title)}`);
    titles.add(r.title);
    if (!byId.has(r.placeId)) throw new Error(`기억한 장소 id가 목 장소에 없습니다: ${JSON.stringify(r.placeId)}`);
  }
  return { places: places as MockPlace[], suggestions: suggestions as PlaceSuggestion[], remembered: remembered as RememberedPlace[] };
}

export function loadPlacesCatalog(
  placesLocation: URL | string = MOCK_PLACES_URL,
  suggestionsLocation: URL | string = PLACE_SUGGESTIONS_URL,
  rememberedLocation: URL | string = REMEMBERED_PLACES_URL,
): PlacesCatalog {
  const read = (location: URL | string, what: string): unknown => {
    try {
      return JSON.parse(readFileSync(location, 'utf8'));
    } catch (e) {
      throw new Error(`${what}을 읽을 수 없습니다(${String(location)}): ${(e as Error).message}`);
    }
  };
  return parsePlacesCatalog(read(placesLocation, '목 장소'), read(suggestionsLocation, '장소 추천'), read(rememberedLocation, '기억한 장소'));
}

/** 저장소 루트 fixtures/family/members.json: 미리 묶어 둔 가족(시연용 계정). 받는 쪽 앱은 아직 프로토타입이다. */
export const FAMILY_MEMBERS_URL = new URL('../../fixtures/family/members.json', import.meta.url);

/** 가족 목록을 검증한다. 한 명 이상, id·이름은 빈 글이 아니고 id는 겹치지 않는다. */
export function parseFamilyMembers(value: unknown): FamilyMember[] {
  const members = (value as { members?: unknown } | null)?.members;
  if (!Array.isArray(members) || members.length === 0) throw new Error('가족 형식이 올바르지 않습니다: members 배열이 필요합니다');
  const seen = new Set<string>();
  return members.map((m, i) => {
    const v = m as Record<string, unknown> | null;
    if (!v || typeof v.id !== 'string' || v.id.trim() === '' || typeof v.name !== 'string' || v.name.trim() === '') {
      throw new Error(`가족 형식이 올바르지 않습니다: members[${i}]에 id·name 문자열이 필요합니다`);
    }
    if (seen.has(v.id)) throw new Error(`가족 id가 겹칩니다: ${v.id}`);
    seen.add(v.id);
    return { id: v.id, name: v.name };
  });
}

export function loadFamilyMembers(location: URL | string = FAMILY_MEMBERS_URL): FamilyMember[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(location, 'utf8'));
  } catch (e) {
    throw new Error(`가족 목록을 읽을 수 없습니다(${String(location)}): ${(e as Error).message}`);
  }
  return parseFamilyMembers(parsed);
}
