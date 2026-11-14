import { fetchCalendarSelection, saveCalendarSelection } from '../selectionApi';

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
  it('selectedIds·revision·source(기본 mock)를 PUT 본문으로 보내고 signal을 넘긴다', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => ({ selectedIds: ['mock-my'], savedAt: 'x' }) });
    const { signal } = new AbortController();

    const result = await saveCalendarSelection(['mock-my'], 42, signal);

    expect(result).toEqual({ selectedIds: ['mock-my'], savedAt: 'x' });
    expect(mockPut).toHaveBeenCalledWith({ json: { selectedIds: ['mock-my'], revision: 42, source: 'mock' } }, { init: { signal } });
  });

  it("실제 기기 캘린더(device)면 source: 'device'를 함께 보낸다", async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { signal } = new AbortController();
    await saveCalendarSelection(['3', '7'], 5, signal, 'device');
    expect(mockPut).toHaveBeenCalledWith({ json: { selectedIds: ['3', '7'], revision: 5, source: 'device' } }, { init: { signal } });
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
