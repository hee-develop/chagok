import { createTravelExceptions, LOAD_TIMEOUT_MS, MAX_EXCEPTIONS, normalizeTitle, STORAGE_KEY, type KeyValueStorage } from '../travelExceptions';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: jest.fn(async (k: string) => data.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void data.set(k, v)),
  };
  return { storage, data };
};

describe('travelExceptions', () => {
  it('이름을 정규화한다(공백·대소문자)', () => {
    expect(normalizeTitle('  Weekly   SYNC ')).toBe('weekly sync');
  });

  it('추가한 이름은 저장소에 남고 다시 만들어도 읽힌다', async () => {
    const { storage, data } = memoryStorage();
    const first = createTravelExceptions(storage);
    await first.add('  주간  회의 ');
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual(['주간 회의']);
    const second = createTravelExceptions(storage);
    expect(await second.load()).toEqual(new Set(['주간 회의']));
    expect(second.has('주간 회의')).toBe(true);
    expect(second.has('다른 회의')).toBe(false);
  });

  it('같은 이름은 한 번만 두고 지우면 다시 거른다', async () => {
    const { storage, data } = memoryStorage();
    const ex = createTravelExceptions(storage);
    await ex.add('회의');
    await ex.add('회의 ');
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual(['회의']);
    await ex.remove('회의');
    expect(ex.has('회의')).toBe(false);
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual([]);
  });

  it('저장소 내용이 망가졌으면 빈 목록으로 보고 이어 쓴다(읽기 실패가 아니다)', async () => {
    const ex = createTravelExceptions(memoryStorage({ [STORAGE_KEY]: '{깨짐' }).storage);
    expect((await ex.load()).size).toBe(0);
    expect(ex.readFailed()).toBe(false);
    expect((await createTravelExceptions(memoryStorage({ [STORAGE_KEY]: '[1,"a"]' }).storage).load())).toEqual(new Set(['a']));
  });

  describe('저장소를 읽지 못할 때', () => {
    const flaky = (stored: string[]) => {
      let failing = true;
      const data = new Map([[STORAGE_KEY, JSON.stringify(stored)]]);
      const storage: KeyValueStorage = {
        getItem: jest.fn(async (k: string) => {
          if (failing) throw new Error('읽기 실패');
          return data.get(k) ?? null;
        }),
        setItem: jest.fn(async (k: string, v: string) => void data.set(k, v)),
      };
      return { storage, data, recover: () => void (failing = false) };
    };

    it('읽기 실패를 표시하고 빈 목록을 돌려주되 거부하지 않는다', async () => {
      const { storage } = flaky(['기존']);
      const ex = createTravelExceptions(storage);
      expect((await ex.load()).size).toBe(0);
      expect(ex.readFailed()).toBe(true);
    });

    it('실패한 동안 더한 이름은 메모리에만 두고 저장소의 기존 목록을 덮어쓰지 않는다', async () => {
      const { storage, data } = flaky(['기존']);
      const ex = createTravelExceptions(storage);
      await ex.add('새 이름');
      expect(ex.has('새 이름')).toBe(true);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual(['기존']);
    });

    it('다음 load에서 다시 읽고, 읽는 데 성공하면 메모리 이름과 합쳐 한 번 저장한다', async () => {
      const { storage, data, recover } = flaky(['기존']);
      const ex = createTravelExceptions(storage);
      await ex.add('새 이름');
      recover();
      expect(await ex.load()).toEqual(new Set(['기존', '새 이름']));
      expect(ex.readFailed()).toBe(false);
      expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual(['기존', '새 이름']);
      await ex.load();
      expect(storage.getItem).toHaveBeenCalledTimes(2); // 실패한 읽기 1번 + 다시 읽기 1번, 성공한 뒤로는 더 읽지 않는다
    });

    it('실패한 동안 지운 이름은 다시 읽은 뒤에도 되살아나지 않는다', async () => {
      const { storage, data, recover } = flaky(['기존', '다른']);
      const ex = createTravelExceptions(storage);
      await ex.remove('기존');
      recover();
      expect(await ex.load()).toEqual(new Set(['다른']));
      expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual(['다른']);
    });

    it('읽기가 시간 제한 안에 끝나지 않으면 실패로 보고 멈추지 않는다', async () => {
      jest.useFakeTimers();
      try {
        const storage: KeyValueStorage = { getItem: jest.fn().mockReturnValue(new Promise(() => {})), setItem: jest.fn() };
        const ex = createTravelExceptions(storage);
        const loading = ex.load();
        await jest.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 1);
        expect((await loading).size).toBe(0);
        expect(ex.readFailed()).toBe(true);
        // 다음 load는 다시 읽는다.
        const again = ex.load();
        await jest.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 1);
        await again;
        expect(storage.getItem).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('시간 제한은 옵션으로 바꿀 수 있다', async () => {
      jest.useFakeTimers();
      try {
        const ex = createTravelExceptions({ getItem: () => new Promise(() => {}), setItem: jest.fn() }, { loadTimeoutMs: 50 });
        const loading = ex.load();
        await jest.advanceTimersByTimeAsync(51);
        await loading;
        expect(ex.readFailed()).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('쓰기가 실패해도 앱이 떠 있는 동안은 메모리 목록이 맞다', async () => {
      const storage: KeyValueStorage = { getItem: jest.fn(async () => null), setItem: jest.fn().mockRejectedValue(new Error('x')) };
      const ex = createTravelExceptions(storage);
      await ex.add('회의');
      expect(ex.has('회의')).toBe(true);
    });
  });

  it('바뀔 때마다 구독자에게 알린다(J2b가 서버 목록에 올리는 자리)', async () => {
    const ex = createTravelExceptions(memoryStorage().storage);
    const seen: unknown[] = [];
    const off = ex.subscribe((c) => seen.push(c));
    await ex.add('회의');
    await ex.remove('회의');
    off();
    await ex.add('다른');
    expect(seen).toEqual([{ name: '회의', travel: true }, { name: '회의', travel: false }]);
  });

  it(`${MAX_EXCEPTIONS}개를 넘으면 오래된 이름부터 밀려난다`, async () => {
    const ex = createTravelExceptions(memoryStorage({ [STORAGE_KEY]: JSON.stringify(Array.from({ length: MAX_EXCEPTIONS }, (_, i) => `n${i}`)) }).storage);
    await ex.add('새 이름');
    expect(ex.has('n0')).toBe(false);
    expect(ex.has('새 이름')).toBe(true);
    expect((await ex.load()).size).toBe(MAX_EXCEPTIONS);
  });
});
