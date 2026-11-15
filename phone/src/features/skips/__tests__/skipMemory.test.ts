import { HttpError } from '../../../api/request';
import { createTravelExceptions, type KeyValueStorage } from '../../calendar-sync/travelExceptions';
import { createSkipMemory, SKIPS_STORAGE_KEY } from '../skipMemory';
import type { SkipChange, SkipEntry, SkipsApi } from '../skipsApi';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: jest.fn(async (k: string) => data.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void data.set(k, v)),
  };
  return { storage, data };
};

const norm = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** 서버처럼 동작하는 SkipsApi: 이름을 더하고 빼며 바뀐 전체 목록(최근 먼저)을 돌려준다. */
const fakeServer = (initial: string[] = []) => {
  let list: SkipEntry[] = initial.map((name) => ({ name, addedAt: '2026-11-11T01:00:00.000Z' })).reverse();
  const calls: SkipChange[] = [];
  const state = { down: false, rejectWith: null as number | null, fetches: 0 };
  const api: SkipsApi = {
    fetch: jest.fn(async () => {
      state.fetches += 1;
      if (state.down) throw new Error('network');
      return list;
    }),
    change: jest.fn(async (change) => {
      if (state.down) throw new Error('network');
      if (state.rejectWith !== null) throw new HttpError(state.rejectWith, `PUT /skips ${state.rejectWith}`);
      calls.push(change);
      const remove = new Set((change.remove ?? []).map(norm));
      list = list.filter((e) => !remove.has(norm(e.name)));
      for (const name of change.add ?? []) if (!list.some((e) => norm(e.name) === norm(name))) list = [{ name, addedAt: '2026-11-11T02:00:00.000Z' }, ...list];
      return list;
    }),
  };
  return { api, calls, state, names: () => list.map((e) => e.name), seed: (name: string) => (list = [{ name, addedAt: '2026-11-11T03:00:00.000Z' }, ...list]) };
};

const setup = (initial: string[] = [], stored: Record<string, string> = {}) => {
  const server = fakeServer(initial);
  const { storage, data } = memoryStorage(stored);
  const exceptionsStorage = memoryStorage();
  const exceptions = createTravelExceptions(exceptionsStorage.storage);
  const log = jest.fn();
  const memory = createSkipMemory({ api: server.api, storage, exceptions, timeoutMs: 1000, loadTimeoutMs: 100, log });
  return { memory, server, storage, data, exceptions, log };
};
const names = (m: { list(): readonly { name: string }[] }) => m.list().map((i) => i.name);

