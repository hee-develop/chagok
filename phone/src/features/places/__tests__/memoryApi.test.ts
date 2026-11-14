import { HttpError } from '../../../api/request';
import { placeMemoryApi } from '../memoryApi';

const mock = { get: jest.fn(), del: jest.fn() };
jest.mock('../../../api/client', () => ({
  api: {
    places: {
      memory: {
        $get: (...a: unknown[]) => mock.get(...a),
        $delete: (...a: unknown[]) => mock.del(...a),
      },
    },
  },
}));

const { signal } = new AbortController();
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const bad = (status: number) => ({ ok: false, status });

beforeEach(() => Object.values(mock).forEach((fn) => fn.mockReset()));

describe('placeMemoryApi', () => {
  it('fetchMemories는 memories 배열을 돌려주고 signal을 넘긴다', async () => {
    const memory = { name: '스타벅스', place: { name: 'A', address: null, lat: 1, lng: 2 }, ambiguous: true, updatedAt: '2026-11-15T00:00:00.000Z' };
    mock.get.mockResolvedValue(ok({ memories: [memory] }));
    await expect(placeMemoryApi.fetchMemories(signal)).resolves.toEqual([memory]);
    expect(mock.get).toHaveBeenCalledWith({}, { init: { signal } });
  });

  it('fetchMemories는 ok가 아니면 HttpError를 던진다', async () => {
    mock.get.mockResolvedValue(bad(401));
    await expect(placeMemoryApi.fetchMemories(signal)).rejects.toMatchObject({ name: 'HttpError', status: 401 });
  });

  it('deleteMemory는 이름을 쿼리 name으로 보내고 지웠으면 true, 이미 없으면(404) false다', async () => {
    mock.del.mockResolvedValueOnce(ok({ name: '스타벅스' }));
    await expect(placeMemoryApi.deleteMemory('스타벅스', signal)).resolves.toBe(true);
    expect(mock.del).toHaveBeenCalledWith({ query: { name: '스타벅스' } }, { init: { signal } });
    mock.del.mockResolvedValueOnce(bad(404));
    await expect(placeMemoryApi.deleteMemory('스타벅스', signal)).resolves.toBe(false);
  });

  it('deleteMemory는 그 밖의 오류를 던진다', async () => {
    mock.del.mockResolvedValue(bad(500));
    const error = await placeMemoryApi.deleteMemory('x', signal).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(500);
  });
});
