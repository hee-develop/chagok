import { fetchEventsReceivedAt, putEvents } from '../eventsApi';
import { isClientError } from '../../../api/request';

const mockPut = jest.fn();
const mockGet = jest.fn();
jest.mock('../../../api/client', () => ({
  api: { events: { $put: (...args: unknown[]) => mockPut(...args), $get: (...args: unknown[]) => mockGet(...args) } },
}));

beforeEach(() => {
  mockPut.mockReset();
  mockGet.mockReset();
});

describe('putEvents', () => {
  it('일정 전체를 events 본문으로 PUT하고 signal을 넘긴다', async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => ({ stored: 0 }) });
    const { signal } = new AbortController();
    expect(await putEvents([], signal)).toEqual({ stored: 0 });
    expect(mockPut).toHaveBeenCalledWith({ json: { events: [] } }, { init: { signal } });
  });

  it('ok가 아니면 상태 코드를 담은 HttpError를 던진다', async () => {
    mockPut.mockResolvedValue({ ok: false, status: 400 });
    const error = (await putEvents([], new AbortController().signal).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('400');
    expect(isClientError(error)).toBe(true);
  });
});

describe('fetchEventsReceivedAt', () => {
  it('GET /events의 receivedAt을 돌려주고 signal을 넘긴다', async () => {
    mockGet.mockResolvedValue({ ok: true, json: async () => ({ date: '2026-11-11', receivedAt: null, events: [] }) });
    const { signal } = new AbortController();
    expect(await fetchEventsReceivedAt(signal)).toBeNull();
    expect(mockGet).toHaveBeenCalledWith({ query: { date: undefined } }, { init: { signal } });
    mockGet.mockResolvedValue({ ok: true, json: async () => ({ date: '2026-11-11', receivedAt: '2026-11-11T01:00:00.000Z', events: [] }) });
    expect(await fetchEventsReceivedAt(signal)).toBe('2026-11-11T01:00:00.000Z');
  });

  it('ok가 아니면 HttpError를 던진다', async () => {
    mockGet.mockResolvedValue({ ok: false, status: 403 });
    const error = (await fetchEventsReceivedAt(new AbortController().signal).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('403');
  });
});
