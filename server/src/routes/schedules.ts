import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import type { DayFixture, FamilyMember, MockCalendar, MockPlace, PlaceFixture, PlacesCatalog } from '../fixture-types.js';
import { favoritesWithArrivals } from '../arrivals.js';
import { MAX_BODY_BYTES, MAX_CARE_LENGTH, MAX_ID_LENGTH } from '../limits.js';
import { MINUTE_MS, parseAt, seoulDay } from '../time.js';
import { effectiveSelectedIds } from './calendars.js';
import { detectNoTravel, type NoTravelReason } from '../noTravel.js';
import { normalizePlaceName } from '../placeMemory.js';
import { parsePlaceSnapshot, type PlaceSnapshotInput, type StoredPlace } from '../placeSnapshot.js';
import type { SeatData } from '../seatData.js';
import { openDenied, type SeatEnv, type SeatGuard, type SeatScope } from '../seatScope.js';

type PlaceChange = { placeId: string | null } | { place: PlaceSnapshotInput } | { noTravel: true };

/** 기억은 있지만 애매해서(처음 고를 때 후보가 둘 이상이었음) 확정하지 않고 '확인 필요'로 내리는 장소. 차가 "지난번처럼 {장소}로 갈까요?"를 물을 때 쓴다. */
type MemorySuggestion = { name: string; place: { name: string; address: string | null; lat: number; lng: number } };

/** 자주 가는 곳의 자리. 차량은 home·work를 '집'·'회사'로 부른다. */
export type FavoriteKind = 'home' | 'work' | 'other';

/** 폰이 보낸 일정과 픽스처 일정을 같은 모양으로 다루기 위한 행. 시각은 UTC 밀리초. */
type Row = {
  id: string;
  calendarId: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  locationText: string | null;
  place: PlaceFixture | null;
  /** 장소가 비었을 때 '여기 맞아요'로 내릴 후보(지난번 기억 또는 이름이 포함되는 목 장소). */
  candidate: MockPlace | undefined;
  /** place가 자리의 장소 기억에서 왔으면 `{ ambiguous: false }`(확정하는 기억은 애매하지 않은 것뿐). 아니면 null. */
  placeMemory: { ambiguous: false } | null;
  /** 애매한 기억(`ambiguous: true`)은 확정하지 않고 확인 필요로만 내린다. 아니면 null. */
  memorySuggestion: MemorySuggestion | null;
  memo: string | null;
  attendees: string[];
  /** 온라인 회의·건물 안이라 저절로 '이동 없음'인 이유. 종일 일정은 거르지 않는다(차가 첫 탑승 인사에 이름을 쓴다). 보정(장소 넣기·이동 없음)이 있으면 보정이 이긴다. */
  autoNoTravel: NoTravelReason | null;
  /**
   * 같은 이름을 '이동 없음'으로 기억했다(`SeatData.skips`, 정책서 10.3 4번). 종일 일정은 거르지 않는다. 폰이 `travelConfirmed`로 보낸 일정도 기억이 이긴다:
   * 사용자가 "이동 일정이에요"를 고르면 폰이 먼저 그 이름의 기억을 지우고(`PUT /skips`) 일정을 보내기 때문이다. 차의 "안 가요"가 더 나중이면 기억이 이긴다.
   */
  skipped: boolean;
};

/** 이름 비교 정규화. 장소 기억의 이름 키(placeMemory.ts)와 같은 규칙이다. */
const normalize = normalizePlaceName;

