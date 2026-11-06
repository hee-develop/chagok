import { createRevisionClock, fetchCalendarSelection, saveCalendarSelection } from '../selectionApi';

const mockPut = jest.fn();
const mockGet = jest.fn();
jest.mock('../../../api/client', () => ({
  api: {
    calendars: {
      selection: {
        $put: (...args: unknown[]) => mockPut(...args),
        $get: (...args: unknown[]) => mockGet(...args),
      },
    },
  },
}));

beforeEach(() => {
  mockPut.mockReset();
  mockGet.mockReset();
});

describe('saveCalendarSelection', () => {
  it('selectedIds와 revision만 PUT 본문으로 보내고 signal을 넘긴다', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => ({ selectedIds: ['mock-my'], savedAt: 'x' }) });
    const { signal } = new AbortController();

    const result = await saveCalendarSelection(['mock-my'], 42, signal);

    expect(result).toEqual({ selectedIds: ['mock-my'], savedAt: 'x' });
    expect(mockPut).toHaveBeenCalledWith({ json: { selectedIds: ['mock-my'], revision: 42 } }, { init: { signal } });
  });

  it('응답이 ok가 아니면 던진다', async () => {
    mockPut.mockResolvedValue({ ok: false, status: 400 });
    await expect(saveCalendarSelection(['x'], 1, new AbortController().signal)).rejects.toThrow('400');
  });
});

describe('fetchCalendarSelection', () => {
  it('저장된 id 목록을 돌려준다', async () => {
    mockGet.mockResolvedValue({ ok: true, json: async () => ({ selectedIds: ['mock-kia'], savedAt: 'x' }) });
    const { signal } = new AbortController();

    await expect(fetchCalendarSelection(signal)).resolves.toEqual(['mock-kia']);
    expect(mockGet).toHaveBeenCalledWith({}, { init: { signal } });
  });

  it('저장 전이면 null이다', async () => {
    mockGet.mockResolvedValue({ ok: true, json: async () => ({ selectedIds: null, savedAt: null }) });
    await expect(fetchCalendarSelection(new AbortController().signal)).resolves.toBeNull();
  });

  it('응답이 ok가 아니면 던진다', async () => {
    mockGet.mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchCalendarSelection(new AbortController().signal)).rejects.toThrow('500');
  });
});

describe('createRevisionClock', () => {
  it('시각이 같거나 거꾸로 가도 항상 이전보다 큰 정수를 돌려준다', () => {
    const times = [1000, 1000, 1000, 900, 1001];
    const next = createRevisionClock(() => times.shift() as number);
    const values = [next(), next(), next(), next(), next()];
    expect(values[0]).toBe(1_000_000);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(values.every(Number.isSafeInteger)).toBe(true);
  });

  it('현재 시각 기준 값은 안전 정수 범위 안이다', () => {
    expect(Number.isSafeInteger(createRevisionClock()())).toBe(true);
  });
});
