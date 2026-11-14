import { createTravelExceptions, MAX_EXCEPTIONS, normalizeTitle, STORAGE_KEY, type KeyValueStorage } from '../travelExceptions';

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

  it('저장소를 못 읽거나 망가졌으면 빈 목록이고 못 써도 앱이 떠 있는 동안은 기억한다', async () => {
    const broken: KeyValueStorage = { getItem: jest.fn().mockRejectedValue(new Error('x')), setItem: jest.fn().mockRejectedValue(new Error('x')) };
    const ex = createTravelExceptions(broken);
    expect((await ex.load()).size).toBe(0);
    await ex.add('회의');
    expect(ex.has('회의')).toBe(true);
    expect((await createTravelExceptions(memoryStorage({ [STORAGE_KEY]: '{깨짐' }).storage).load()).size).toBe(0);
    expect((await createTravelExceptions(memoryStorage({ [STORAGE_KEY]: '[1,"a"]' }).storage).load())).toEqual(new Set(['a']));
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
