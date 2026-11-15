import { act, render, waitFor } from '@testing-library/react-native';

import { HttpError } from '../../../api/request';
import type { DeviceEvent } from '../../calendar-select/calendarSource';
import { createEventSync } from '../../calendar-sync/eventSync';
import { createFilteredEventsStore } from '../../calendar-sync/filteredEvents';
import { markTravelByTitle, undoMarkTravel, undoUnskipByTitle, unskipByTitle } from '../../calendar-sync/travelMark';
import { createTravelExceptions, type KeyValueStorage } from '../../calendar-sync/travelExceptions';
import { useTravelMark } from '../../calendar-sync/useTravelMark';
import { rememberNoTravelName } from '../../fill-places/schedulePlacesApi';
import { createSkipMemory } from '../skipMemory';
import type { SkipChange, SkipEntry, SkipsApi } from '../skipsApi';

// 폰 거르기 4번·"이동 일정이에요" 되돌리기·3단계 이름 기억을 실제 skipMemory·travelExceptions·eventSync로 이어 본다(서버만 가짜).

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
};
const norm = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const event = (id: string, title: string, locationText: string | null): DeviceEvent => ({
  id,
  calendarId: '1',
  title,
  start: '2026-11-11T05:00:00.000Z',
  end: '2026-11-11T06:00:00.000Z',
  allDay: false,
  locationText,
  notes: null,
  attendees: [],
});
const kia = event('kia', 'KIA 직관', '광주-기아 챔피언스필드');
const zoom = event('zoom', '고객사 회의', 'Zoom');
const lunch = event('lunch', '육전집 점심', '광주 육전집');

/** 서버: 이동 없음 이름과 받은 일정을 기록하고 호출 순서를 남긴다. */
function setup(initialSkips: string[] = [], events: DeviceEvent[] = [kia, zoom, lunch]) {
  let list: SkipEntry[] = initialSkips.map((name) => ({ name, addedAt: '2026-11-11T01:00:00.000Z' }));
  const order: string[] = [];
  /** 서버가 받은 /skips 변경 요청 전부(내용 확인용). */
  const puts: SkipChange[] = [];
  const server = { down: false, sentEvents: [] as DeviceEvent[][] };
  const api: SkipsApi = {
    fetch: async () => {
      if (server.down) throw new Error('network');
      return list;
    },
    change: async (change: SkipChange) => {
      if (server.down) throw new Error('network');
      order.push(`PUT /skips ${JSON.stringify(change)}`);
      puts.push(change);
      const remove = new Set((change.remove ?? []).map(norm));
      list = list.filter((e) => !remove.has(norm(e.name)));
      for (const name of change.add ?? []) if (!list.some((e) => norm(e.name) === norm(name))) list = [{ name, addedAt: '2026-11-11T02:00:00.000Z' }, ...list];
      return list;
    },
  };
  const exceptions = createTravelExceptions(memoryStorage());
  const skips = createSkipMemory({ api, storage: memoryStorage(), exceptions, timeoutMs: 1000, loadTimeoutMs: 100, log: jest.fn() });
  const filtered = createFilteredEventsStore();
  const send = jest.fn(async (sent: DeviceEvent[]) => {
    if (server.down) throw new HttpError(503, 'down');
    order.push('PUT /events');
    server.sentEvents.push(sent);
    return {};
  });
  const sync = createEventSync({
    source: { kind: 'device', list: async () => [], listEvents: async () => events },
    fetchSelection: async () => ({ selectedIds: ['1'], source: 'device' }),
    send,
    fetchReceivedAt: async () => '2026-11-11T00:00:00.000Z',
    exceptions,
    skips,
    filtered,
    timeoutMs: 1000,
    log: jest.fn(),
  });
  const sentTitles = () => (server.sentEvents.at(-1) ?? []).map((e) => e.title);
  return {
    skips,
    exceptions,
    filtered,
    sync,
    send,
    server,
    order,
    sentTitles,
    puts,
    serverNames: () => list.map((e) => e.name),
    seedServer: (name: string) => void (list = [{ name, addedAt: '2026-11-11T03:00:00.000Z' }, ...list]),
  };
}

