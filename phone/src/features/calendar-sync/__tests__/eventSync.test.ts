import { CalendarPermissionError, type CalendarSource, type DeviceEvent } from '../../calendar-select/calendarSource';
import { HttpError } from '../../../api/request';
import { createContactFinder } from '../../contacts/contactFinder';
import { makeContacts } from '../../settings/testSupport';
import { createEventSync, RESEND_UNCHANGED_AFTER_MS } from '../eventSync';
import { createFilteredEventsStore } from '../filteredEvents';
import { PAYLOAD_BUDGET_BYTES } from '../payloadBudget';
import { createTravelExceptions } from '../travelExceptions';
import { toWireEvent, type WireEvent } from '../wireEvent';

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

/** 연락 상대를 찾지 않는 기본 찾기(실제 찾기는 서버 설정·연락처를 읽는다). 연락 상대 테스트는 따로 넣는다. */
const noContacts = { prepare: jest.fn().mockResolvedValue(null) };
const createSync = (options: Parameters<typeof createEventSync>[0] = {}) => createEventSync({ contacts: noContacts, ...options });
/** 서버로 가는 모양: 참석자 이름·이메일 없이 contacts만 싣는다. */
const wire = (e: DeviceEvent, contacts: string[] = []) => toWireEvent(e, contacts);

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
  // 서버가 폰 일정을 받은 시각(기본: 받았음).
  const fetchReceivedAt = jest.fn().mockResolvedValue('2026-11-11T00:00:00.000Z');
  const log = jest.fn();
  const sync = createSync({ source, fetchSelection, saveSelection, send, fetchReceivedAt, timeoutMs: 1000, now: () => new Date(clock), log });
  return { sync, listEvents, fetchSelection, saveSelection, send, fetchReceivedAt, log, advance: (ms: number) => (clock += ms) };
};

