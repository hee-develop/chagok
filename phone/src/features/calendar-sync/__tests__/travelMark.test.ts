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

  it('실패한 줄만 되돌린다: 그 사이 다른 줄을 바꾼 것이나 새로 읽힌 목록은 덮지 않는다', async () => {
    const { exceptions, filtered, sync } = setup(['sent']);
    let release!: (v: SyncResult) => void;
    sync.run.mockImplementationOnce(() => new Promise<SyncResult>((r) => { release = r; }));
    const a = markTravelByTitle('고객사 주간 회의', { exceptions, filtered, sync });
    await new Promise((r) => setTimeout(r, 0));
    // 다른 줄(기획 리뷰)은 성공적으로 바꿨다.
    expect(await markTravelByTitle('기획 리뷰', { exceptions, filtered, sync })).toBe('ok');
    expect(filtered.get()).toEqual([]);
    release('failed');
    expect(await a).toBe('failed');
    // 실패한 두 줄(같은 이름)만 돌아오고 성공한 '기획 리뷰'는 그대로 빠져 있다.
    expect(filtered.get().map((e) => e.id)).toEqual(['a@1', 'a@2']);
    expect(exceptions.has('기획 리뷰')).toBe(true);
    expect(exceptions.has('고객사 주간 회의')).toBe(false);
  });

  it('실패 중에 목록이 새로 읽혀도 이미 있는 줄은 그대로 두고 뺐던 줄만 넣는다', async () => {
    const { exceptions, filtered, sync } = setup([]);
    sync.run.mockImplementationOnce(async () => {
      filtered.set([item('c@1', '새로 읽힌 일정'), item('b@1', '기획 리뷰')]);
      return 'failed';
    });
    expect(await markTravelByTitle('고객사 주간 회의', { exceptions, filtered, sync })).toBe('failed');
    expect(filtered.get().map((e) => e.id).sort()).toEqual(['a@1', 'a@2', 'b@1', 'c@1']);
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

describe('예외 목록을 읽지 못한 동안의 되돌리기', () => {
  it('원래 저장돼 있던 예외를 지우지 않는다', async () => {
    const data = new Map<string, string>([[STORAGE_KEY, JSON.stringify(['기획 리뷰', '다른 예외'])]]);
    let failReads = true;
    const storage: KeyValueStorage = {
      getItem: async (k) => {
        if (failReads) throw new Error('read failed');
        return data.get(k) ?? null;
      },
      setItem: async (k, v) => void data.set(k, v),
    };
    const exceptions = createTravelExceptions(storage);
    const filtered = createFilteredEventsStore();
    filtered.set([item('b@1', '기획 리뷰')]);
    const sync = { run: jest.fn().mockResolvedValue('failed') };
    expect(await markTravelByTitle('기획 리뷰', { exceptions, filtered, sync })).toBe('failed');
    expect(filtered.get().map((e) => e.id)).toEqual(['b@1']);
    // 저장소는 아직 읽지 못했으므로 쓰지 않았다. 읽을 수 있게 된 뒤에도 원래 이름이 남아 있다.
    failReads = false;
    const loaded = await exceptions.load();
    expect([...loaded].sort()).toEqual(['기획 리뷰', '다른 예외']);
    expect(JSON.parse(data.get(STORAGE_KEY)!).sort()).toEqual(['기획 리뷰', '다른 예외']);
  });

  it('읽기가 성공했고 원래 예외였다면 실패해도 예외를 그대로 둔다', async () => {
    const { exceptions, filtered, sync } = setup(['failed']);
    await exceptions.add('기획 리뷰');
    expect(await markTravelByTitle('기획 리뷰', { exceptions, filtered, sync })).toBe('failed');
    expect(exceptions.has('기획 리뷰')).toBe(true);
  });
});