describe('3단계 "이동 없음" → 이름 기억', () => {
  it('이름을 기억하고 서버에 올리면, 다음 일정 읽기부터 같은 이름 일정은 보내지 않는다', async () => {
    const t = setup();
    await t.sync.run();
    expect(t.sentTitles()).toEqual(['KIA 직관', '육전집 점심']); // 온라인 줄은 지금도 거른다
    await rememberNoTravelName('  kia  직관 ', t.skips);
    await waitFor(() => expect(t.serverNames()).toEqual(['kia 직관']));
    await t.sync.run();
    expect(t.sentTitles()).toEqual(['육전집 점심']);
    expect(t.filtered.get().map((e) => [e.id, e.reason])).toEqual([['kia', 'skipped'], ['zoom', 'online']]);
  });

  it('서버에 올리지 못해도 폰에는 남고 다음 동기화에서 올라간다', async () => {
    const t = setup();
    t.server.down = true;
    await rememberNoTravelName('KIA 직관', t.skips);
    await t.skips.sync();
    expect(t.skips.has('KIA 직관')).toBe(true);
    t.server.down = false;
    await t.sync.run();
    expect(t.serverNames()).toEqual(['KIA 직관']);
    expect(t.sentTitles()).toEqual(['육전집 점심']);
  });

  it('같은 이름의 "이동 일정이에요" 예외는 지워진다', async () => {
    const t = setup();
    await t.exceptions.add('고객사 회의');
    await rememberNoTravelName('고객사 회의', t.skips);
    expect(t.exceptions.has('고객사 회의')).toBe(false);
  });
});

