import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DayFixture } from './fixture-types.js';

export type { DayFixture, PlaceFixture, ScheduleFixture } from './fixture-types.js';

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

export function loadDayFixture(location: URL | string = DEFAULT_FIXTURE_URL): DayFixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(location, 'utf8'));
  } catch (e) {
    throw new Error(`픽스처를 읽을 수 없습니다(${String(location)}): ${(e as Error).message}`);
  }
  return parseDayFixture(parsed);
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

export function parseDayFixture(value: unknown): DayFixture {
  const root = value as Partial<DayFixture> | null;
  if (!root || typeof root.id !== 'string' || typeof root.name !== 'string' || !Array.isArray(root.schedules)) {
    throw new Error('픽스처 형식이 올바르지 않습니다: id, name, schedules가 필요합니다');
  }
  const ids = new Set<string>();
  for (const s of root.schedules) {
    const ok =
      typeof s?.id === 'string' &&
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
    const inRange = (m: number) => Number.isInteger(m) && Math.abs(m) <= MAX_OFFSET_MINUTES;
    if (!inRange(s.startOffsetMinutes) || !inRange(s.endOffsetMinutes) || s.endOffsetMinutes < s.startOffsetMinutes) {
      throw new Error(
        `픽스처 일정 시각 오프셋은 정수(분)이고 ±${MAX_OFFSET_MINUTES}분 이내이며 end가 start 이상이어야 합니다: ${JSON.stringify(s.id)}`,
      );
    }
  }
  return root as DayFixture;
}