describe('createEventSync', () => {
  afterEach(() => jest.useRealTimers());

  it('고른 캘린더를 읽어 오늘·내일 일정을 보낸다', async () => {
    const { sync, listEvents, send } = setup();
    expect(await sync.run()).toBe('sent');
    expect(listEvents).toHaveBeenCalledWith(['1'], new Date(1_000_000));
    expect(send).toHaveBeenCalledWith([wire(event())], expect.any(AbortSignal));
  });

  it('끝날 때마다 구독자에게 결과를 알리고(성공·실패·권한 없음), 해제하면 알리지 않는다. 구독자가 던져도 동기화는 이어 간다', async () => {
    const { sync, listEvents, send } = setup();
    const results: string[] = [];
    const off = sync.subscribe((r) => results.push(r));
    sync.subscribe(() => {
      throw new Error('x');
    });
    expect(await sync.run()).toBe('sent');
    listEvents.mockRejectedValueOnce(new CalendarPermissionError(false));
    expect(await sync.run()).toBe('permission-denied');
    listEvents.mockResolvedValueOnce([event('b')]); // 내용이 달라야 '변화 없음'으로 건너뛰지 않고 보낸다
    send.mockRejectedValueOnce(new HttpError(500, 'x'));
    expect(await sync.run()).toBe('failed');
    expect(results).toEqual(['sent', 'permission-denied', 'failed']);
    off();
    await sync.run();
    expect(results).toHaveLength(3);
  });

  it('inFlight는 도는 중에만 그 실행의 결과로 풀리는 약속을 주고, 끝나면 null이다', async () => {
    const { sync, send } = setup();
    expect(sync.inFlight()).toBeNull();
    const gate = deferred<unknown>();
    send.mockReturnValueOnce(gate.promise);
    const run = sync.run();
    const pending = sync.inFlight();
    expect(pending).not.toBeNull();
    gate.resolve({});
    expect(await pending).toBe('sent');
    expect(await run).toBe('sent');
    expect(sync.inFlight()).toBeNull();
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
    const sent = send.mock.calls[0][0] as WireEvent[];
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
    it('같은 내용은 RESEND_UNCHANGED_AFTER_MS(15분) 안에 다시 보내지 않고, 지나면 다시 보낸다', async () => {
      const { sync, send, advance } = setup();
      expect(RESEND_UNCHANGED_AFTER_MS).toBe(15 * 60 * 1000);
      expect(await sync.run()).toBe('sent');
      advance(RESEND_UNCHANGED_AFTER_MS - 1);
      expect(await sync.run()).toBe('unchanged');
      expect(send).toHaveBeenCalledTimes(1);
      advance(2);
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('3분마다 읽어도 같은 내용은 15분에 한 번만 다시 보낸다(주기와 간격이 어긋나지 않는다)', async () => {
      const { sync, send, advance } = setup();
      const results: string[] = [];
      results.push(await sync.run());
      for (let minute = 3; minute <= 18; minute += 3) {
        advance(3 * 60 * 1000);
        results.push(await sync.run());
      }
      // 0분 sent, 3·6·9·12분 unchanged, 15분 sent, 18분 unchanged
      expect(results).toEqual(['sent', 'unchanged', 'unchanged', 'unchanged', 'unchanged', 'sent', 'unchanged']);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('간격은 보내기를 시작한 때부터 잰다(응답이 늦어도 밀리지 않는다)', async () => {
      const { sync, send, advance } = setup();
      send.mockImplementationOnce(async () => {
        advance(60 * 1000); // 응답에 1분이 걸렸다
        return {};
      });
      await sync.run();
      advance(RESEND_UNCHANGED_AFTER_MS - 60 * 1000);
      expect(await sync.run()).toBe('sent');
    });

    it('같은 내용이어도 서버가 일정을 받은 적이 없으면(receivedAt null) 다시 보낸다', async () => {
      const { sync, send, fetchReceivedAt, advance } = setup();
      expect(await sync.run()).toBe('sent');
      advance(60_000);
      fetchReceivedAt.mockResolvedValueOnce(null); // 서버 재시작·초기화
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
      advance(60_000);
      expect(await sync.run()).toBe('unchanged'); // 다시 받은 뒤에는 생략
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('서버 상태를 확인하지 못하면 생략하지 않고 보낸다', async () => {
      const { sync, send, fetchReceivedAt, advance } = setup();
      await sync.run();
      advance(60_000);
      fetchReceivedAt.mockRejectedValueOnce(new HttpError(403, 'GET /events 403'));
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('서버 상태는 같은 내용을 생략하기 직전에만 확인한다(처음 보내거나 내용이 바뀌면 묻지 않는다)', async () => {
      const { sync, fetchReceivedAt, listEvents, advance } = setup();
      await sync.run();
      expect(fetchReceivedAt).not.toHaveBeenCalled();
      listEvents.mockResolvedValue([event('b')]);
      await sync.run();
      expect(fetchReceivedAt).not.toHaveBeenCalled();
      advance(60_000);
      await sync.run();
      expect(fetchReceivedAt).toHaveBeenCalledTimes(1);
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

  describe('서버가 재시작해 선택을 잃었을 때', () => {
    it('선택을 다시 저장한 경로에서는 같은 내용이어도 일정을 다시 보낸다(15분 생략을 건너뜀)', async () => {
      const { sync, fetchSelection, saveSelection, send, advance } = setup();
      sync.rememberSelection(['1']);
      expect(await sync.run()).toBe('sent');
      advance(60_000);
      fetchSelection.mockResolvedValueOnce({ selectedIds: null, source: null }); // 서버 재시작
      expect(await sync.run()).toBe('sent');
      expect(saveSelection).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('그때 보내기가 실패해도 다음 읽기에서 서버가 받은 적 없음(receivedAt null)을 알아채 다시 보낸다', async () => {
      const { sync, fetchSelection, send, fetchReceivedAt, advance } = setup();
      sync.rememberSelection(['1']);
      await sync.run();
      advance(60_000);
      fetchSelection.mockResolvedValueOnce({ selectedIds: null, source: null });
      send.mockRejectedValueOnce(new HttpError(500, 'PUT /events 500'));
      expect(await sync.run()).toBe('failed');
      advance(60_000);
      fetchReceivedAt.mockResolvedValueOnce(null);
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(3);
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
      expect(send.mock.calls[1][0]).toEqual([wire(event('changed'))]);
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
      const sync = createSync({
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
      const body = send.mock.calls[0][0] as WireEvent[];
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
      expect(send.mock.calls[0][0]).toEqual([wire({ ...trip, notes: null })]);
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
      const body = send.mock.calls[1][0] as WireEvent[];
      expect(body).toEqual([wire({ ...zoom, travelConfirmed: true })]);
      expect(filtered.get().map((e) => e.id)).toEqual(['room']);
    });

    it('예외 이름은 저장소에서 읽어 앱을 다시 켜도 유지된다', async () => {
      const storage = memory();
      await createTravelExceptions(storage).add('기획 리뷰');
      const filtered = createFilteredEventsStore();
      const send = jest.fn().mockResolvedValue({});
      const sync = createSync({
        source: { kind: 'device', list: async () => [], listEvents: async () => [room] },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        exceptions: createTravelExceptions(storage),
        filtered,
        timeoutMs: 1000,
        log: jest.fn(),
      });
      await sync.run();
      expect(send.mock.calls[0][0]).toEqual([wire({ ...room, travelConfirmed: true })]);
      expect(filtered.get()).toEqual([]);
    });

    const staleItem = { id: 'x', title: '낡은 일정', start: '2026-11-11T05:00:00.000Z', end: '2026-11-11T06:00:00.000Z', reason: 'online' as const };

    it('고른 캘린더가 없거나(no-selection) 권한이 없거나 캘린더를 읽지 못하면 이전 거른 목록을 비운다', async () => {
      const exceptions = createTravelExceptions(memory());
      const run = async (arrange: (parts: { fetchSelection: jest.Mock; listEvents: jest.Mock }) => void) => {
        const filtered = createFilteredEventsStore();
        filtered.set([staleItem]);
        const listEvents = jest.fn().mockResolvedValue([]);
        const fetchSelection = jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' });
        arrange({ fetchSelection, listEvents });
        const sync = createSync({
          source: { kind: 'device', list: async () => [], listEvents },
          fetchSelection,
          send: jest.fn().mockResolvedValue({}),
          exceptions,
          filtered,
          timeoutMs: 1000,
          log: jest.fn(),
        });
        return { result: await sync.run(), filtered };
      };
      const none = await run(({ fetchSelection }) => fetchSelection.mockResolvedValue({ selectedIds: null, source: null }));
      expect(none.result).toBe('no-selection');
      expect(none.filtered.get()).toEqual([]);
      const mockSource = await run(({ fetchSelection }) => fetchSelection.mockResolvedValue({ selectedIds: ['mock-my'], source: 'mock' }));
      expect(mockSource.result).toBe('no-selection');
      expect(mockSource.filtered.get()).toEqual([]);
      const denied = await run(({ listEvents }) => listEvents.mockRejectedValue(new CalendarPermissionError(false)));
      expect(denied.result).toBe('permission-denied');
      expect(denied.filtered.get()).toEqual([]);
      const readFail = await run(({ listEvents }) => listEvents.mockRejectedValue(new Error('read')));
      expect(readFail.result).toBe('failed');
      expect(readFail.filtered.get()).toEqual([]);
    });

    it('전송이 실패해도 방금 거른 목록은 남는다(읽기는 성공했다)', async () => {
      const filtered = createFilteredEventsStore();
      const sync = createSync({
        source: { kind: 'device', list: async () => [], listEvents: async () => [zoom] },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send: jest.fn().mockRejectedValue(new Error('500')),
        exceptions: createTravelExceptions(memory()),
        filtered,
        timeoutMs: 1000,
        log: jest.fn(),
      });
      expect(await sync.run()).toBe('failed');
      expect(filtered.get().map((e) => e.id)).toEqual(['zoom']);
    });

    it('종일 일정의 장소 칸이 온라인·건물 안 표시면 장소를 비워 이름만 보낸다', async () => {
      const online = { ...trip, id: 'a', title: '워크숍', locationText: 'Zoom' };
      const indoor = { ...trip, id: 'b', title: '팀 데이', locationText: '본사 3층 회의실' };
      const place = { ...trip, id: 'c', title: '제주 출장', locationText: '제주' };
      const { sync, send } = filterSetup([online, indoor, place]);
      await sync.run();
      expect(send.mock.calls[0][0]).toEqual([
        wire({ ...online, notes: null, locationText: null }),
        wire({ ...indoor, notes: null, locationText: null }),
        wire({ ...place, notes: null }),
      ]);
    });

    it('예외 목록 읽기가 멈춰도 시간 제한 뒤 이름 없이 이어 가고 동기화가 멈추지 않는다', async () => {
      jest.useFakeTimers();
      const hanging = {
        load: jest.fn().mockReturnValue(new Promise(() => {})),
        has: () => false,
      };
      const filtered = createFilteredEventsStore();
      const send = jest.fn().mockResolvedValue({});
      const log = jest.fn();
      const sync = createSync({
        source: { kind: 'device', list: async () => [], listEvents: async () => [room, lunch] },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        exceptions: hanging,
        filtered,
        timeoutMs: 1000,
        log,
      });
      const result = sync.run();
      await jest.advanceTimersByTimeAsync(1001);
      expect(await result).toBe('sent');
      expect(send.mock.calls[0][0]).toEqual([wire(lunch)]);
      expect(filtered.get().map((e) => e.id)).toEqual(['room']);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('이동 예외 목록 읽기 실패'));
    });

    it('목 출처는 거를 일정이 없고 로컬 목록을 건드리지 않는다', async () => {
      const exceptions = createTravelExceptions(memory());
      const filtered = createFilteredEventsStore();
      filtered.set([{ id: 'x', title: 'x', start: 'a', end: 'b', reason: 'online' }]);
      const sync = createSync({ source: { kind: 'mock', list: async () => [], listEvents: async () => [] }, exceptions, filtered, send: jest.fn(), log: jest.fn() });
      expect(await sync.run()).toBe('mock');
      expect(filtered.get()).toHaveLength(1);
    });
  });

  describe('이동 없음 기억(정책서 10.3 4번)', () => {
    const memory = () => {
      const data = new Map<string, string>();
      return { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => void data.set(k, v) };
    };
    const named = (id: string, title: string) => ({ ...event(id), title, locationText: '광주 육전집' });
    const kia = named('kia', 'KIA 직관');
    const lunch = named('lunch', '육전집 점심');
    type SkipsParts = { load: jest.Mock; has: jest.Mock; sync: jest.Mock; hasPending: jest.Mock };
    const synced = { refreshed: true, pendingFailed: false, full: false };
    const skipsOf = (names: string[], over: Partial<SkipsParts> = {}): SkipsParts => ({
      load: jest.fn().mockResolvedValue(undefined),
      has: jest.fn((title: string) => names.includes(title)),
      sync: jest.fn().mockResolvedValue(synced),
      hasPending: jest.fn().mockReturnValue(false),
      ...over,
    });
    const build = (skips: SkipsParts, events: DeviceEvent[] = [kia, lunch]) => {
      const filtered = createFilteredEventsStore();
      const order: string[] = [];
      skips.sync.mockImplementation(async () => {
        order.push('skips.sync');
        return synced;
      });
      const send = jest.fn().mockImplementation(async () => {
        order.push('send');
        return {};
      });
      const log = jest.fn();
      const sync = createSync({
        source: { kind: 'device', list: async () => [], listEvents: async () => events },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        exceptions: createTravelExceptions(memory()),
        skips,
        filtered,
        timeoutMs: 1000,
        log,
      });
      return { sync, send, filtered, order, log };
    };

    it('기억한 이름의 일정은 서버로 보내지 않고(PUT 본문에 없음) 폰 로컬 목록에 이유 skipped로 둔다', async () => {
      const { sync, send, filtered } = build(skipsOf(['KIA 직관']));
      expect(await sync.run()).toBe('sent');
      expect(send.mock.calls[0][0]).toEqual([wire(lunch)]);
      expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('KIA');
      expect(filtered.get()).toEqual([{ id: 'kia', title: 'KIA 직관', start: kia.start, end: kia.end, reason: 'skipped' }]);
    });

    it('일정을 보내기 전에 서버와 맞춘다(바꾼 것을 먼저 올림)', async () => {
      const { sync, order } = build(skipsOf([]));
      await sync.run();
      expect(order).toEqual(['skips.sync', 'send']);
    });

    it('목록을 받지 못해도(캐시로 이어 감) 동기화는 계속한다', async () => {
      const skips = skipsOf(['KIA 직관']);
      const { sync, send, filtered } = build(skips);
      skips.sync.mockResolvedValue({ ...synced, refreshed: false });
      expect(await sync.run()).toBe('sent');
      expect(send.mock.calls[0][0]).toEqual([wire(lunch)]);
      expect(filtered.get().map((e) => e.reason)).toEqual(['skipped']);
    });

    it('맞추기가 던져도 동기화는 멈추지 않는다', async () => {
      const skips = skipsOf([]);
      const { sync, send, log } = build(skips);
      skips.sync.mockRejectedValue(new Error('boom'));
      expect(await sync.run()).toBe('sent');
      expect(send).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('이동 없음 목록 맞추기 실패'));
    });

    it('바꾼 것을 올리지 못한 채 보냈으면 failed이고 같은 내용도 다음에 다시 보낸다', async () => {
      const skips = skipsOf([]);
      const { sync, send } = build(skips);
      skips.sync.mockResolvedValue({ ...synced, refreshed: false, pendingFailed: true });
      expect(await sync.run()).toBe('failed');
      skips.sync.mockResolvedValue(synced);
      expect(await sync.run()).toBe('sent'); // 'unchanged'로 생략하지 않는다
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('맞춘 뒤 일정을 보내는 동안에도 올리지 못한 변경이 남았으면 성공으로 기록하지 않고 다음에 다시 보낸다(합류한 호출 뒤에 생긴 변경)', async () => {
      const skips = skipsOf([]);
      const { sync, send } = build(skips);
      // sync 결과는 깨끗하지만(진행 중인 동기화에 합류) 그 뒤에 사용자가 바꾼 변경이 남아 있다.
      skips.hasPending.mockReturnValue(true);
      expect(await sync.run()).toBe('failed');
      skips.hasPending.mockReturnValue(false);
      expect(await sync.run()).toBe('sent'); // 'unchanged'로 생략하지 않는다
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('장소를 넣어 보정한 일정은 이름이 기억돼 있어도 거르지 않고 보낸다', async () => {
      const filtered = createFilteredEventsStore();
      const send = jest.fn().mockResolvedValue({});
      const sync = createSync({
        source: { kind: 'device', list: async () => [], listEvents: async () => [kia, lunch] },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        exceptions: createTravelExceptions(memory()),
        skips: skipsOf(['KIA 직관', '육전집 점심']),
        corrected: { has: (id) => id === 'kia' },
        filtered,
        timeoutMs: 1000,
        log: jest.fn(),
      });
      expect(await sync.run()).toBe('sent');
      expect(send.mock.calls[0][0]).toEqual([wire(kia)]);
      expect(filtered.get().map((e) => [e.id, e.reason])).toEqual([['lunch', 'skipped']]);
    });

    it('목 출처는 이동 없음 목록도 맞추지 않고 로컬 목록을 건드리지 않는다(서버는 픽스처를 쓴다)', async () => {
      const skips = skipsOf(['KIA 직관']);
      const filtered = createFilteredEventsStore();
      const sync = createSync({
        source: { kind: 'mock', list: async () => [], listEvents: async () => [kia] },
        exceptions: createTravelExceptions(memory()),
        skips,
        filtered,
        send: jest.fn(),
        log: jest.fn(),
      });
      expect(await sync.run()).toBe('mock');
      expect(skips.sync).not.toHaveBeenCalled();
      expect(filtered.get()).toEqual([]);
    });

    it('기본 skips는 아무 이름도 기억하지 않는다(기존 동작 그대로)', async () => {
      const send = jest.fn().mockResolvedValue({});
      const sync = createSync({
        source: { kind: 'device', list: async () => [], listEvents: async () => [kia, lunch] },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        exceptions: createTravelExceptions(memory()),
        filtered: createFilteredEventsStore(),
        timeoutMs: 1000,
        log: jest.fn(),
      });
      expect(await sync.run()).toBe('sent');
      expect(send.mock.calls[0][0]).toEqual([wire(kia), wire(lunch)]);
    });
  });

  describe('연락 상대(contacts)', () => {
    const memory = () => {
      const data = new Map<string, string>();
      return { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => void data.set(k, v) };
    };
    const dinner = { ...event('dinner'), title: '민수랑 저녁', locationText: '광주 상무', attendees: ['박서연'], attendeeEmails: ['seoyeon@example.com'] };
    const zoom = { ...event('zoom'), title: '민수 주간 회의', locationText: 'Zoom' }; // 온라인 → 걸러진다
    const trip = { ...event('trip'), title: '민수 제주 출장', allDay: true, locationText: null };
    const build = (events: DeviceEvent[], contacts: { prepare: () => Promise<((e: DeviceEvent) => string[]) | null> }) => {
      const send = jest.fn().mockResolvedValue({});
      const sync = createEventSync({
        source: { kind: 'device', list: async () => [], listEvents: jest.fn().mockResolvedValue(events) },
        fetchSelection: jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' }),
        send,
        fetchReceivedAt: jest.fn().mockResolvedValue('2026-11-11T00:00:00.000Z'),
        exceptions: createTravelExceptions(memory()),
        filtered: createFilteredEventsStore(),
        contacts,
        timeoutMs: 1000,
        now: () => new Date(1_000_000),
        log: jest.fn(),
      });
      return { sync, send };
    };
    const finderOf = (lookup: ((e: DeviceEvent) => string[]) | null) => ({ prepare: jest.fn().mockResolvedValue(lookup) });

    it('찾은 연락 상대의 표시 이름을 일정마다 싣는다', async () => {
      const lookup = jest.fn((e: DeviceEvent) => (e.id === 'dinner' ? ['김민수'] : []));
      const { sync, send } = build([dinner, event('plain')], finderOf(lookup));
      expect(await sync.run()).toBe('sent');
      expect(send.mock.calls[0][0].map((e: WireEvent) => [e.id, e.contacts])).toEqual([['dinner', ['김민수']], ['plain', []]]);
    });

    it('참석자 이름·이메일은 서버로 보내지 않는다(연락 상대 표시 이름만)', async () => {
      const { sync, send } = build([dinner], finderOf((e) => (e.attendees.length > 0 ? ['박서연'] : [])));
      await sync.run();
      const body = send.mock.calls[0][0] as WireEvent[];
      expect(body[0]).not.toHaveProperty('attendees');
      expect(body[0]).not.toHaveProperty('attendeeEmails');
      expect(JSON.stringify(body)).not.toContain('seoyeon@example.com');
      expect(body[0]!.contacts).toEqual(['박서연']);
    });

    it('찾기가 꺼져 있으면(늦을 때 연락 꺼짐·연락처 권한 없음 → null) 모든 일정의 contacts가 빈 목록이다', async () => {
      const { sync, send } = build([dinner], finderOf(null));
      await sync.run();
      expect(send.mock.calls[0][0][0].contacts).toEqual([]);
    });

    it('걸러진 일정(온라인·건물 안)은 찾지 않는다: 보내지 않고 찾기에도 넘기지 않는다', async () => {
      const lookup = jest.fn((_e: DeviceEvent) => ['김민수']);
      const { sync, send } = build([dinner, zoom], finderOf(lookup));
      await sync.run();
      expect(send.mock.calls[0][0].map((e: WireEvent) => e.id)).toEqual(['dinner']);
      expect(lookup.mock.calls.map(([e]) => e.id)).toEqual(['dinner']);
    });

    it('종일 일정은 이동 일정이 아니라서 상대를 싣지 않는다(실제 찾기는 종일에 빈 목록을 준다)', async () => {
      const finder = createContactFinder({
        source: makeContacts('granted', 'granted', [{ id: '1', name: '김민수', emails: [], phones: ['010-1111-2222'] }]),
        fetchLateContact: async () => true,
        log: () => undefined,
      });
      const { sync, send } = build([dinner, trip], finder);
      await sync.run();
      expect(send.mock.calls[0][0].map((e: WireEvent) => [e.id, e.contacts])).toEqual([['dinner', ['김민수']], ['trip', []]]);
    });

    it('실제 찾기: 늦을 때 연락이 꺼져 있으면 연락처를 읽지 않고 contacts는 빈 목록이다', async () => {
      const source = makeContacts('granted', 'granted', [{ id: '1', name: '김민수', emails: [], phones: ['010-1111-2222'] }]);
      const finder = createContactFinder({ source, fetchLateContact: async () => false, log: () => undefined });
      const { sync, send } = build([dinner], finder);
      await sync.run();
      expect(send.mock.calls[0][0][0].contacts).toEqual([]);
      expect(source.list).not.toHaveBeenCalled();
    });

    it('실제 찾기: 연락처 권한이 없으면 contacts는 빈 목록이고 연락처를 읽지 않는다', async () => {
      const source = makeContacts('denied', 'denied', [{ id: '1', name: '김민수', emails: [], phones: ['010-1111-2222'] }]);
      const finder = createContactFinder({ source, fetchLateContact: async () => true, log: () => undefined });
      const { sync, send } = build([dinner], finder);
      await sync.run();
      expect(send.mock.calls[0][0][0].contacts).toEqual([]);
      expect(source.list).not.toHaveBeenCalled();
    });

    it('같은 내용 판단 키에 들어간다: 연락 상대가 바뀌면 다시 보내고, 같으면 보내지 않는다', async () => {
      let names = ['김민수'];
      const { sync, send } = build([dinner], { prepare: async () => () => names });
      expect(await sync.run()).toBe('sent');
      expect(await sync.run()).toBe('unchanged');
      names = ['김민수', '이민수'];
      expect(await sync.run()).toBe('sent');
      names = [];
      expect(await sync.run()).toBe('sent'); // 기능을 끄거나 권한을 잃으면 이전에 보낸 이름이 지워진다
      expect(send.mock.calls.map((c) => (c[0] as WireEvent[])[0]!.contacts)).toEqual([['김민수'], ['김민수', '이민수'], []]);
    });

    it('찾기가 던지거나 멈춰도 일정은 연락 상대 없이 보낸다', async () => {
      const throwing = build([dinner], { prepare: async () => { throw new Error('native'); } });
      expect(await throwing.sync.run()).toBe('sent');
      expect(throwing.send.mock.calls[0][0][0].contacts).toEqual([]);
      jest.useFakeTimers();
      const hanging = build([dinner], { prepare: () => new Promise(() => {}) });
      const result = hanging.sync.run();
      await jest.advanceTimersByTimeAsync(1001);
      expect(await result).toBe('sent');
      expect(hanging.send.mock.calls[0][0][0].contacts).toEqual([]);
    });
  });
});