describe('흐린 줄 "이동 일정이에요": 이동 없음으로 기억한 줄은 기억을 지운다', () => {
  it('기억을 지워 서버에 먼저 올린 뒤 일정을 보내고, 그 줄이 목록에서 빠진다', async () => {
    const t = setup(['KIA 직관']);
    await t.sync.run();
    expect(t.filtered.get().map((e) => e.reason)).toEqual(['skipped', 'online']);
    t.order.length = 0;
    expect(await unskipByTitle('KIA 직관', { filtered: t.filtered, sync: t.sync, skips: t.skips })).toBe('ok');
    expect(t.order).toEqual(['PUT /skips {"remove":["kia 직관"]}', 'PUT /events']);
    expect(t.serverNames()).toEqual([]);
    expect(t.sentTitles()).toEqual(['KIA 직관', '육전집 점심']);
    expect(t.filtered.get().map((e) => e.id)).toEqual(['zoom']);
  });

  it('온라인 줄은 지금처럼 예외로 동작하고(기억은 건드리지 않음) 같은 이름이 기억에도 있었으면 기억을 지운다', async () => {
    const t = setup(['고객사 회의']);
    await t.sync.run();
    // 기억과 온라인이 겹치면 온라인 이유가 먼저 보인다(2·3번이 4번보다 앞).
    expect(t.filtered.get().find((e) => e.id === 'zoom')?.reason).toBe('online');
    t.order.length = 0;
    expect(await markTravelByTitle('고객사 회의', { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips })).toBe('ok');
    expect(t.order).toEqual(['PUT /skips {"remove":["고객사 회의"]}', 'PUT /events']);
    expect(t.exceptions.has('고객사 회의')).toBe(true);
    expect(t.serverNames()).toEqual([]);
    expect(t.server.sentEvents.at(-1)?.find((e) => e.id === 'zoom')).toMatchObject({ travelConfirmed: true });
  });

  it('온라인 줄만 있으면 기억 목록은 그대로다(예외만 더함)', async () => {
    const t = setup(['KIA 직관']);
    await t.sync.run();
    t.order.length = 0;
    await markTravelByTitle('고객사 회의', { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips });
    expect(t.serverNames()).toEqual(['KIA 직관']);
    // 기억하지 않은 이름이라 지우기를 쌓지 않는다: 거른 일정(온라인 줄)의 제목이 /skips로 나가지 않는다.
    expect(t.order).toEqual(['PUT /events']);
  });

  it('되돌리기는 이름을 다시 기억하고 일정을 다시 읽어 보낸다(그 일정은 다시 빠진다)', async () => {
    const t = setup(['KIA 직관']);
    await t.sync.run();
    await unskipByTitle('KIA 직관', { filtered: t.filtered, sync: t.sync, skips: t.skips });
    expect(await undoUnskipByTitle('KIA 직관', { sync: t.sync, skips: t.skips })).toBe('ok');
    expect(t.serverNames()).toEqual(['KIA 직관']);
    expect(t.sentTitles()).toEqual(['육전집 점심']);
    expect(t.filtered.get().map((e) => [e.id, e.reason])).toEqual([['kia', 'skipped'], ['zoom', 'online']]);
  });

  it('서버에 닿지 않으면 기억과 줄을 되돌리고 failed(그 줄이 사라지지 않는다)', async () => {
    const t = setup(['KIA 직관']);
    await t.sync.run();
    const before = t.filtered.get();
    t.server.down = true;
    expect(await unskipByTitle('KIA 직관', { filtered: t.filtered, sync: t.sync, skips: t.skips })).toBe('failed');
    expect(t.skips.has('KIA 직관')).toBe(true);
    expect(t.filtered.get()).toEqual(before);
  });

  it('온라인 줄을 바꾸다 실패하면 예외와 함께 지웠던 기억도 도로 더한다', async () => {
    const t = setup(['고객사 회의']);
    await t.sync.run();
    t.server.down = true;
    expect(await markTravelByTitle('고객사 회의', { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips })).toBe('failed');
    expect(t.exceptions.has('고객사 회의')).toBe(false);
    expect(t.skips.has('고객사 회의')).toBe(true);
  });

  it('바꾼 것을 서버에 올리지 못한 채 일정만 올라가면 failed로 알리고 되돌린다', async () => {
    const t = setup(['KIA 직관']);
    await t.sync.run();
    // 일정 보내기는 되지만 /skips만 안 되는 서버.
    const originalChange = jest.spyOn(t.skips, 'sync').mockResolvedValue({ refreshed: false, pendingFailed: true, full: false });
    expect(await unskipByTitle('KIA 직관', { filtered: t.filtered, sync: t.sync, skips: t.skips })).toBe('failed');
    expect(t.skips.has('KIA 직관')).toBe(true);
    originalChange.mockRestore();
  });

  it('"이동 일정이에요" 뒤 [되돌리기]는 다시 거르고, 그 바꾸기가 지웠던 같은 이름 기억도 되살린다', async () => {
    const t = setup(['고객사 회의']);
    const forgotten = new Set<string>();
    await t.sync.run();
    await markTravelByTitle('고객사 회의', { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips, forgotten });
    expect(t.skips.has('고객사 회의')).toBe(false);
    expect(t.serverNames()).toEqual([]);
    expect(await undoMarkTravel('고객사 회의', { exceptions: t.exceptions, sync: t.sync, skips: t.skips, forgotten })).toBe('ok');
    expect(t.exceptions.has('고객사 회의')).toBe(false);
    expect(t.skips.has('고객사 회의')).toBe(true);
    expect(t.serverNames()).toEqual(['고객사 회의']); // 서버에도 되살아난다
  });

  it('전부터 기억하던 이름이 아니면 되돌려도 기억을 만들지 않는다', async () => {
    const t = setup([]);
    const forgotten = new Set<string>();
    await t.sync.run();
    await markTravelByTitle('고객사 회의', { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips, forgotten });
    await undoMarkTravel('고객사 회의', { exceptions: t.exceptions, sync: t.sync, skips: t.skips, forgotten });
    expect(t.exceptions.has('고객사 회의')).toBe(false);
    expect(t.skips.has('고객사 회의')).toBe(false);
    expect(t.serverNames()).toEqual([]);
  });

  it('서버에 있던 이름이 아직 폰 캐시에 없어도(다른 곳에서 더함) 바꾸기 전에 맞춰 보고 그 기억을 지운다', async () => {
    const t = setup([]);
    await t.sync.run();
    t.seedServer('고객사 회의'); // 폰이 모르는 사이 서버에 생긴 기억
    await markTravelByTitle('고객사 회의', { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips, forgotten: new Set() });
    expect(t.serverNames()).toEqual([]);
    expect(t.exceptions.has('고객사 회의')).toBe(true); // 동기화가 예외를 지우지 않는다
  });
});

