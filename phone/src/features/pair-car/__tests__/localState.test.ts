import { createSession } from '../../../api/session';
import { createEventSync } from '../../calendar-sync/eventSync';
import type { CalendarSource, DeviceEvent } from '../../calendar-select/calendarSource';
import { createFilteredEventsStore } from '../../calendar-sync/filteredEvents';
import { createInbox } from '../../notifications/inbox';
import { createMemoryStore } from '../../../storage/keyValueStore';
import { bindLocalCarStateToSession, clearLocalCarState, quiesceLocalCarState, type LocalCarState } from '../localState';

const fakeState = () => {
  const calls: string[] = [];
  const state: LocalCarState = {
    clearInbox: jest.fn(() => void calls.push('inbox')),
    stopPolling: jest.fn(() => void calls.push('poll')),
    resetEventSync: jest.fn(() => void calls.push('sync')),
    clearFilteredEvents: jest.fn(() => void calls.push('filtered')),
    resetSkips: jest.fn(() => void calls.push('skips')),
    clearCorrectedPlaces: jest.fn(() => void calls.push('corrected')),
    holdEventSync: jest.fn(() => (calls.push('hold'), () => void calls.push('release'))),
  };
  return { state, calls };
};

describe('clearLocalCarState', () => {
  it('폴링을 먼저 멈춘 뒤 알림함·일정 보내기 기억·거른 일정 목록·이동 없음 기억·보정된 일정 목록을 비운다', () => {
    const { state, calls } = fakeState();
    clearLocalCarState(state);
    expect(calls).toEqual(['poll', 'inbox', 'sync', 'filtered', 'skips', 'corrected']);
  });

  it('한 단계가 던져도 나머지는 비운다', () => {
    const { state, calls } = fakeState();
    (state.clearInbox as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => clearLocalCarState(state)).not.toThrow();
    expect(calls).toEqual(['poll', 'sync', 'filtered', 'skips', 'corrected']);
  });

  it('여러 번 불러도 안전하다', () => {
    const { state } = fakeState();
    clearLocalCarState(state);
    clearLocalCarState(state);
    expect(state.clearInbox).toHaveBeenCalledTimes(2);
  });

  it('실제 알림함·일정 보내기·거른 일정 저장소를 비운다', async () => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await inbox.add([{ id: '5', kind: 'events-stale', title: 't', body: 'b', data: {}, createdAt: '2026-11-14T11:00:00.000Z' }]);
    expect(inbox.getState().items).toHaveLength(1);
    const filtered = createFilteredEventsStore();
    filtered.set([{ id: 'x', title: '회의', start: 'a', end: 'b', reason: 'online' } as never]);
    const sync = createEventSync({
      contacts: { prepare: async () => null },
      source: { kind: 'device', list: async () => [], listEvents: async () => [] } as CalendarSource,
      fetchSelection: jest.fn().mockResolvedValue({ selectedIds: null, source: null }),
      send: jest.fn().mockResolvedValue({}),
      saveSelection: jest.fn().mockResolvedValue({}),
      log: jest.fn(),
    });
    sync.rememberSelection(['1']);
    await sync.run(); // 서버가 선택을 잃었다 → 기억한 선택을 다시 저장하고 보낸다
    expect(sync.lastResult()).toBe('sent');

    clearLocalCarState({
      clearInbox: () => inbox.clear(),
      stopPolling: () => undefined,
      resetEventSync: () => sync.reset(),
      clearFilteredEvents: () => filtered.set([]),
      resetSkips: () => undefined,
      clearCorrectedPlaces: () => undefined,
      holdEventSync: () => sync.hold(),
    });

    expect(inbox.getState()).toMatchObject({ items: [], lastId: null });
    expect(filtered.get()).toEqual([]);
    expect(sync.lastResult()).toBeNull();
  });
});

