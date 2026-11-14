import { CalendarPermissionError, type CalendarSource, type DeviceEvent } from '../../calendar-select/calendarSource';
import { HttpError } from '../../../api/request';
import { createEventSync, DUPLICATE_WINDOW_MS } from '../eventSync';
import { createFilteredEventsStore } from '../filteredEvents';
import { PAYLOAD_BUDGET_BYTES } from '../payloadBudget';
import { createTravelExceptions } from '../travelExceptions';

const event = (id = 'a'): DeviceEvent => ({
  id,
  calendarId: '1',
  title: '회의',
  start: '2026-11-11T05:00:00.000Z',
  end: '2026-11-11T06:00:00.000Z',
  allDay: false,
  locationText: null,
  notes: null,
  attendees: [],
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setup = (over: { kind?: 'mock' | 'device'; events?: DeviceEvent[] } = {}) => {
  let clock = 1_000_000;
  const listEvents = jest.fn().mockImplementation(async () => over.events ?? [event()]);
  const source: CalendarSource = { kind: over.kind ?? 'device', list: async () => [], listEvents };
  const fetchSelection = jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' });
  const send = jest.fn().mockResolvedValue({});
  const saveSelection = jest.fn().mockResolvedValue({});
  const log = jest.fn();
  const sync = createEventSync({ source, fetchSelection, saveSelection, send, timeoutMs: 1000, now: () => new Date(clock), log });
  return { sync, listEvents, fetchSelection, saveSelection, send, log, advance: (ms: number) => (clock += ms) };
};

describe('createEventSync', () => {
  afterEach(() => jest.useRealTimers());

  it('고른 캘린더를 읽어 오늘·내일 일정을 보낸다', async () => {
    const { sync, listEvents, send } = setup();
    expect(await sync.run()).toBe('sent');
    expect(listEvents).toHaveBeenCalledWith(['1'], new Date(1_000_000));
    expect(send).toHaveBeenCalledWith([event()], expect.any(AbortSignal));
  });

  it('목 출처는 읽지도 보내지도 않는다(서버는 픽스처를 쓴다)', async () => {
    const { sync, fetchSelection, listEvents, send } = setup({ kind: 'mock' });
    expect(await sync.run()).toBe('mock');
    expect(fetchSelection).not.toHaveBeenCalled();
    expect(listEvents).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('고른 캘린더가 없으면(나중에 할게요) 보내지 않는다', async () => {
    const { sync, fetchSelection, listEvents, send } = setup();
    fetchSelection.mockResolvedValueOnce({ selectedIds: null, source: null });
    expect(await sync.run()).toBe('no-selection');
    fetchSelection.mockResolvedValueOnce({ selectedIds: [], source: 'device' });
    expect(await sync.run()).toBe('no-selection');
    expect(listEvents).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('권한이 없으면 보내지 않고, 다음에 다시 시도한다', async () => {
    const { sync, listEvents, send } = setup();
    listEvents.mockRejectedValueOnce(new CalendarPermissionError(false));
    expect(await sync.run()).toBe('permission-denied');
    expect(send).not.toHaveBeenCalled();
    expect(await sync.run()).toBe('sent');
  });

  it('일정이 0건이어도 보낸다(서버가 오래된 일정을 비우도록)', async () => {
    const { sync, send } = setup({ events: [] });
    expect(await sync.run()).toBe('sent');
    expect(send).toHaveBeenCalledWith([], expect.any(AbortSignal));
  });

  it('선택 조회·읽기·전송이 실패하면 failed이고 다음 호출에서 다시 보낸다', async () => {
    const { sync, fetchSelection, listEvents, send } = setup();
    fetchSelection.mockRejectedValueOnce(new Error('net'));
    expect(await sync.run()).toBe('failed');
    listEvents.mockRejectedValueOnce(new Error('read'));
    expect(await sync.run()).toBe('failed');
    send.mockRejectedValueOnce(new Error('500'));
    expect(await sync.run()).toBe('failed');
    expect(await sync.run()).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('요청이 시간 제한을 넘기면 failed', async () => {
    const { sync, send } = setup();
    send.mockReturnValueOnce(new Promise(() => {}));
    jest.useFakeTimers();
    const result = sync.run();
    await jest.advanceTimersByTimeAsync(1001);
    expect(await result).toBe('failed');
  });

  it('서버의 선택이 목 캘린더 id(source=mock)면 기기 일정을 읽지도 보내지도 않는다(빈 목록으로 폰 출처가 굳는 것 방지)', async () => {
    const { sync, fetchSelection, listEvents, send } = setup();
    fetchSelection.mockResolvedValue({ selectedIds: ['mock-my', 'mock-work'], source: 'mock' });
    expect(await sync.run()).toBe('no-selection');
    expect(listEvents).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('서버가 선택을 잃었으면 기억한 선택을 다시 저장하고 이어서 보낸다', async () => {
    const { sync, fetchSelection, saveSelection, listEvents, send } = setup();
    fetchSelection.mockResolvedValue({ selectedIds: null, source: null });
    expect(await sync.run()).toBe('no-selection'); // 기억한 것이 없으면 보내지 않는다
    sync.rememberSelection(['7', '8']);
    expect(await sync.run()).toBe('sent');
    expect(saveSelection).toHaveBeenCalledWith(['7', '8'], expect.any(Number), expect.any(AbortSignal));
    expect(listEvents).toHaveBeenCalledWith(['7', '8'], expect.any(Date));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('서버에 선택이 남아 있으면 기억한 선택으로 덮어쓰지 않는다', async () => {
    const { sync, saveSelection } = setup();
    sync.rememberSelection(['9']);
    await sync.run();
    expect(saveSelection).not.toHaveBeenCalled();
  });

  it('캘린더 읽기가 시간 제한을 넘기면 failed', async () => {
    const { sync, listEvents } = setup();
    listEvents.mockReturnValueOnce(new Promise(() => {}));
    jest.useFakeTimers();
    const result = sync.run();
    await jest.advanceTimersByTimeAsync(1001);
    expect(await result).toBe('failed');
  });

  it('직렬화 크기가 보내기 예산(1MB 안)을 넘으면 앞쪽 일정만 보낸다', async () => {
    const big = Array.from({ length: 150 }, (_, i) => ({ ...event(`e${i}`), title: '가'.repeat(200), notes: '나'.repeat(2000) }));
    const { sync, send } = setup({ events: big });
    expect(await sync.run()).toBe('sent');
    const sent = send.mock.calls[0][0] as DeviceEvent[];
    expect(sent.length).toBeLessThan(150);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].id).toBe('e0');
    expect(new TextEncoder().encode(JSON.stringify({ events: sent })).length).toBeLessThanOrEqual(PAYLOAD_BUDGET_BYTES);
  });

  describe('실패를 드러낸다', () => {
    it('413 같은 전송 실패를 일정 내용 없이 로그와 lastResult로 남긴다', async () => {
      const { sync, send, log } = setup();
      send.mockRejectedValueOnce(new HttpError(413, 'PUT /events 413'));
      expect(await sync.run()).toBe('failed');
      expect(sync.lastResult()).toBe('failed');
      expect(log).toHaveBeenCalledWith('[calendar-sync] PUT /events 실패: HTTP 413');
      expect(log.mock.calls.join()).not.toContain('회의');
    });
  });

  describe('중복 방지', () => {
    it('같은 내용은 5분 안에 다시 보내지 않고, 지나면 다시 보낸다', async () => {
      const { sync, send, advance } = setup();
      expect(await sync.run()).toBe('sent');
      advance(DUPLICATE_WINDOW_MS - 1);
      expect(await sync.run()).toBe('unchanged');
      expect(send).toHaveBeenCalledTimes(1);
      advance(2);
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('내용이 바뀌면 바로 보낸다', async () => {
      const { sync, send, listEvents } = setup();
      await sync.run();
      listEvents.mockResolvedValueOnce([event('b')]);
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('실패한 전송은 보낸 것으로 치지 않는다', async () => {
      const { sync, send } = setup();
      send.mockRejectedValueOnce(new Error('x'));
      await sync.run();
      expect(await sync.run()).toBe('sent');
    });
  });

  describe('동시에 하나만', () => {
    it('보내는 중에 여러 번 불려도 전송은 하나씩이고, 끝난 뒤 한 번만 더 돈다', async () => {
      const { sync, send, listEvents } = setup();
      const first = deferred<unknown>();
      send.mockReturnValueOnce(first.promise);
      const a = sync.run();
      await new Promise((r) => setTimeout(r, 0)); // 첫 전송이 시작될 때까지
      expect(send).toHaveBeenCalledTimes(1);
      const b = sync.run();
      const c = sync.run();
      expect(b).toBe(a);
      expect(c).toBe(a);
      listEvents.mockResolvedValue([event('changed')]); // 다시 읽으면 바뀐 내용이 나온다
      await new Promise((r) => setTimeout(r, 0));
      expect(send).toHaveBeenCalledTimes(1); // 첫 전송이 끝나기 전에는 두 번째를 보내지 않는다
      first.resolve({});
      await a;
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1][0]).toEqual([event('changed')]);
    });

    it('합쳐진 호출이 없으면 재실행하지 않는다', async () => {
      const { sync, send } = setup();
      await sync.run();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('취소와 오래된 응답', () => {
    it('stop하면 진행 중 전송 결과를 기록하지 않아 다음에 다시 보낸다', async () => {
      const { sync, send } = setup();
      const pending = deferred<unknown>();
      send.mockReturnValueOnce(pending.promise);
      const result = sync.run();
      await new Promise((r) => setTimeout(r, 0));
      sync.stop();
      pending.resolve({});
      expect(await result).toBe('cancelled');
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('stop 뒤에 늦게 온 선택 조회 응답은 읽기·전송으로 이어지지 않는다', async () => {
      const { sync, fetchSelection, listEvents, send } = setup();
      const pending = deferred<{ selectedIds: string[]; source: 'device' }>();
      fetchSelection.mockReturnValueOnce(pending.promise);
      const result = sync.run();
      sync.stop();
      pending.resolve({ selectedIds: ['1'], source: 'device' });
      expect(await result).toBe('cancelled');
      expect(listEvents).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('폰에서 거르기', () => {
    const memory = () => {
      const data = new Map<string, string>();
      return { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => void data.set(k, v) };
    };
    const filterSetup = (events: DeviceEvent[]) => {
      const exceptions = createTravelExceptions(memory());
      const filtered = createFilteredEventsStore();
      const listEvents = jest.fn().mockImplementation(async () => events);
      const source: CalendarSource = { kind: 'device', list: async () => [], listEvents };
      const send = jest.fn().mockResolvedValue({});
      const sync = createEventSync({
        source,
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        exceptions,
        filtered,
        timeoutMs: 1000,
        now: () => new Date(1_000_000),
        log: jest.fn(),
      });
      return { sync, send, exceptions, filtered };
    };
    const zoom = { ...event('zoom'), title: '고객사 주간 회의', locationText: 'Zoom', notes: '비밀번호 1234' };
    const room = { ...event('room'), title: '기획 리뷰', locationText: '7층 대회의실' };
    const lunch = { ...event('lunch'), title: '육전집 점심', locationText: '광주 육전집' };
    const empty = { ...event('empty'), title: '장소 없는 약속', locationText: null };
    const trip = { ...event('trip'), title: '제주 출장', allDay: true, locationText: null, notes: '항공권 ABC', attendees: ['김철수'] };

    it('걸러진 일정은 PUT /events 본문에 없고(제목이 폰 밖으로 나가지 않음) 폰 로컬 목록에만 남는다', async () => {
      const { sync, send, filtered } = filterSetup([zoom, room, lunch, empty, trip]);
      expect(await sync.run()).toBe('sent');
      const body = send.mock.calls[0][0] as DeviceEvent[];
      expect(body.map((e) => e.id)).toEqual(['lunch', 'empty', 'trip']);
      const wire = JSON.stringify({ events: body });
      expect(wire).not.toMatch(/고객사 주간 회의|기획 리뷰|비밀번호|Zoom|대회의실/);
      expect(filtered.get().map((e) => [e.id, e.title, e.reason])).toEqual([
        ['zoom', '고객사 주간 회의', 'online'],
        ['room', '기획 리뷰', 'meetingRoom'],
      ]);
    });

    it('종일 일정은 이름만 보낸다', async () => {
      const { sync, send } = filterSetup([trip]);
      await sync.run();
      expect(send.mock.calls[0][0]).toEqual([{ ...trip, notes: null, attendees: [] }]);
    });

    it('거른 일정만 있어도 빈 목록으로 보낸다(서버가 폰 출처로 굳는다)', async () => {
      const { sync, send } = filterSetup([zoom]);
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledWith([], expect.any(AbortSignal));
    });

    it('"이동 일정이에요" 뒤에는 같은 이름 일정을 보낸다(안전망을 건너뛰는 표시와 함께)', async () => {
      const { sync, send, exceptions, filtered } = filterSetup([zoom, room]);
      await sync.run();
      expect(filtered.get()).toHaveLength(2);
      await exceptions.add('  고객사  주간 회의 ');
      expect(await sync.run()).toBe('sent');
      const body = send.mock.calls[1][0] as DeviceEvent[];
      expect(body).toEqual([{ ...zoom, travelConfirmed: true }]);
      expect(filtered.get().map((e) => e.id)).toEqual(['room']);
    });

    it('예외 이름은 저장소에서 읽어 앱을 다시 켜도 유지된다', async () => {
      const storage = memory();
      await createTravelExceptions(storage).add('기획 리뷰');
      const filtered = createFilteredEventsStore();
      const send = jest.fn().mockResolvedValue({});
      const sync = createEventSync({
        source: { kind: 'device', list: async () => [], listEvents: async () => [room] },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        exceptions: createTravelExceptions(storage),
        filtered,
        timeoutMs: 1000,
        log: jest.fn(),
      });
      await sync.run();
      expect(send.mock.calls[0][0]).toEqual([{ ...room, travelConfirmed: true }]);
      expect(filtered.get()).toEqual([]);
    });

    it('목 출처는 거를 일정이 없고 로컬 목록을 건드리지 않는다', async () => {
      const exceptions = createTravelExceptions(memory());
      const filtered = createFilteredEventsStore();
      filtered.set([{ id: 'x', title: 'x', start: 'a', end: 'b', reason: 'online' }]);
      const sync = createEventSync({ source: { kind: 'mock', list: async () => [], listEvents: async () => [] }, exceptions, filtered, send: jest.fn(), log: jest.fn() });
      expect(await sync.run()).toBe('mock');
      expect(filtered.get()).toHaveLength(1);
    });
  });
});