describe('거른 일정의 제목은 어떤 경로로도 /skips로 올라가지 않는다', () => {
  const online = '고객사 회의'; // 온라인 줄(Zoom): 폰이 거른 일정
  const titleSent = (t: ReturnType<typeof setup>) => t.puts.some((c) => JSON.stringify(c).includes(online));

  it('"이동 일정이에요" 성공·되돌리기·다시 바꾸기 어느 쪽에서도 /skips 요청에 제목이 없다', async () => {
    const t = setup([]);
    const forgotten = new Set<string>();
    const deps = { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips, forgotten };
    await t.sync.run();
    await markTravelByTitle(online, deps);
    await undoMarkTravel(online, deps);
    await markTravelByTitle(online, deps);
    await t.skips.sync();
    expect(titleSent(t)).toBe(false);
  });

  it('서버에 닿지 않아 바꾸기를 되돌린 뒤 다시 연결돼도 그 제목이 나중에 서버로 올라가지 않는다(리뷰어 탐침)', async () => {
    const t = setup([]);
    await t.sync.run();
    t.server.down = true;
    expect(await markTravelByTitle(online, { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips, forgotten: new Set() })).toBe('failed');
    expect(t.skips.hasPending()).toBe(false); // 쌓인 지우기가 없다
    t.server.down = false;
    await t.skips.sync();
    await t.sync.run();
    expect(titleSent(t)).toBe(false);
  });

  it('기억에 있던 이름이면 지우기는 나가지만(사용자가 기억한 이름), 실패해 되돌리면 이번에 쌓은 지우기도 지워져 나가지 않는다', async () => {
    const t = setup([online]);
    await t.sync.run();
    t.server.down = true;
    expect(await markTravelByTitle(online, { exceptions: t.exceptions, filtered: t.filtered, sync: t.sync, skips: t.skips, forgotten: new Set() })).toBe('failed');
    t.server.down = false;
    await t.skips.sync();
    expect(t.puts.filter((c) => (c.remove ?? []).length > 0)).toEqual([]);
    expect(t.serverNames()).toEqual([online]);
  });

  it('3단계 이동 없음·장소 넣기의 이름 기억은 서버가 아는 일정의 제목이다(폰이 거른 일정이 아니다)', async () => {
    const t = setup([]);
    await t.sync.run(); // 온라인 줄은 폰에만 있고 서버는 모른다
    await rememberNoTravelName('KIA 직관', t.skips);
    await waitFor(() => expect(t.serverNames()).toEqual(['KIA 직관']));
    expect(titleSent(t)).toBe(false);
  });
});

describe('useTravelMark: 이유가 skipped인 줄', () => {
  const lines = [
    { id: 'kia', title: 'KIA 직관', reason: 'skipped' },
    { id: 'zoom', title: '고객사 회의', reason: 'online' },
  ];
  let hook: ReturnType<typeof useTravelMark>;
  function Probe({ options }: { options: Parameters<typeof useTravelMark>[0] }) {
    hook = useTravelMark(options);
    return null;
  }
  const setupHook = async (over: Parameters<typeof useTravelMark>[0] = {}) => {
    const mark = jest.fn().mockResolvedValue('ok');
    const undo = jest.fn().mockResolvedValue('ok');
    const unskip = jest.fn().mockResolvedValue('ok');
    const undoUnskip = jest.fn().mockResolvedValue('ok');
    await render(<Probe options={{ mark, undo, unskip, undoUnskip, lines, undoVisibleMs: 60_000, ...over }} />);
    return { mark, undo, unskip, undoUnskip };
  };
  const confirmLine = async (id: string, title: string) => {
    await act(async () => hook.ask(id, title));
    await act(async () => hook.confirm());
  };

  it('skipped 줄은 unskip(기억 지우기), 온라인 줄은 mark(예외)로 동작한다', async () => {
    const { mark, unskip } = await setupHook();
    await confirmLine('kia', 'KIA 직관');
    expect(unskip).toHaveBeenCalledWith('KIA 직관');
    expect(mark).not.toHaveBeenCalled();
    await confirmLine('zoom', '고객사 회의');
    expect(mark).toHaveBeenCalledWith('고객사 회의');
    expect(unskip).toHaveBeenCalledTimes(1);
  });

  it('되돌리기도 줄의 이유를 따른다(skipped는 undoUnskip)', async () => {
    const { undo, undoUnskip } = await setupHook();
    await confirmLine('kia', 'KIA 직관');
    expect(hook.undoable).toEqual({ title: 'KIA 직관', skipped: true });
    await act(async () => hook.undoNow());
    expect(undoUnskip).toHaveBeenCalledWith('KIA 직관');
    expect(undo).not.toHaveBeenCalled();
    await confirmLine('zoom', '고객사 회의');
    await act(async () => hook.undoNow());
    expect(undo).toHaveBeenCalledWith('고객사 회의');
  });

  it('실패하면 안내하고 되돌리기를 보이지 않는다', async () => {
    await setupHook({ unskip: jest.fn().mockResolvedValue('failed') });
    await confirmLine('kia', 'KIA 직관');
    expect(hook.issue).toBe('mark');
    expect(hook.undoable).toBeNull();
  });

  it('lines를 넘기지 않으면 지금처럼 항상 mark다', async () => {
    const { mark, unskip } = await setupHook({ lines: undefined });
    await confirmLine('kia', 'KIA 직관');
    expect(mark).toHaveBeenCalledWith('KIA 직관');
    expect(unskip).not.toHaveBeenCalled();
  });
});