describe('quiesceLocalCarState (서버에서 자리를 지우기 전)', () => {
  it('폴링을 멈추고 일정 보내기를 붙잡은 채 기억을 잊고, 해제 함수를 돌려준다', () => {
    const { state, calls } = fakeState();
    const release = quiesceLocalCarState(state);
    expect(calls).toEqual(['poll', 'hold', 'sync']);
    release();
    expect(calls).toEqual(['poll', 'hold', 'sync', 'release']);
  });

  it('한 단계가 던져도 나머지는 하고, 해제 함수는 항상 안전하게 부를 수 있다', () => {
    const { state, calls } = fakeState();
    (state.stopPolling as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    const release = quiesceLocalCarState(state);
    expect(calls).toEqual(['hold', 'sync']);
    expect(() => release()).not.toThrow();
    (state.holdEventSync as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => quiesceLocalCarState(state)()).not.toThrow();
  });
});

describe('bindLocalCarStateToSession (401로 토큰이 버려지는 경로도 같은 범위를 비운다)', () => {
  it('토큰이 지워질 때마다 clearLocalCarState와 같은 단계를 부르고, 해제하면 부르지 않는다', () => {
    const { state, calls } = fakeState();
    let cleared: () => void = () => undefined;
    const off = jest.fn();
    const unbind = bindLocalCarStateToSession({ onTokenCleared: (l) => ((cleared = l), off) }, state);
    cleared();
    expect(calls).toEqual(['poll', 'inbox', 'sync', 'filtered', 'skips', 'corrected']); // 직접 끊기(clearLocalCarState)와 같은 범위
    unbind();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('실제 세션: 서버 401로 토큰을 버리는 경로(clearIfCurrent)에서도 비운다', async () => {
    const storage = { read: async () => 'tok', write: async () => undefined, remove: async () => undefined };
    const session = createSession(storage, { read: async () => null, write: async () => undefined }, () => 'x'.repeat(32));
    const { state, calls } = fakeState();
    bindLocalCarStateToSession(session, state);
    await session.clearIfCurrent('tok');
    expect(calls).toEqual(['poll', 'inbox', 'sync', 'filtered', 'skips', 'corrected']);
  });
});

describe('EventSync.reset', () => {
  const event = (): DeviceEvent => ({
    id: 'a', calendarId: '1', title: '회의', start: '2026-11-11T05:00:00.000Z', end: '2026-11-11T06:00:00.000Z',
    allDay: false, locationText: null, notes: null, attendees: [],
  });
  const make = () => {
    const fetchSelection = jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' });
    const send = jest.fn().mockResolvedValue({});
    const saveSelection = jest.fn().mockResolvedValue({});
    const sync = createEventSync({
      contacts: { prepare: async () => null },
      source: { kind: 'device', list: async () => [], listEvents: async () => [event()] } as CalendarSource,
      fetchSelection, send, saveSelection, fetchReceivedAt: jest.fn().mockResolvedValue('2026-11-11T00:00:00.000Z'), log: jest.fn(),
      now: () => new Date(1_000_000),
    });
    return { sync, fetchSelection, send, saveSelection };
  };

  it('직전에 보낸 내용을 잊어 같은 내용도 다시 보낸다(다른 자리에는 아직 안 보냈으므로)', async () => {
    const { sync, send } = make();
    expect(await sync.run()).toBe('sent');
    expect(await sync.run()).toBe('unchanged');
    sync.reset();
    expect(await sync.run()).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('기억해 둔 캘린더 선택을 잊어 새 자리에 옛 선택을 다시 저장하지 않는다', async () => {
    const { sync, fetchSelection, saveSelection } = make();
    sync.rememberSelection(['7']);
    sync.reset();
    fetchSelection.mockResolvedValue({ selectedIds: null, source: null }); // 새 자리는 선택이 없다
    expect(await sync.run()).toBe('no-selection');
    expect(saveSelection).not.toHaveBeenCalled();
  });

  it('진행 중인 보내기를 취소한다', async () => {
    const { sync, fetchSelection, send } = make();
    let release!: (v: unknown) => void;
    fetchSelection.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const running = sync.run();
    sync.reset();
    release({ selectedIds: ['1'], source: 'device' });
    expect(await running).toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
  });

  it('reset 뒤에 취소돼 끝나는 옛 실행이 마지막 결과를 다시 남기지 않는다(lastResult는 null 유지)', async () => {
    const { sync, fetchSelection } = make();
    expect(await sync.run()).toBe('sent');
    expect(sync.lastResult()).toBe('sent');
    let release!: (v: unknown) => void;
    fetchSelection.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const running = sync.run();
    sync.reset();
    expect(sync.lastResult()).toBeNull();
    release({ selectedIds: ['1'], source: 'device' });
    expect(await running).toBe('cancelled');
    expect(sync.lastResult()).toBeNull(); // reset 직후 상태가 유지된다
    fetchSelection.mockResolvedValue({ selectedIds: ['1'], source: 'device' });
    expect(await sync.run()).toBe('sent'); // 새 실행의 결과는 정상적으로 남는다
    expect(sync.lastResult()).toBe('sent');
  });
});

describe('EventSync.hold', () => {
  const event = (): DeviceEvent => ({
    id: 'a', calendarId: '1', title: '회의', start: '2026-11-11T05:00:00.000Z', end: '2026-11-11T06:00:00.000Z',
    allDay: false, locationText: null, notes: null, attendees: [],
  });
  const make = () => {
    const fetchSelection = jest.fn().mockResolvedValue({ selectedIds: ['1'], source: 'device' });
    const send = jest.fn().mockResolvedValue({});
    const sync = createEventSync({
      contacts: { prepare: async () => null },
      source: { kind: 'device', list: async () => [], listEvents: async () => [event()] } as CalendarSource,
      fetchSelection, send, saveSelection: jest.fn(), fetchReceivedAt: jest.fn().mockResolvedValue(null), log: jest.fn(), now: () => new Date(1_000_000),
    });
    return { sync, fetchSelection, send };
  };

  it('붙잡는 동안 run은 아무것도 읽거나 보내지 않고 cancelled로 끝나고, 풀면 다시 보낸다', async () => {
    const { sync, fetchSelection, send } = make();
    const release = sync.hold();
    expect(await sync.run()).toBe('cancelled');
    expect(fetchSelection).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    release();
    release(); // 두 번 풀어도 안전하다
    expect(await sync.run()).toBe('sent');
  });

  it('붙잡는 순간 진행 중인 보내기를 취소하고(전송으로 이어지지 않음), 여러 번 붙잡으면 모두 풀려야 돈다', async () => {
    const { sync, fetchSelection, send } = make();
    let resolve!: (v: unknown) => void;
    fetchSelection.mockReturnValue(new Promise((r) => (resolve = r)));
    const running = sync.run();
    const a = sync.hold();
    const b = sync.hold();
    resolve({ selectedIds: ['1'], source: 'device' });
    expect(await running).toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
    fetchSelection.mockResolvedValue({ selectedIds: ['1'], source: 'device' });
    a();
    expect(await sync.run()).toBe('cancelled'); // 아직 하나가 남아 있다
    b();
    expect(await sync.run()).toBe('sent');
  });
});
