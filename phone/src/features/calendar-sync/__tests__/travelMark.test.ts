import type { SyncResult } from '../eventSync';
import { createFilteredEventsStore, type FilteredEvent } from '../filteredEvents';
import { markTravelByTitle, undoMarkTravel } from '../travelMark';
import { createTravelExceptions, STORAGE_KEY, type KeyValueStorage } from '../travelExceptions';

const memory = () => {
  const data = new Map<string, string>();
  const storage: KeyValueStorage = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
  return { storage, data };
};
const item = (id: string, title: string): FilteredEvent => ({ id, title, start: '2026-11-06T02:00:00Z', end: '2026-11-06T03:00:00Z', reason: 'online' });

const setup = (results: (SyncResult | Error)[]) => {
  const { storage, data } = memory();
  const exceptions = createTravelExceptions(storage);
  const filtered = createFilteredEventsStore();
  const seen: unknown[] = [];
  exceptions.subscribe((c) => seen.push(c));
  const queue = [...results];
  const sync = {
    run: jest.fn(async () => {
      const next = queue.shift() ?? 'sent';
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  filtered.set([item('a@1', '고객사  주간 회의'), item('a@2', '고객사 주간 회의'), item('b@1', '기획 리뷰')]);
  return { exceptions, filtered, sync, seen, data };
};

describe('markTravelByTitle', () => {
  it('같은 이름을 예외로 기억하고 거른 목록에서 빼고 곧바로 다시 읽어 보낸다', async () => {
    const { exceptions, filtered, sync, seen, data } = setup(['sent']);
    expect(await markTravelByTitle('고객사 주간 회의', { exceptions, filtered, sync })).toBe('ok');
    expect(exceptions.has('고객사 주간 회의')).toBe(true);
    expect(filtered.get().map((e) => e.id)).toEqual(['b@1']);
    expect(sync.run).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ name: '고객사 주간 회의', travel: true }]);
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual(['고객사 주간 회의']);
  });

  it.each<SyncResult>(['unchanged', 'mock'])('결과가 %s이면 반영된 것으로 본다', async (result) => {
    const { exceptions, filtered, sync } = setup([result]);
    expect(await markTravelByTitle('기획 리뷰', { exceptions, filtered, sync })).toBe('ok');
  });

  it.each<SyncResult>(['failed', 'permission-denied', 'no-selection', 'cancelled'])('결과가 %s이면 예외 저장과 거른 목록을 되돌려 그 줄이 사라지지 않게 한다', async (result) => {
    const { exceptions, filtered, sync, seen, data } = setup([result]);
    const before = filtered.get();
    expect(await markTravelByTitle('고객사 주간 회의', { exceptions, filtered, sync })).toBe('failed');
    expect(exceptions.has('고객사 주간 회의')).toBe(false);
    expect(filtered.get()).toEqual(before);
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual([]);
    expect(seen).toEqual([{ name: '고객사 주간 회의', travel: true }, { name: '고객사 주간 회의', travel: false }]);
  });

  it('다시 읽기가 예외로 끝나도 되돌린다', async () => {
    const { exceptions, filtered, sync } = setup([new Error('boom')]);
    const before = filtered.get();
    expect(await markTravelByTitle('기획 리뷰', { exceptions, filtered, sync })).toBe('failed');
    expect(exceptions.has('기획 리뷰')).toBe(false);
    expect(filtered.get()).toEqual(before);
  });
});

describe('undoMarkTravel', () => {
  it('예외를 지우고 다시 읽어 보낸다(서버에서 그 일정이 빠진다)', async () => {
    const { exceptions, filtered, sync, seen } = setup(['sent', 'sent']);
    await markTravelByTitle('기획 리뷰', { exceptions, filtered, sync });
    expect(await undoMarkTravel('기획 리뷰', { exceptions, sync })).toBe('ok');
    expect(exceptions.has('기획 리뷰')).toBe(false);
    expect(sync.run).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([{ name: '기획 리뷰', travel: true }, { name: '기획 리뷰', travel: false }]);
  });

  it('보내지 못해도 예외는 지운 채 failed로 알린다(다음 주기 읽기가 다시 보낸다)', async () => {
    const { exceptions, filtered, sync } = setup(['sent', 'failed']);
    await markTravelByTitle('기획 리뷰', { exceptions, filtered, sync });
    expect(await undoMarkTravel('기획 리뷰', { exceptions, sync })).toBe('failed');
    expect(exceptions.has('기획 리뷰')).toBe(false);
  });
});
