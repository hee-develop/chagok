import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validator } from 'hono/validator';
import type { DayFixture, FamilyMember, MockCalendar, MockPlace, PlaceFixture, PlacesCatalog } from '../fixture-types.js';
import { MAX_BODY_BYTES, MAX_CARE_LENGTH, MAX_ID_LENGTH } from '../limits.js';
import { MINUTE_MS, parseAt, seoulDay } from '../time.js';
import { effectiveSelectedIds, type SelectionStore } from './calendars.js';
import type { EventsStore } from './events.js';
import type { FamilyStore } from './family.js';
import { detectNoTravel, type NoTravelReason } from '../noTravel.js';
import type { FavoritesStore } from './places.js';

/** 캘린더 원본과 분리한 일정별 보정값. 라우트 인스턴스 수명 동안만 보관한다. */
type Override = { placeId: string | null; noTravel: boolean };
type PlaceChange = { placeId: string | null } | { noTravel: true };

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
  memo: string | null;
  attendees: string[];
  /** 온라인 회의·회의실이라 저절로 '이동 없음'인 이유. 보정(장소 넣기·이동 없음)이 있으면 보정이 이긴다. */
  autoNoTravel: NoTravelReason | null;
};

const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * 일정 출처: 폰이 보낸 일정을 한 번이라도 받았으면 그것(날짜 지난 것은 이미 지워짐), 아니면 픽스처.
 * 폰 일정의 장소는 보정(view에서 먼저 적용) → 목 장소 이름이 장소 칸과 정규화해서 완전히 같은 것 → null 순으로 정한다.
 * 지난번 기억(제목)과 이름이 일부만 겹치는 목 장소는 좌표를 확정하지 않고 픽스처 일정과 같은 계약대로 `suggestion`(확인 필요)으로만 내린다.
 */
