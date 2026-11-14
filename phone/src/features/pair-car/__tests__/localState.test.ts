import { createEventSync } from '../../calendar-sync/eventSync';
import type { CalendarSource, DeviceEvent } from '../../calendar-select/calendarSource';
import { createFilteredEventsStore } from '../../calendar-sync/filteredEvents';
import { createInbox } from '../../notifications/inbox';
import { createMemoryStorage } from '../../notifications/keyValue';
import { clearLocalCarState, type LocalCarState } from '../localState';

const fakeState = () => {
  const calls: string[] = [];
  const state: LocalCarState = {
    clearInbox: jest.fn(() => void calls.push('inbox')),
    stopPolling: jest.fn(() => void calls.push('poll')),
    resetEventSync: jest.fn(() => void calls.push('sync')),
    clearFilteredEvents: jest.fn(() => void calls.push('filtered')),
  };
  return { state, calls };
};

describe('clearLocalCarState', () => {
  it('폴링을 먼저 멈춘 뒤 알림함·일정 보내기 기억·거른 일정 목록을 비운다', () => {
    const { state, calls } = fakeState();
    clearLocalCarState(state);
    expect(calls).toEqual(['poll', 'inbox', 'sync', 'filtered']);
  });

  it('한 단계가 던져도 나머지는 비운다', () => {
    const { state, calls } = fakeState();
    (state.clearInbox as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => clearLocalCarState(state)).not.toThrow();
    expect(calls).toEqual(['poll', 'sync', 'filtered']);
  });

  it('여러 번 불러도 안전하다', () => {
    const { state } = fakeState();
    clearLocalCarState(state);
    clearLocalCarState(state);
    expect(state.clearInbox).toHaveBeenCalledTimes(2);
  });

  it('실제 알림함·일정 보내기·거른 일정 저장소를 비운다', async () => {
    const inbox = createInbox({ storage: createMemoryStorage() });
    await inbox.add([{ id: '5', kind: 'events-stale', title: 't', body: 'b', data: {}, createdAt: '2026-11-14T11:00:00.000Z' }]);
    expect(inbox.getState().items).toHaveLength(1);
    const filtered = createFilteredEventsStore();
    filtered.set([{ id: 'x', title: '회의', start: 'a', end: 'b', reason: 'online' } as never]);
    const sync = createEventSync({
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
    });

    expect(inbox.getState()).toMatchObject({ items: [], lastId: null });
    expect(filtered.get()).toEqual([]);
    expect(sync.lastResult()).toBeNull();
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
});
