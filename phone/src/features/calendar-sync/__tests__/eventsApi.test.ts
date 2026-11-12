import { putEvents } from '../eventsApi';
import { isClientError } from '../../../api/request';

const mockPut = jest.fn();
jest.mock('../../../api/client', () => ({ api: { events: { $put: (...args: unknown[]) => mockPut(...args) } } }));

beforeEach(() => mockPut.mockReset());

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