/**
 * 일정 출처(운전자 자리마다): 폰이 보낸 일정을 한 번이라도 받았으면 그것(날짜 지난 것은 이미 지워짐), 아니면 픽스처.
 * 일정의 장소는 보정(view에서 먼저 적용) → **자리의 장소 기억** → 목 장소 이름이 장소 칸과 정규화해서 완전히 같은 것(**기본 자리·`FIXTURE_SEATS=1`에서만**) → null 순으로 정한다.
 * 장소 기억은 차가 `PUT /places/memory`로 저장한 '이름 → 장소'이고 이름은 일정의 장소 칸 글자(비었으면 제목)다. 애매하지 않은 기억은 좌표를 확정하고
 * (`placeMemory: { ambiguous: false }`) 애매한 기억은 확정하지 않고 `suggestion`(`source: "memory"`, `ambiguous: true`, `place`)으로만 내린다.
 * 실제 자리(연결된 자리·연결 전 버킷)에서는 목 장소 데이터(완전 일치·부분 일치·제목 시드)를 쓰지 않는다. 기본 자리·`FIXTURE_SEATS=1`에서
 * 지난번 기억(제목, 픽스처 시드)과 이름이 일부만 겹치는 목 장소는 좌표를 확정하지 않고 `suggestion`(확인 필요)으로만 내린다.
 */