describe('skipMemory', () => {
  it('서버 목록을 받아 캐시하고 이름 비교는 공백·대소문자를 무시한다', async () => {
    const { memory, data } = setup(['KIA 직관', '치과']);
    expect(memory.has('치과')).toBe(false); // 받기 전
    expect(await memory.sync()).toEqual({ refreshed: true, pendingFailed: false, full: false });
    expect(names(memory)).toEqual(['치과', 'KIA 직관']);
    expect(memory.has('  kia   직관 ')).toBe(true);
    expect(memory.has('KIA')).toBe(false);
    expect(JSON.parse(data.get(SKIPS_STORAGE_KEY)!).names).toHaveLength(2);
  });

  it('오프라인이면 저장해 둔 캐시를 쓰고, 받기에 실패해도 던지지 않는다', async () => {
    const first = setup(['치과']);
    await first.memory.sync();
    const second = setup([], { [SKIPS_STORAGE_KEY]: first.data.get(SKIPS_STORAGE_KEY)! });
    second.server.state.down = true;
    expect(await second.memory.sync()).toEqual({ refreshed: false, pendingFailed: false, full: false });
    expect(second.memory.has('치과')).toBe(true);
    expect(second.log).toHaveBeenCalledWith(expect.stringContaining('저장해 둔 목록'));
  });

  it('이름을 더하면 바로 목록에 보이고, 서버에는 다음 sync에서 한 번에 올린다(응답이 새 목록이라 따로 받지 않는다)', async () => {
    const { memory, server } = setup(['치과']);
    await memory.sync();
    await memory.add(' KIA  직관 ');
    expect(memory.has('kia 직관')).toBe(true);
    expect(memory.list()[0]).toEqual({ name: 'KIA 직관', addedAt: null });
    expect(server.calls).toEqual([]);
    expect(memory.hasPending()).toBe(true);
    const fetchesBefore = server.state.fetches;
    expect(await memory.sync()).toEqual({ refreshed: true, pendingFailed: false, full: false });
    expect(server.calls).toEqual([{ add: ['KIA 직관'] }]);
    expect(server.state.fetches).toBe(fetchesBefore);
    expect(memory.hasPending()).toBe(false);
    expect(memory.list()[0]?.addedAt).not.toBeNull();
  });

  it('지우기도 같다. 서버에 있는 이름을 지우면 다음 sync에서 서버 목록에서 빠진다', async () => {
    const { memory, server } = setup(['치과', 'KIA 직관']);
    await memory.sync();
    await memory.remove('kia 직관');
    expect(memory.has('KIA 직관')).toBe(false);
    expect(names(memory)).toEqual(['치과']);
    await memory.sync();
    expect(server.calls).toEqual([{ remove: ['kia 직관'] }]);
    expect(server.names()).toEqual(['치과']);
  });

  it('서버에서 새로 받은 목록이 방금 한 선택을 되돌리지 않는다(올리지 못한 변경이 남는 동안)', async () => {
    const { memory, server } = setup(['치과']);
    await memory.sync();
    server.state.down = true;
    await memory.remove('치과');
    await memory.add('콩물 픽업');
    expect(await memory.sync()).toEqual({ refreshed: false, pendingFailed: true, full: false });
    expect(names(memory)).toEqual(['콩물 픽업']);
    server.state.down = false;
    server.seed('차에서 더한 일정'); // 그 사이 차가 더한 이름은 그대로 들어온다
    expect(await memory.sync()).toEqual({ refreshed: true, pendingFailed: false, full: false });
    expect(names(memory)).toEqual(['콩물 픽업', '차에서 더한 일정']);
    expect(server.names()).toEqual(['콩물 픽업', '차에서 더한 일정']);
  });

  it('올리지 못한 변경은 저장소에 남아 앱을 다시 켜도 다시 올린다', async () => {
    const first = setup([]);
    first.server.state.down = true;
    await first.memory.add('치과');
    expect((await first.memory.sync()).pendingFailed).toBe(true);
    const second = setup([], { [SKIPS_STORAGE_KEY]: first.data.get(SKIPS_STORAGE_KEY)! });
    await second.memory.load();
    expect(second.memory.has('치과')).toBe(true);
    expect(await second.memory.sync()).toEqual({ refreshed: true, pendingFailed: false, full: false });
    expect(second.server.names()).toEqual(['치과']);
  });

  it('4xx로 거절된 변경(잘못된 이름·옛 서버)은 다시 보내지 않고 버린다', async () => {
    const { memory, server, log } = setup([]);
    server.state.rejectWith = 400;
    await memory.add('치과');
    expect(await memory.sync()).toEqual({ refreshed: true, pendingFailed: false, full: false }); // 목록은 GET으로 받는다
    expect(memory.hasPending()).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('거절'));
  });

  it.each([401, 408, 429, 503])('HTTP %i는 버리지 않고 다시 올릴 변경으로 남긴다', async (status) => {
    const { memory, server } = setup([]);
    server.state.rejectWith = status;
    await memory.add('치과');
    expect(await memory.sync()).toEqual({ refreshed: false, pendingFailed: true, full: false });
    expect(memory.hasPending()).toBe(true);
    expect(memory.has('치과')).toBe(true);
    server.state.rejectWith = null;
    expect(await memory.sync()).toMatchObject({ pendingFailed: false });
    expect(server.names()).toEqual(['치과']);
  });

  it('409(기억이 가득 참)는 더하기를 버리고 full로 알리며 사용자가 확인하면 내려간다', async () => {
    const { memory, server } = setup([]);
    const listener = jest.fn();
    memory.subscribe(listener);
    server.state.rejectWith = 409;
    await memory.add('치과');
    expect(memory.full()).toBe(false);
    expect(await memory.sync()).toEqual({ refreshed: true, pendingFailed: false, full: true });
    expect(memory.full()).toBe(true);
    expect(memory.hasPending()).toBe(false);
    expect(memory.has('치과')).toBe(false); // 기억하지 못했다
    expect(listener).toHaveBeenCalled();
    memory.dismissFull();
    expect(memory.full()).toBe(false);
  });

  it('상한에 걸린 묶음의 지우기는 따로 다시 올린다(더하기만 버린다)', async () => {
    const { memory, server } = setup(['옛 이름']);
    await memory.sync();
    // 서버가 더하기가 들어 있는 요청만 409로 거절한다.
    const change = server.api.change as jest.Mock;
    const original = change.getMockImplementation()!;
    change.mockImplementation(async (c: SkipChange) => {
      if ((c.add ?? []).length > 0) throw new HttpError(409, 'full');
      return original(c);
    });
    await memory.remove('옛 이름');
    await memory.add('새 이름');
    const result = await memory.sync();
    expect(result).toMatchObject({ full: true, pendingFailed: false });
    expect(server.names()).toEqual([]); // 지우기는 올라갔다
    expect(memory.has('옛 이름')).toBe(false);
    expect(memory.has('새 이름')).toBe(false);
    expect(memory.hasPending()).toBe(false);
  });

  it('상한 안내는 다음에 거절 없이 올리면 저절로 내려간다', async () => {
    const { memory, server } = setup([]);
    server.state.rejectWith = 409;
    await memory.add('치과');
    await memory.sync();
    expect(memory.full()).toBe(true);
    server.state.rejectWith = null;
    await memory.add('콩물 픽업');
    await memory.sync();
    expect(memory.full()).toBe(false);
  });

  it('올리는 중에 다시 바꾼 이름도 그 동기화가 끝나기 전에 한 번 더 올린다(합류한 호출이 성공으로 오해하지 않는다)', async () => {
    const { memory, server } = setup([]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const change = server.api.change as jest.Mock;
    const original = change.getMockImplementation()!;
    change.mockImplementationOnce(async (c: SkipChange) => {
      await gate;
      return original(c);
    });
    await memory.add('치과');
    const running = memory.sync();
    await Promise.resolve();
    await memory.remove('치과'); // 올리는 사이 사용자가 마음을 바꿈
    release();
    const result = await running;
    expect(result).toMatchObject({ refreshed: true, pendingFailed: false });
    expect(memory.has('치과')).toBe(false);
    expect(memory.hasPending()).toBe(false);
    expect(server.names()).toEqual([]);
    expect(server.calls).toEqual([{ add: ['치과'] }, { remove: ['치과'] }]);
  });

  it('맞추는 동안 계속 바뀌어 다 올리지 못하면 성공으로 알리지 않는다(pendingFailed)', async () => {
    const { memory, server } = setup([]);
    const change = server.api.change as jest.Mock;
    const original = change.getMockImplementation()!;
    let n = 0;
    change.mockImplementation(async (c: SkipChange) => {
      const result = await original(c);
      n += 1;
      await memory.add(`다음 ${n}`); // 올릴 때마다 사용자가 또 바꿈
      return result;
    });
    await memory.add('치과');
    const result = await memory.sync();
    expect(result.pendingFailed).toBe(true);
    expect(memory.hasPending()).toBe(true);
  });

  it('reset 뒤에 도착한 옛 동기화의 응답은 버린다', async () => {
    const { memory, server, data } = setup(['치과']);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    (server.api.fetch as jest.Mock).mockImplementationOnce(async () => {
      await gate;
      return [{ name: '치과', addedAt: '2026-11-11T01:00:00.000Z' }];
    });
    const running = memory.sync();
    await Promise.resolve();
    await Promise.resolve();
    await memory.reset(); // 연결 해제
    release();
    expect(await running).toEqual({ refreshed: false, pendingFailed: false, full: false });
    expect(memory.list()).toEqual([]);
    expect(memory.has('치과')).toBe(false);
    expect(JSON.parse(data.get(SKIPS_STORAGE_KEY)!)).toEqual({ names: [], pendingAdd: [], pendingRemove: [] });
  });

  it('reset 뒤에 도착한 올리기 응답도 버린다(목록·올린 변경 표시를 되살리지 않는다)', async () => {
    const { memory, server } = setup([]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const change = server.api.change as jest.Mock;
    const original = change.getMockImplementation()!;
    change.mockImplementationOnce(async (c: SkipChange) => {
      await gate;
      return original(c);
    });
    await memory.add('치과');
    const running = memory.sync();
    await Promise.resolve();
    await Promise.resolve();
    await memory.reset();
    release();
    await running;
    expect(memory.list()).toEqual([]);
    expect(memory.has('치과')).toBe(false);
  });

  it('removeIfPresent는 기억에 있는 이름만 지우고, 없는 이름은 아무것도 쌓지 않는다', async () => {
    const { memory, server } = setup(['치과']);
    await memory.sync();
    expect(await memory.removeIfPresent('없는 일정')).toBe(false);
    expect(memory.hasPending()).toBe(false);
    expect(await memory.removeIfPresent(' 치과 ')).toBe(true);
    expect(memory.hasPending()).toBe(true);
    await memory.sync();
    expect(server.calls).toEqual([{ remove: ['치과'] }]);
  });

  it('동시에 하나만 돈다', async () => {
    const { memory, server } = setup(['치과']);
    const [a, b] = await Promise.all([memory.sync(), memory.sync()]);
    expect(a).toBe(b);
    expect(server.state.fetches).toBe(1);
  });

  it('50개씩 나눠 올린다', async () => {
    const { memory, server } = setup([]);
    for (let i = 0; i < 120; i++) await memory.add(`일정 ${i}`);
    await memory.sync();
    expect(server.calls.map((c) => c.add?.length)).toEqual([50, 50, 20]);
    expect(server.names()).toHaveLength(120);
  });

  it('저장소를 읽지 못하면 캐시 없이 이어 가고, 읽을 수 있게 되면 합친다(저장된 변경을 덮어쓰지 않는다)', async () => {
    const stored = JSON.stringify({ names: [], pendingAdd: ['저장된 변경'], pendingRemove: [] });
    let failing = true;
    const data = new Map([[SKIPS_STORAGE_KEY, stored]]);
    const storage: KeyValueStorage = {
      getItem: async (k) => {
        if (failing) throw new Error('storage');
        return data.get(k) ?? null;
      },
      setItem: async (k, v) => void data.set(k, v),
    };
    const server = fakeServer([]);
    const memory = createSkipMemory({ api: server.api, storage, exceptions: createTravelExceptions(memoryStorage().storage), timeoutMs: 1000, loadTimeoutMs: 100, log: jest.fn() });
    await memory.add('새 변경');
    expect(data.get(SKIPS_STORAGE_KEY)).toBe(stored); // 읽기 전에는 쓰지 않는다
    failing = false;
    await memory.load();
    expect(names(memory).sort()).toEqual(['새 변경', '저장된 변경']);
    await memory.sync();
    expect(server.names().sort()).toEqual(['새 변경', '저장된 변경']);
  });

  it('reset은 캐시와 올리지 못한 변경을 모두 버린다', async () => {
    const { memory, data, server } = setup(['치과']);
    await memory.sync();
    await memory.add('콩물 픽업');
    await memory.reset();
    expect(memory.list()).toEqual([]);
    expect(memory.hasPending()).toBe(false);
    expect(JSON.parse(data.get(SKIPS_STORAGE_KEY)!)).toEqual({ names: [], pendingAdd: [], pendingRemove: [] });
    expect(server.calls).toEqual([]);
  });

  it('너무 긴 이름·빈 이름은 기억하지 않는다', async () => {
    const { memory } = setup([]);
    await memory.add('   ');
    await memory.add('가'.repeat(201));
    await memory.add('\u200b\u2060');
    expect(memory.list()).toEqual([]);
    expect(memory.hasPending()).toBe(false);
  });

  it('목록이 바뀔 때만 구독자에게 알리고 같은 내용이면 같은 배열을 돌려준다', async () => {
    const { memory } = setup(['치과']);
    const listener = jest.fn();
    memory.subscribe(listener);
    await memory.sync();
    const first = memory.list();
    expect(listener).toHaveBeenCalledTimes(1);
    await memory.sync();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(memory.list()).toBe(first);
  });
});

describe('가장 최근 선택이 이긴다 (예외 ↔ 이동 없음 기억)', () => {
  it('이동 일정이에요(예외)를 더하면 같은 이름의 기억이 지워지고 서버에 올라간다', async () => {
    const { memory, server, exceptions } = setup(['고객사 회의']);
    await memory.sync();
    expect(memory.has('고객사 회의')).toBe(true);
    await exceptions.add(' 고객사  회의 ');
    expect(memory.has('고객사 회의')).toBe(false); // 알림 즉시
    await memory.sync();
    expect(server.calls).toEqual([{ remove: ['고객사 회의'] }]);
    expect(server.names()).toEqual([]);
  });

  it('기억하지 않은 이름의 예외를 더해도 지우기를 쌓지 않는다(거른 일정의 제목이 서버로 나가지 않는다)', async () => {
    const { memory, server, exceptions } = setup(['다른 일정']);
    await memory.sync();
    await exceptions.add('고객사 회의'); // 온라인 줄을 '이동 일정이에요'
    expect(memory.hasPending()).toBe(false);
    await memory.sync();
    expect(server.calls).toEqual([]);
    expect(server.names()).toEqual(['다른 일정']);
  });

  it('이동 없음 기억을 더하면 같은 이름의 예외가 지워진다', async () => {
    const { memory, exceptions } = setup([]);
    await exceptions.add('고객사 회의');
    expect(exceptions.has('고객사 회의')).toBe(true);
    await memory.add('고객사 회의');
    expect(exceptions.has('고객사 회의')).toBe(false);
    expect(memory.has('고객사 회의')).toBe(true);
  });

  it('예외를 지우는 알림은 기억을 건드리지 않는다', async () => {
    const { memory, exceptions } = setup([]);
    await memory.add('고객사 회의');
    await exceptions.add('고객사 회의'); // 기억을 지움
    await memory.add('고객사 회의'); // 다시 기억 → 예외를 지움(알림 travel:false)
    expect(memory.has('고객사 회의')).toBe(true);
  });

  it('서버 목록(차가 나중에 더한 이름)에 있는 이름의 예외는 동기화 때 지운다', async () => {
    const { memory, exceptions, server } = setup([]);
    await exceptions.add('고객사 회의'); // 예전에 이동 일정이에요로 바꿈
    await memory.sync(); // 이때는 서버에 기억이 없음
    expect(exceptions.has('고객사 회의')).toBe(true);
    server.seed('고객사 회의'); // 그 뒤 차에서 "안 가요"
    await memory.sync();
    expect(exceptions.has('고객사 회의')).toBe(false);
    expect(memory.has('고객사 회의')).toBe(true);
  });

  it('방금 예외로 바꿨는데 서버에서 기억을 아직 못 지웠으면(올리기 실패) 예외를 지우지 않는다', async () => {
    const { memory, exceptions, server } = setup(['고객사 회의']);
    await memory.sync();
    server.state.down = true;
    await exceptions.add('고객사 회의');
    expect((await memory.sync()).pendingFailed).toBe(true);
    server.state.down = false;
    // 올리기 전에 서버 목록만 받는 경우(예: 다른 경로)에도 올리지 못한 '지우기'가 있는 이름의 예외는 둔다.
    expect(exceptions.has('고객사 회의')).toBe(true);
    await memory.sync();
    expect(server.names()).toEqual([]);
    expect(exceptions.has('고객사 회의')).toBe(true);
  });

  it('예외 목록을 읽지 못한 동안에는 예외를 지우지 않는다', async () => {
    const server = fakeServer(['고객사 회의']);
    const exceptions = {
      remove: jest.fn(async () => undefined),
      has: () => true,
      load: async () => new Set<string>(),
      readFailed: () => true,
      subscribe: () => () => undefined,
    };
    const memory = createSkipMemory({ api: server.api, storage: memoryStorage().storage, exceptions, timeoutMs: 1000, loadTimeoutMs: 100, log: jest.fn() });
    await memory.sync();
    expect(exceptions.remove).not.toHaveBeenCalled();
  });
});
