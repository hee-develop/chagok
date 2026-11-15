import type { DeviceEvent } from '../../calendar-select/calendarSource';
import type { WireEvent } from '../../calendar-sync/wireEvent';
import { createCorrectedPlaces } from '../../calendar-sync/correctedPlaces';
import { createEventSync } from '../../calendar-sync/eventSync';
import { createFilteredEventsStore } from '../../calendar-sync/filteredEvents';
import { createTravelExceptions, type KeyValueStorage } from '../../calendar-sync/travelExceptions';
import { createSchedulePlacesApi } from '../../fill-places/schedulePlacesApi';
import { createSkipMemory } from '../skipMemory';
import type { SkipChange, SkipEntry, SkipsApi } from '../skipsApi';

// 정책서 10.3 4번: 장소 보정이 이동 없음 기억을 이긴다(가장 최근 선택이 이김). device 출처 시나리오:
// [이동 없음] → [변경]으로 장소 선택 → 다음 동기화에서 그 일정이 PUT 본문에 있고 서버의 보정이 유지된다. 서버만 가짜(서버의 규칙을 같게 흉내 낸다).

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
};
const norm = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const event = (id: string, title: string): DeviceEvent => ({
  id,
  calendarId: '1',
  title,
  start: '2026-11-11T05:00:00.000Z',
  end: '2026-11-11T06:00:00.000Z',
  allDay: false,
  locationText: null,
  notes: null,
  attendees: [],
});

function setup(events: DeviceEvent[]) {
  // 서버 상태: 받은 일정(PUT /events는 전체 교체, 없어진 일정의 보정은 버린다), 일정별 보정, 이동 없음 기억.
  const server = {
    events: [] as WireEvent[],
    overrides: new Map<string, { placeId: string | null; noTravel: boolean }>(),
    skips: [] as SkipEntry[],
    bodies: [] as string[][],
  };
  const row = (e: Pick<WireEvent, 'id' | 'title'>) => {
    const o = server.overrides.get(e.id);
    return {
      id: e.id,
      title: e.title,
      place: o?.placeId ? { name: '장소', lat: 1, lng: 2 } : null,
      locationText: null,
      noTravel: o?.noTravel ?? false,
      noTravelReason: null,
      corrected: !!o && o.placeId !== null && !o.noTravel,
    };
  };
  const client = {
    schedules: {
      places: { $get: async () => ({ ok: true, json: async () => ({ anchor: 'x', schedules: server.events.map(row) }) }) },
      ':id': {
        place: {
          $put: async ({ param, json }: { param: { id: string }; json: { placeId?: string | null; noTravel?: true } }) => {
            const e = server.events.find((x) => x.id === param.id);
            if (!e) return { ok: false, status: 404 };
            if (json.noTravel) server.overrides.set(e.id, { placeId: null, noTravel: true });
            else if (json.placeId === null) server.overrides.delete(e.id);
            else server.overrides.set(e.id, { placeId: json.placeId ?? null, noTravel: false });
            return { ok: true, json: async () => row(e) };
          },
        },
      },
    },
  };
  const api: SkipsApi = {
    fetch: async () => server.skips,
    change: async (change: SkipChange) => {
      const remove = new Set((change.remove ?? []).map(norm));
      server.skips = server.skips.filter((e) => !remove.has(norm(e.name)));
      for (const name of change.add ?? []) if (!server.skips.some((e) => norm(e.name) === norm(name))) server.skips = [{ name, addedAt: 'x' }, ...server.skips];
      return server.skips;
    },
  };
  const exceptions = createTravelExceptions(memoryStorage());
  const skips = createSkipMemory({ api, storage: memoryStorage(), exceptions, timeoutMs: 1000, loadTimeoutMs: 100, log: jest.fn() });
  const corrected = createCorrectedPlaces();
  const filtered = createFilteredEventsStore();
  const sync = createEventSync({
    source: { kind: 'device', list: async () => [], listEvents: async () => events },
    fetchSelection: async () => ({ selectedIds: ['1'], source: 'device' }),
    send: async (sent: WireEvent[]) => {
      server.bodies.push(sent.map((e) => e.id));
      server.events = sent;
      for (const id of server.overrides.keys()) if (!sent.some((e) => e.id === id)) server.overrides.delete(id);
      return {};
    },
    fetchReceivedAt: async () => 'x',
    contacts: { prepare: async () => null },
    exceptions,
    skips,
    corrected,
    filtered,
    timeoutMs: 1000,
    log: jest.fn(),
  });
  const places = createSchedulePlacesApi({ client: client as never, skips, corrected });
  const signal = () => new AbortController().signal;
  return { server, skips, sync, places, filtered, corrected, signal };
}

