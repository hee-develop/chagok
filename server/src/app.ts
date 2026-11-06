import { Hono } from 'hono';
import type { DayFixture, MockCalendar, PlacesCatalog } from './fixture-types.js';
import { createCalendarsRoute, createSelectionStore, effectiveSelectedIds, type SelectionStore } from './routes/calendars.js';
import { createFavoritesStore, createPlacesRoute, type FavoritesStore } from './routes/places.js';

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

// RPC 타입 추론을 위해 라우트는 반드시 체이닝으로 정의한다.
export type AppOptions = {
  fixture: DayFixture;
  calendars: MockCalendar[];
  places: PlacesCatalog;
  /** 캘린더 선택 저장소. 없으면 인스턴스마다 새로 만든다. */
  store?: SelectionStore;
  /** 자주 가는 곳 저장소. 없으면 인스턴스마다 새로 만든다. */
  favorites?: FavoritesStore;
};

export const createApp = ({
  fixture,
  calendars,
  places,
  store = createSelectionStore(),
  favorites = createFavoritesStore(),
}: AppOptions) =>
  new Hono()
    .get('/health', (c) => c.json({ ok: true as const }))
    .route('/calendars', createCalendarsRoute(calendars, store))
    .route('/places', createPlacesRoute(places, favorites))
    .get('/schedules/today', (c) => {
      const raw = c.req.query('at');
      const anchor = raw === undefined ? new Date() : parseAt(raw);
      if (anchor === null) {
        return c.json({ error: 'at은 ISO8601 시각이어야 합니다' }, 400);
      }
      const selected = new Set(effectiveSelectedIds(calendars, store));
      const shift = (minutes: number) => new Date(anchor.getTime() + minutes * MINUTE_MS).toISOString();
      return c.json(
        {
          anchor: anchor.toISOString(),
          schedules: fixture.schedules
            .filter((s) => selected.has(s.calendarId))
            .map((s) => ({
              id: s.id,
              title: s.title,
              start: shift(s.startOffsetMinutes),
              end: shift(s.endOffsetMinutes),
              allDay: s.allDay,
              locationText: s.locationText,
              place: s.place,
              memo: s.memo,
              attendees: s.attendees,
            })),
        },
        200,
      );
    });

export type AppType = ReturnType<typeof createApp>;