export const createSchedulesRoute = (
  fixture: DayFixture,
  calendars: MockCalendar[],
  catalog: PlacesCatalog,
  guard: SeatGuard,
  family: { members: FamilyMember[] },
  now: () => Date = () => new Date(),
) => {
  const places = new Map([...catalog.places, ...catalog.suggestions].map((p) => [p.id, p]));
  /**
   * 차량 '어디로 갈까요?' 후보로 쓰는 자주 가는 곳. 집 → 회사 → 추가한 순서이고, 일정 선택·날짜와 무관하다.
   * 저장소는 장소 스냅숏(목 장소 또는 폰이 실은 외부 장소)을 값으로 들고 있다. 고르는 개수와 상황은 차량 앱이 정한다.
   */
  const favoritePlaces = (d: SeatData) => {
    const saved = d.favorites.get();
    const slots: { kind: FavoriteKind; place: StoredPlace }[] = [
      ...(saved.home === null ? [] : [{ kind: 'home' as const, place: saved.home }]),
      ...(saved.work === null ? [] : [{ kind: 'work' as const, place: saved.work }]),
      ...saved.others.map((place) => ({ kind: 'other' as const, place })),
    ];
    return slots.map(({ kind, place: p }) => ({ kind, name: p.name, address: p.address, lat: p.lat, lng: p.lng }));
  };
  // fixtures/places/remembered.json은 픽스처·데모 자리(기본 자리)의 제목 기억 시드이고 확정하지 않는 `suggestion`으로만 쓴다(실제 자리에는 새지 않는다).
  const remembered = new Map(catalog.remembered.map((r) => [r.title, places.get(r.placeId)!]));
  /** 자리의 장소 기억에서 이 일정의 장소를 찾는다. 이름 키는 장소 칸 글자이고, 비었으면 제목이다. */
  const memoryOf = (d: SeatData, locationText: string | null, title: string) => {
    const key = locationText !== null && normalize(locationText) !== '' ? locationText : title;
    return d.memory.get(key);
  };
  const toPlace = (p: MockPlace): PlaceFixture => ({ name: p.name, lat: p.lat, lng: p.lng });
  const memoryPlace = (p: { name: string; lat: number; lng: number }): PlaceFixture => ({ name: p.name, lat: p.lat, lng: p.lng });
  /** 기억 한 줄을 일정 장소로: 애매하지 않으면 확정, 애매하면 확인 필요(suggestion)로만. 기억이 없으면 둘 다 null. */
  const fromMemory = (d: SeatData, locationText: string | null, title: string) => {
    const m = memoryOf(d, locationText, title);
    if (!m) return { found: false as const, place: null, placeMemory: null, memorySuggestion: null };
    if (m.ambiguous) return { found: true as const, place: null, placeMemory: null, memorySuggestion: { name: m.place.name, place: { ...m.place } } };
    return { found: true as const, place: memoryPlace(m.place), placeMemory: { ambiguous: false as const }, memorySuggestion: null };
  };
  const namedPlaces = [...places.values()].map((p) => ({ p, name: normalize(p.name) }));
  /** 장소 칸 글자와 이름이 완전히 같은 목 장소(공백·대소문자만 무시). 좌표를 확정해도 되는 유일한 경우다. */
  const exactMatch = (locationText: string | null): MockPlace | undefined => {
    const text = locationText === null ? '' : normalize(locationText);
    return text === '' ? undefined : namedPlaces.find((n) => n.name === text)?.p;
  };
  /** 이름이 일부만 겹치는 목 장소(2글자 이상). '잠실 실내 체육관'→'체육관'처럼 틀릴 수 있어 후보로만 쓴다. */
  const partialMatch = (locationText: string | null): MockPlace | undefined => {
    const text = locationText === null ? '' : normalize(locationText);
    if (text.length < 2) return undefined;
    return namedPlaces.find((n) => n.name.length >= 2 && (text.includes(n.name) || n.name.includes(text)))?.p;
  };
  // 일정별 보정·채비는 자리 데이터(SeatData)에 있다. 폰 일정이 바뀌어 사라진 일정의 것은 거기서 버린다.
  const rows = (sc: SeatScope, anchor: Date): Row[] => {
    const phone = sc.data.events.get();
    const seed = (title: string) => (sc.fixture ? remembered.get(title) : undefined);
    if (phone === null) {
      // 일정을 받은 적 없는 자리: 기본 자리(픽스처·데모 경로)만 픽스처이고, 실제 자리(연결된 자리·연결 전 버킷)는 0건이다.
      if (!sc.fixture) return [];
      return fixture.schedules.map((s) => {
        // 픽스처 일정의 place(좌표가 이미 있음)가 먼저, 그다음 자리의 기억, 그다음 제목 시드(suggestion)다.
        const memory = s.place ? null : fromMemory(sc.data, s.locationText, s.title);
        return {
          id: s.id,
          calendarId: s.calendarId,
          title: s.title,
          start: anchor.getTime() + s.startOffsetMinutes * MINUTE_MS,
          end: anchor.getTime() + s.endOffsetMinutes * MINUTE_MS,
          allDay: s.allDay,
          locationText: s.locationText,
          place: s.place ?? memory?.place ?? null,
          candidate: memory?.found ? undefined : seed(s.title),
          placeMemory: memory?.placeMemory ?? null,
          memorySuggestion: memory?.memorySuggestion ?? null,
          memo: s.memo,
          attendees: s.attendees,
          autoNoTravel: s.allDay ? null : detectNoTravel({ title: s.title, locationText: s.locationText, notes: s.memo }),
          skipped: !s.allDay && sc.data.skips.has(s.title),
        };
      });
    }
    return phone.events.map((e) => {
      // 보정(view) → 자리의 기억 → 목 장소 완전 일치(기본 자리·FIXTURE_SEATS=1만) → 후보. 실제 자리에서는 목 장소를 쓰지 않는다.
      const memory = fromMemory(sc.data, e.locationText, e.title);
      const exact = memory.found || !sc.fixture ? undefined : exactMatch(e.locationText);
      return {
        id: e.id,
        calendarId: e.calendarId,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        locationText: e.locationText,
        place: memory.place ?? (exact ? toPlace(exact) : null),
        candidate: memory.found || exact || !sc.fixture ? undefined : seed(e.title) ?? partialMatch(e.locationText),
        placeMemory: memory.placeMemory,
        memorySuggestion: memory.memorySuggestion,
        memo: e.notes,
        attendees: e.attendees,
        autoNoTravel: e.travelConfirmed || e.allDay ? null : detectNoTravel({ title: e.title, locationText: e.locationText, notes: e.notes }),
        skipped: !e.allDay && sc.data.skips.has(e.title),
      };
    });
  };
  /**
   * 고른 캘린더로 거른다. 선택의 출처(source)와 일정의 출처가 같을 때만 적용한다:
   * 폰 일정은 기기 캘린더 id로 저장한 선택(device)만, 픽스처는 목 캘린더 id 선택(mock)만 쓴다. 출처가 다르면 거르지 않거나(폰) 기본 선택(픽스처).
   */
  const selectedSchedules = (sc: SeatScope, anchor: Date) => {
    const d = sc.data;
    const all = rows(sc, anchor);
    if (d.events.get() !== null) {
      const saved = d.selection.get();
      if (saved === null || saved.source !== 'device') return all;
      const selected = new Set(saved.selectedIds);
      return all.filter((s) => selected.has(s.calendarId));
    }
    const selected = new Set(effectiveSelectedIds(calendars, d.selection));
    return all.filter((s) => selected.has(s.calendarId));
  };
  /**
   * 보정을 반영한 장소. 보정이 없으면 온라인 회의·회의실 일정과 '이동 없음'으로 기억한 이름의 일정(`skipped`)은 저절로 '이동 없음'이고
   * noTravelReason에 이유를 둔다(온라인·회의실이 먼저, 둘 다 아니면 기억한 이름이라 `skipped`).
   * 사용자가 장소를 넣으면(보정) 그 일정은 다시 차로 가고, 보정을 지우면(placeId: null) 저절로 거르는 상태로 돌아간다.
   */
  const view = (d: SeatData, s: Row) => {
    const override = d.overrides.get(s.id);
    const p = override?.place ?? null;
    const noTravel = override ? override.noTravel : s.autoNoTravel !== null || s.skipped;
    return {
      id: s.id,
      // 사용자가 장소를 넣어 보정한 일정인가. 폰은 이런 일정을 같은 이름의 '이동 없음' 기억으로 거르지 않는다(보정이 기억을 이긴다: 거르면 서버가 일정과 보정을 잃는다).
      corrected: !!override && override.place !== null && !override.noTravel,
      locationText: noTravel ? null : p?.name ?? s.locationText,
      place: noTravel ? null : p ? { name: p.name, lat: p.lat, lng: p.lng } : s.place,
      noTravel,
      noTravelReason: override ? (null as NoTravelReason | 'skipped' | null) : s.autoNoTravel ?? (s.skipped ? ('skipped' as const) : null),
    };
  };
  /** 장소가 자리의 기억에서 왔을 때만 `placeMemory`를 응답에 덧붙인다(보정·이동 없음이 이기면 없음, 기억이 아니면 필드 자체가 없다). */
  const memoryFlag = (d: SeatData, s: Row) => {
    const override = d.overrides.get(s.id);
    return s.placeMemory && !override?.place && !view(d, s).noTravel ? { placeMemory: s.placeMemory } : {};
  };
  /** 애매한 기억은 확인 필요(`suggestion`)로만 내린다(보정이 있거나 이동 없음이면 없음). `/schedules/today`에는 이 경우에만 `suggestion` 필드가 덧붙는다. */
  const memorySuggestionOf = (d: SeatData, s: Row) => {
    const v = view(d, s);
    return s.memorySuggestion && !v.place && !v.noTravel
      ? { placeId: null, name: s.memorySuggestion.name, place: s.memorySuggestion.place, source: 'memory' as const, ambiguous: true as const }
      : null;
  };
  /** 시작이 anchor와 같은 서울 날짜이거나, 전날 시작해 anchor 시각에 아직 끝나지 않은 일정. */
  const isToday = (s: Row, anchor: Date) => {
    const day = seoulDay(anchor.getTime());
    return seoulDay(s.start) === day || (seoulDay(s.start) < day && s.end > anchor.getTime());
  };
  const anchorValidator = validator('query', (value: { at?: string | string[] }, c) => {
    const anchor = value.at === undefined ? now() : typeof value.at === 'string' ? parseAt(value.at) : null;
    if (anchor === null) return c.json({ error: 'at은 ISO8601 시각이어야 합니다' }, 400);
    return { at: value.at } as { at?: string };
  });
  /** 픽스처가 고정 기준 시각을 두면(PT 시연) 픽스처 일정은 늘 그 시각 기준이다. 폰 일정은 실제 시각이라 상관없다. */
  const fixedAnchor = fixture.anchor === undefined ? null : parseAt(fixture.anchor);
  const anchorOf = (sc: SeatScope, at: string | undefined) =>
    fixedAnchor !== null && sc.fixture && sc.data.events.get() === null ? fixedAnchor : at === undefined ? now() : parseAt(at)!;
  const times = (s: Row) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() });
  return new Hono<SeatEnv>()
    .get('/today', guard.read, anchorValidator, (c) => {
      const sc = c.var.seat;
      const d = sc.data;
      const anchor = anchorOf(sc, c.req.valid('query').at);
      return c.json({
        anchor: anchor.toISOString(),
        schedules: selectedSchedules(sc, anchor).filter((s) => !view(d, s).noTravel && isToday(s, anchor)).map((s) => {
          const { noTravel: _, noTravelReason: _reason, corrected: _corrected, ...place } = view(d, s);
          const memorySuggestion = memorySuggestionOf(d, s);
          return {
            ...place, ...memoryFlag(d, s), ...(memorySuggestion ? { suggestion: memorySuggestion } : {}), title: s.title, ...times(s), allDay: s.allDay, memo: s.memo, care: d.cares.get(s.id) ?? null, attendees: s.attendees,
          };
        }),
        // 도착 횟수는 명시 식별(폰 토큰·차 토큰 + driver)로 정해진 자리에서만 반영한다. 옛 호환 읽기(식별 없음·차 토큰만)와 기본 자리(데모·E2E)는 등록한 곳만 준다.
        favorites: sc.explicit ? favoritesWithArrivals(favoritePlaces(d), d.arrivals.list()) : favoritePlaces(d),
      }, 200);
    })
    .get('/places', guard.read, anchorValidator, (c) => {
      const sc = c.var.seat;
      const d = sc.data;
      const anchor = anchorOf(sc, c.req.valid('query').at);
      return c.json({
        anchor: anchor.toISOString(),
        schedules: selectedSchedules(sc, anchor).filter((s) => !s.allDay).sort((a, b) => a.start - b.start)
          .map((s) => {
            const v = view(d, s);
            const known = v.place || v.noTravel ? undefined : s.candidate;
            return {
              ...v, ...memoryFlag(d, s), title: s.title, ...times(s), care: d.cares.get(s.id) ?? null,
              suggestion: known ? { placeId: known.id as string | null, name: known.name } : memorySuggestionOf(d, s),
              familyRequests: d.family.forSchedule(s.id).map((r) => ({ memberId: r.memberId, name: r.memberName, status: r.status, sentAt: r.sentAt })),
            };
          }),
      }, 200);
    })
    .put('/:id/place', guard.write, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) }),
      validator('json', (raw: unknown, c) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const value = raw as Record<string, unknown>;
        const keys = Object.keys(value);
        if (keys.length === 1 && value.noTravel === true) return { noTravel: true } as PlaceChange;
        if (keys.length === 1 && 'placeId' in value && (value.placeId === null ||
          (typeof value.placeId === 'string' && value.placeId.length <= MAX_ID_LENGTH && places.has(value.placeId)))) {
          return { placeId: value.placeId as string | null } as PlaceChange;
        }
        if (keys.length === 1 && 'place' in value) {
          const parsed = parsePlaceSnapshot(value.place);
          if (!parsed.ok) return c.json({ error: parsed.error }, 400);
          return { place: value.place as PlaceSnapshotInput } as PlaceChange;
        }
        return c.json({ error: '알려진 placeId, 장소 스냅숏 place, noTravel: true 중 하나가 필요합니다' }, 400);
      }), (c) => {
        const sc = c.var.seat;
        const schedule = selectedSchedules(sc, anchorOf(sc, undefined)).find((s) => s.id === c.req.param('id'));
        if (!schedule) return c.json({ error: '선택한 캘린더에 없는 일정입니다' }, 404);
        if (schedule.allDay) return c.json({ error: '종일 일정은 이동 대상이 아닙니다' }, 409);
        const opened = sc.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        const d = opened.data;
        const change = c.req.valid('json');
        if ('noTravel' in change) d.overrides.set(schedule.id, { place: null, noTravel: true });
        else if ('place' in change) d.overrides.set(schedule.id, { place: (parsePlaceSnapshot(change.place) as { ok: true; place: StoredPlace }).place, noTravel: false });
        else if (change.placeId === null) d.overrides.delete(schedule.id);
        else {
          const known = places.get(change.placeId) as MockPlace;
          d.overrides.set(schedule.id, { place: { id: known.id, name: known.name, address: known.address, lat: known.lat, lng: known.lng }, noTravel: false });
        }
        // title은 폰이 '이동 없음'을 고를 때 같은 이름을 기억(`PUT /skips`)하고, 장소를 넣을 때 그 이름의 기억을 지우는 데 쓴다.
        return c.json({ ...view(d, schedule), title: schedule.title }, 200);
      })
    // 채비 한 줄 저장. 공백만이거나 null이면 지운다. 줄바꿈·연속 공백은 공백 하나로 줄인다. 종일 일정에도 둘 수 있다(하루 전체 채비).
    .put('/:id/care', guard.write, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) }),
      validator('json', (raw: unknown, c) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const value = raw as Record<string, unknown>;
        if (Object.keys(value).length !== 1 || !('care' in value)) return c.json({ error: 'care 하나가 필요합니다' }, 400);
        if (value.care === null) return { care: null as string | null };
        if (typeof value.care !== 'string') return c.json({ error: 'care는 문자열 또는 null이어야 합니다' }, 400);
        const care = value.care.trim().replace(/\s+/g, ' ');
        if (care.length > MAX_CARE_LENGTH) return c.json({ error: `care는 ${MAX_CARE_LENGTH}자 이하여야 합니다` }, 400);
        return { care: care === '' ? null : care };
      }), (c) => {
        const sc = c.var.seat;
        const schedule = selectedSchedules(sc, anchorOf(sc, undefined)).find((s) => s.id === c.req.param('id'));
        if (!schedule) return c.json({ error: '선택한 캘린더에 없는 일정입니다' }, 404);
        const opened = sc.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        const d = opened.data;
        const { care } = c.req.valid('json');
        if (care === null) d.cares.delete(schedule.id);
        else d.cares.set(schedule.id, care);
        return c.json({ id: schedule.id, care: d.cares.get(schedule.id) ?? null }, 200);
      })
    // 가족에게 보내기. 보낼 때의 일정 내용(보정한 주소·채비 포함)을 담아 저장하고 '전달됨'으로 돌려준다.
    // 같은 일정을 같은 가족에게 다시 보내면 내용과 보낸 시각을 새로 한다. 종일 일정은 이동 대상이 아니라 409.
    .post('/:id/family-request', guard.write, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) }),
      validator('json', (raw: unknown, c) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const value = raw as Record<string, unknown>;
        if (Object.keys(value).length !== 1 || typeof value.memberId !== 'string') return c.json({ error: 'memberId 하나가 필요합니다' }, 400);
        if (!family.members.some((m) => m.id === value.memberId)) return c.json({ error: '묶어 둔 가족이 아닙니다' }, 400);
        // RPC 타입 추론이 이 반환값을 본문 모양으로 쓰므로 받은 모양({ memberId }) 그대로 돌려준다.
        return { memberId: value.memberId };
      }), (c) => {
        const sc = c.var.seat;
        const schedule = selectedSchedules(sc, anchorOf(sc, undefined)).find((s) => s.id === c.req.param('id'));
        if (!schedule) return c.json({ error: '선택한 캘린더에 없는 일정입니다' }, 404);
        if (schedule.allDay) return c.json({ error: '종일 일정은 보낼 수 없습니다' }, 409);
        const opened = sc.open();
        if (!opened.ok) return c.json(openDenied(opened.reason), 429);
        const d = opened.data;
        const member = family.members.find((m) => m.id === c.req.valid('json').memberId)!;
        const { locationText, place } = view(d, schedule);
        const saved = d.family.save({
          scheduleId: schedule.id, memberId: member.id, memberName: member.name, title: schedule.title, ...times(schedule),
          locationText, place, care: d.cares.get(schedule.id) ?? null,
        });
        return c.json(saved, 200);
      });
};