describe('장소 보정이 이동 없음 기억을 이긴다 (폰 + 서버 시나리오)', () => {
  it('[이동 없음] 직후 같은 일정에 [변경]으로 장소를 고르면 다음 동기화에서 그 일정이 PUT 본문에 있고 서버 보정이 유지된다', async () => {
    const t = setup([event('a', '친구 약속')]);
    await t.sync.run();
    await t.places.fetchSchedules(t.signal());
    await t.places.savePlace('a', { noTravel: true }, t.signal());
    await flush();
    expect(t.skips.has('친구 약속')).toBe(true);
    // 동기화가 돌기 전에 마음을 바꿔 장소를 고른다.
    await t.places.savePlace('a', { placeId: 'p1' }, t.signal());
    await flush();
    expect(t.skips.has('친구 약속')).toBe(false); // 같은 이름 기억이 지워졌다
    await t.sync.run();
    expect(t.server.bodies.at(-1)).toEqual(['a']);
    expect(t.server.overrides.get('a')).toEqual({ placeId: 'p1', noTravel: false });
    expect(t.filtered.get()).toEqual([]);
    expect(t.server.skips).toEqual([]); // 서버의 기억도 지워졌다
  });

  it('같은 이름의 다른 일정에 장소를 넣어도 같은 이름 기억이 지워져 두 일정 모두 차로 간다', async () => {
    const t = setup([event('a', '친구 약속'), event('b', '친구 약속')]);
    await t.sync.run();
    await t.places.savePlace('a', { noTravel: true }, t.signal());
    await flush();
    await t.places.savePlace('b', { placeId: 'p1' }, t.signal());
    await flush();
    await t.sync.run();
    expect(t.server.bodies.at(-1)).toEqual(['a', 'b']);
    expect(t.server.overrides.get('b')).toEqual({ placeId: 'p1', noTravel: false });
  });

  it('기억 지우기가 아직 올라가기 전에도(오프라인) 보정된 일정은 거르지 않는다 — 보정 캐시가 덮는다', async () => {
    const t = setup([event('a', '친구 약속'), event('b', '친구 약속')]);
    await t.sync.run();
    await t.places.savePlace('b', { placeId: 'p1' }, t.signal());
    await flush();
    // 그 뒤 같은 이름을 [이동 없음]으로 기억(가장 최근 선택은 이동 없음이지만 b는 이미 장소를 넣어 둔 일정).
    await t.skips.add('친구 약속');
    await t.sync.run();
    expect(t.server.bodies.at(-1)).toEqual(['b']); // a는 이름으로 거르고 b는 보정이 이긴다
    expect(t.server.overrides.get('b')).toEqual({ placeId: 'p1', noTravel: false });
    expect(t.filtered.get().map((e) => [e.id, e.reason])).toEqual([['a', 'skipped']]);
  });

  it('조회한 3단계 목록의 보정된 일정도 같은 이유로 거르지 않는다(앱을 다시 열어 저장 응답을 모르는 경우)', async () => {
    const t = setup([event('b', '친구 약속')]);
    await t.sync.run();
    await t.places.savePlace('b', { placeId: 'p1' }, t.signal());
    await flush();
    t.corrected.clear(); // 앱을 다시 열었다
    await t.places.fetchSchedules(t.signal()); // 3단계를 열면 서버가 보정된 일정을 알려 준다
    await t.skips.add('친구 약속');
    await t.sync.run();
    expect(t.server.bodies.at(-1)).toEqual(['b']);
    expect(t.server.overrides.get('b')).toEqual({ placeId: 'p1', noTravel: false });
  });

  it('보정이 없는(이동 없음만 고른) 일정은 이름 기억대로 거른다(기존 동작)', async () => {
    const t = setup([event('a', '친구 약속')]);
    await t.sync.run();
    await t.places.savePlace('a', { noTravel: true }, t.signal());
    await flush();
    await t.sync.run();
    expect(t.server.bodies.at(-1)).toEqual([]);
    expect(t.filtered.get().map((e) => e.reason)).toEqual(['skipped']);
  });

  it('[이동 없음]을 되돌리면(undoNoTravel) 일정별 이동 없음과 이름 기억이 모두 돌아와 다음 동기화에서 그 일정이 차로 간다', async () => {
    const t = setup([event('a', '친구 약속')]);
    await t.sync.run();
    await t.places.savePlace('a', { noTravel: true }, t.signal());
    await flush();
    await t.places.undoNoTravel('a', '친구 약속', false, t.signal());
    await flush();
    expect(t.server.overrides.has('a')).toBe(false);
    expect(t.skips.has('친구 약속')).toBe(false);
    await t.sync.run();
    expect(t.server.bodies.at(-1)).toEqual(['a']);
  });
});
