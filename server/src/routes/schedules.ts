import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import type { DayFixture, MockCalendar, PlacesCatalog, ScheduleFixture } from '../fixture-types.js';
import { MAX_BODY_BYTES, MAX_ID_LENGTH } from '../limits.js';
import { effectiveSelectedIds, type SelectionStore } from './calendars.js';
import type { FavoritesStore } from './places.js';

const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/;

/**
 * 오프셋이 있는 ISO8601 시각 문자열만 받는다. 형식이 틀리거나 달력에 없는 값(2026-02-30, T24:00, 초 60)이면 null.
 * Date는 범위를 넘는 값을 다음 날로 넘겨 받아들이므로 날짜 부분은 되돌려 읽어 같은지 확인한다.
 * 0~99년은 Date.UTC가 1900년대로 읽으므로 setUTCFullYear로 연도를 그대로 넣는다.
 */
function parseAt(value: string): Date | null {
  const m = ISO_8601.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return null;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SEOUL_OFFSET_MS = 9 * 60 * MINUTE_MS;

/** Asia/Seoul 기준 날짜 번호(1970-01-01 = 0). */
const seoulDay = (ms: number) => Math.floor((ms + SEOUL_OFFSET_MS) / DAY_MS);

/** 캘린더 원본과 분리한 일정별 보정값. 라우트 인스턴스 수명 동안만 보관한다. */
type Override = { placeId: string | null; noTravel: boolean };
type PlaceChange = { placeId: string | null } | { noTravel: true };

/** 자주 가는 곳의 자리. 차량은 home·work를 '집'·'회사'로 부른다. */
export type FavoriteKind = 'home' | 'work' | 'other';

export const createSchedulesRoute = (
  fixture: DayFixture,
  calendars: MockCalendar[],
  selection: SelectionStore,
  catalog: PlacesCatalog,
  favorites: FavoritesStore,
) => {
  const overrides = new Map<string, Override>();
  const places = new Map([...catalog.places, ...catalog.suggestions].map((p) => [p.id, p]));
  /**
   * 차량 '어디로 갈까요?' 후보로 쓰는 자주 가는 곳. 집 → 회사 → 추가한 순서이고, 일정 선택·날짜와 무관하다.
   * 저장소는 목 장소 id만 받으므로 모두 풀린다. 고르는 개수와 상황은 차량 앱이 정한다.
   */
  const favoritePlaces = () => {
    const saved = favorites.get();
    const slots: { kind: FavoriteKind; id: string }[] = [
      ...(saved.home === null ? [] : [{ kind: 'home' as const, id: saved.home }]),
      ...(saved.work === null ? [] : [{ kind: 'work' as const, id: saved.work }]),
      ...saved.others.map((id) => ({ kind: 'other' as const, id })),
    ];
    return slots.map(({ kind, id }) => {
      const p = places.get(id)!;
      return { kind, name: p.name, address: p.address, lat: p.lat, lng: p.lng };
    });
  };
  const remembered = new Map(catalog.remembered.map((r) => [r.title, places.get(r.placeId)!]));
  const selectedSchedules = () => {
    const selected = new Set(effectiveSelectedIds(calendars, selection));
    return fixture.schedules.filter((s) => selected.has(s.calendarId));
  };
  const view = (s: ScheduleFixture) => {
    const override = overrides.get(s.id);
    const p = override?.placeId ? places.get(override.placeId) : null;
    return {
      id: s.id,
      locationText: override?.noTravel ? null : p?.name ?? s.locationText,
      place: override?.noTravel ? null : p ? { name: p.name, lat: p.lat, lng: p.lng } : s.place,
      noTravel: override?.noTravel ?? false,
    };
  };
  /** 시작이 anchor와 같은 서울 날짜이거나, 전날 시작해 anchor 시각에 아직 끝나지 않은 일정. */
  const isToday = (s: ScheduleFixture, anchor: Date) => {
    const start = anchor.getTime() + s.startOffsetMinutes * MINUTE_MS;
    const end = anchor.getTime() + s.endOffsetMinutes * MINUTE_MS;
    const day = seoulDay(anchor.getTime());
    return seoulDay(start) === day || (seoulDay(start) < day && end > anchor.getTime());
  };
  const anchorValidator = validator('query', (value: { at?: string | string[] }, c) => {
    const anchor = value.at === undefined ? new Date() : typeof value.at === 'string' ? parseAt(value.at) : null;
    if (anchor === null) return c.json({ error: 'at은 ISO8601 시각이어야 합니다' }, 400);
    return { at: value.at } as { at?: string };
  });
  const times = (s: ScheduleFixture, anchor: Date) => ({
    start: new Date(anchor.getTime() + s.startOffsetMinutes * MINUTE_MS).toISOString(),
    end: new Date(anchor.getTime() + s.endOffsetMinutes * MINUTE_MS).toISOString(),
  });
  return new Hono()
    .get('/today', anchorValidator, (c) => {
      const at = c.req.valid('query').at;
      const anchor = at === undefined ? new Date() : parseAt(at)!;
      return c.json({
        anchor: anchor.toISOString(),
        schedules: selectedSchedules().filter((s) => !view(s).noTravel && isToday(s, anchor)).map((s) => {
          const { noTravel: _, ...place } = view(s);
          return { ...place, title: s.title, ...times(s, anchor), allDay: s.allDay, memo: s.memo, attendees: s.attendees };
        }),
        favorites: favoritePlaces(),
      }, 200);
    })
    .get('/places', anchorValidator, (c) => {
      const at = c.req.valid('query').at;
      const anchor = at === undefined ? new Date() : parseAt(at)!;
      return c.json({
        anchor: anchor.toISOString(),
        schedules: selectedSchedules().filter((s) => !s.allDay).sort((a, b) => a.startOffsetMinutes - b.startOffsetMinutes)
          .map((s) => {
            const v = view(s);
            const known = v.place || v.noTravel ? undefined : remembered.get(s.title);
            return { ...v, title: s.title, ...times(s, anchor), suggestion: known ? { placeId: known.id, name: known.name } : null };
          }),
      }, 200);
    })
    .put('/:id/place', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) }),
      validator('json', (raw: unknown, c) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const value = raw as Record<string, unknown>;
        const keys = Object.keys(value);
        if (keys.length === 1 && value.noTravel === true) return { noTravel: true } as PlaceChange;
        if (keys.length === 1 && 'placeId' in value && (value.placeId === null ||
          (typeof value.placeId === 'string' && value.placeId.length <= MAX_ID_LENGTH && places.has(value.placeId)))) {
          return { placeId: value.placeId as string | null } as PlaceChange;
        }
        return c.json({ error: '알려진 placeId 또는 noTravel: true 하나가 필요합니다' }, 400);
      }), (c) => {
        const schedule = selectedSchedules().find((s) => s.id === c.req.param('id'));
        if (!schedule) return c.json({ error: '선택한 캘린더에 없는 일정입니다' }, 404);
        if (schedule.allDay) return c.json({ error: '종일 일정은 이동 대상이 아닙니다' }, 409);
        const change = c.req.valid('json');
        if ('noTravel' in change) overrides.set(schedule.id, { placeId: null, noTravel: true });
        else if (change.placeId === null) overrides.delete(schedule.id);
        else overrides.set(schedule.id, { placeId: change.placeId, noTravel: false });
        return c.json(view(schedule), 200);
      });
};