export const createSchedulesRoute = (
  fixture: DayFixture,
  calendars: MockCalendar[],
  selection: SelectionStore,
  catalog: PlacesCatalog,
  events: EventsStore,
  favorites: FavoritesStore,
  family: { members: FamilyMember[]; store: FamilyStore },
  now: () => Date = () => new Date(),
) => {
  const overrides = new Map<string, Override>();
  /**
   * 앱에서 적은 채비(일정 id → 한 줄). 캘린더에는 쓰지 않고 차곡 안에만 둔다. 차는 이 채비를 먼저, 없으면 일정 메모를 읽는다.
   * 보정과 같이 라우트 인스턴스 수명 동안만 보관하고, 폰 일정이 바뀌어 사라진 일정의 채비는 버린다.
   */
  const cares = new Map<string, string>();
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
  const toPlace = (p: MockPlace): PlaceFixture => ({ name: p.name, lat: p.lat, lng: p.lng });
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
  // 폰 일정이 교체되거나 비워지면, 더는 없는 일정 id의 보정을 버린다(픽스처 id의 보정은 남긴다).
  const fixtureIds = new Set(fixture.schedules.map((s) => s.id));
  events.subscribe((ids) => {
    for (const id of overrides.keys()) if (!ids.has(id) && !fixtureIds.has(id)) overrides.delete(id);
    for (const id of cares.keys()) if (!ids.has(id) && !fixtureIds.has(id)) cares.delete(id);
  });
  const rows = (anchor: Date): Row[] => {
    const phone = events.get();
    if (phone === null) {
      return fixture.schedules.map((s) => ({
        id: s.id,
        calendarId: s.calendarId,
        title: s.title,
        start: anchor.getTime() + s.startOffsetMinutes * MINUTE_MS,
        end: anchor.getTime() + s.endOffsetMinutes * MINUTE_MS,
        allDay: s.allDay,
        locationText: s.locationText,
        place: s.place,
        candidate: remembered.get(s.title),
        memo: s.memo,
        attendees: s.attendees,
        autoNoTravel: detectNoTravel({ title: s.title, locationText: s.locationText, notes: s.memo }),
      }));
    }
    return phone.events.map((e) => {
      const exact = exactMatch(e.locationText);
      return {
        id: e.id,
        calendarId: e.calendarId,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        locationText: e.locationText,
        place: exact ? toPlace(exact) : null,
        candidate: exact ? undefined : remembered.get(e.title) ?? partialMatch(e.locationText),
        memo: e.notes,
        attendees: e.attendees,
        autoNoTravel: detectNoTravel({ title: e.title, locationText: e.locationText, notes: e.notes }),
      };
    });
  };
  /**
   * 고른 캘린더로 거른다. 선택의 출처(source)와 일정의 출처가 같을 때만 적용한다:
   * 폰 일정은 기기 캘린더 id로 저장한 선택(device)만, 픽스처는 목 캘린더 id 선택(mock)만 쓴다. 출처가 다르면 거르지 않거나(폰) 기본 선택(픽스처).
   */
  const selectedSchedules = (anchor: Date) => {
    const all = rows(anchor);
    if (events.get() !== null) {
      const saved = selection.get();
      if (saved === null || saved.source !== 'device') return all;
      const selected = new Set(saved.selectedIds);
      return all.filter((s) => selected.has(s.calendarId));
    }
    const selected = new Set(effectiveSelectedIds(calendars, selection));
    return all.filter((s) => selected.has(s.calendarId));
  };
  /**
   * 보정을 반영한 장소. 보정이 없으면 온라인 회의·회의실 일정은 저절로 '이동 없음'이고 noTravelReason에 이유를 둔다.
   * 사용자가 장소를 넣으면(보정) 그 일정은 다시 차로 가고, 보정을 지우면(placeId: null) 저절로 거르는 상태로 돌아간다.
   */
  const view = (s: Row) => {
    const override = overrides.get(s.id);
    const p = override?.placeId ? places.get(override.placeId) : null;
    const noTravel = override ? override.noTravel : s.autoNoTravel !== null;
    return {
      id: s.id,
      locationText: noTravel ? null : p?.name ?? s.locationText,
      place: noTravel ? null : p ? { name: p.name, lat: p.lat, lng: p.lng } : s.place,
      noTravel,
      noTravelReason: override ? (null as NoTravelReason | null) : s.autoNoTravel,
    };
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
  const anchorOf = (at: string | undefined) => (at === undefined ? now() : parseAt(at)!);
  const times = (s: Row) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() });
  return new Hono()
    .get('/today', anchorValidator, (c) => {
      const anchor = anchorOf(c.req.valid('query').at);
      return c.json({
        anchor: anchor.toISOString(),
        schedules: selectedSchedules(anchor).filter((s) => !view(s).noTravel && isToday(s, anchor)).map((s) => {
          const { noTravel: _, noTravelReason: _reason, ...place } = view(s);
          return {
            ...place, title: s.title, ...times(s), allDay: s.allDay, memo: s.memo, care: cares.get(s.id) ?? null, attendees: s.attendees,
          };
        }),
        favorites: favoritePlaces(),
      }, 200);
    })
    .get('/places', anchorValidator, (c) => {
      const anchor = anchorOf(c.req.valid('query').at);
      return c.json({
        anchor: anchor.toISOString(),
        schedules: selectedSchedules(anchor).filter((s) => !s.allDay).sort((a, b) => a.start - b.start)
          .map((s) => {
            const v = view(s);
            const known = v.place || v.noTravel ? undefined : s.candidate;
            return {
              ...v, title: s.title, ...times(s), care: cares.get(s.id) ?? null,
              suggestion: known ? { placeId: known.id, name: known.name } : null,
              familyRequests: family.store.forSchedule(s.id).map((r) => ({ memberId: r.memberId, name: r.memberName, status: r.status, sentAt: r.sentAt })),
            };
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
        const schedule = selectedSchedules(now()).find((s) => s.id === c.req.param('id'));
        if (!schedule) return c.json({ error: '선택한 캘린더에 없는 일정입니다' }, 404);
        if (schedule.allDay) return c.json({ error: '종일 일정은 이동 대상이 아닙니다' }, 409);
        const change = c.req.valid('json');
        if ('noTravel' in change) overrides.set(schedule.id, { placeId: null, noTravel: true });
        else if (change.placeId === null) overrides.delete(schedule.id);
        else overrides.set(schedule.id, { placeId: change.placeId, noTravel: false });
        return c.json(view(schedule), 200);
      })
    // 채비 한 줄 저장. 공백만이거나 null이면 지운다. 줄바꿈·연속 공백은 공백 하나로 줄인다. 종일 일정에도 둘 수 있다(하루 전체 채비).
    .put('/:id/care', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) }),
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
        const schedule = selectedSchedules(now()).find((s) => s.id === c.req.param('id'));
        if (!schedule) return c.json({ error: '선택한 캘린더에 없는 일정입니다' }, 404);
        const { care } = c.req.valid('json');
        if (care === null) cares.delete(schedule.id);
        else cares.set(schedule.id, care);
        return c.json({ id: schedule.id, care: cares.get(schedule.id) ?? null }, 200);
      })
    // 가족에게 보내기. 보낼 때의 일정 내용(보정한 주소·채비 포함)을 담아 저장하고 '전달됨'으로 돌려준다.
    // 같은 일정을 같은 가족에게 다시 보내면 내용과 보낸 시각을 새로 한다. 종일 일정은 이동 대상이 아니라 409.
    .post('/:id/family-request', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '본문이 너무 큽니다' }, 413) }),
      validator('json', (raw: unknown, c) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return c.json({ error: '본문은 객체여야 합니다' }, 400);
        const value = raw as Record<string, unknown>;
        if (Object.keys(value).length !== 1 || typeof value.memberId !== 'string') return c.json({ error: 'memberId 하나가 필요합니다' }, 400);
        if (!family.members.some((m) => m.id === value.memberId)) return c.json({ error: '묶어 둔 가족이 아닙니다' }, 400);
        // RPC 타입 추론이 이 반환값을 본문 모양으로 쓰므로 받은 모양({ memberId }) 그대로 돌려준다.
        return { memberId: value.memberId };
      }), (c) => {
        const schedule = selectedSchedules(now()).find((s) => s.id === c.req.param('id'));
        if (!schedule) return c.json({ error: '선택한 캘린더에 없는 일정입니다' }, 404);
        if (schedule.allDay) return c.json({ error: '종일 일정은 보낼 수 없습니다' }, 409);
        const member = family.members.find((m) => m.id === c.req.valid('json').memberId)!;
        const { locationText, place } = view(schedule);
        const saved = family.store.save({
          scheduleId: schedule.id, memberId: member.id, memberName: member.name, title: schedule.title, ...times(schedule),
          locationText, place, care: cares.get(schedule.id) ?? null,
        });
        return c.json(saved, 200);
      });
};
