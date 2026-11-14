import { HttpError } from '../../../api/request';
import { createMemoryStore } from '../../../storage/keyValueStore';
import { createCarConnectionSource, PAIRED_CAR_KEY, recordPairedCar } from '../carConnection';

const mockGetStatus = jest.fn();
jest.mock('../../../api/client', () => ({
  api: { pairing: { cars: { ':carId': { $get: (...args: unknown[]) => mockGetStatus(...args) } } } },
}));

const signal = new AbortController().signal;
beforeEach(() => mockGetStatus.mockReset());

describe('createCarConnectionSource', () => {
  it('연결한 차가 없으면 서버에 묻지 않고 연결 안 됨이다', async () => {
    const source = createCarConnectionSource(createMemoryStore());
    expect(await source.isConnected(signal)).toBe(false);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it('저장한 차 id로 서버에 묻고 paired 값을 그대로 돌려준다', async () => {
    const source = createCarConnectionSource(createMemoryStore({ [PAIRED_CAR_KEY]: 'car-1' }));
    mockGetStatus.mockResolvedValueOnce({ ok: true, json: async () => ({ paired: true, pairedAt: 'x', codeActive: false }) });
    expect(await source.isConnected(signal)).toBe(true);
    expect(mockGetStatus).toHaveBeenCalledWith({ param: { carId: 'car-1' } }, { init: { signal } });
    mockGetStatus.mockResolvedValueOnce({ ok: true, json: async () => ({ paired: false, pairedAt: null, codeActive: true }) });
    expect(await source.isConnected(signal)).toBe(false);
  });

  it('서버가 오류를 돌려주면 연결 안 됨으로 단정하지 않고 던진다(화면이 오류 상태로 보인다)', async () => {
    const source = createCarConnectionSource(createMemoryStore({ [PAIRED_CAR_KEY]: 'car-1' }));
    mockGetStatus.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(source.isConnected(signal)).rejects.toBeInstanceOf(HttpError);
  });

  it('저장소를 읽지 못하면 연결 안 됨으로 본다', async () => {
    const store = { ...createMemoryStore(), get: jest.fn().mockRejectedValue(new Error('storage')) };
    expect(await createCarConnectionSource(store).isConnected(signal)).toBe(false);
  });
});

describe('recordPairedCar', () => {
  const result = { carId: 'car-9', pairedAt: '2026-11-06T00:00:00Z' };

  it('연결에 성공하면 차 id를 저장하고 결과를 그대로 돌려준다', async () => {
    const store = createMemoryStore();
    const inner = { claim: jest.fn().mockResolvedValue(result) };
    expect(await recordPairedCar(inner, store).claim('123456', signal)).toBe(result);
    expect(inner.claim).toHaveBeenCalledWith('123456', signal);
    expect(store.dump()).toEqual({ [PAIRED_CAR_KEY]: 'car-9' });
  });

  it('연결에 실패하면 던지고 아무것도 저장하지 않는다', async () => {
    const store = createMemoryStore();
    const inner = { claim: jest.fn().mockRejectedValue(new HttpError(404, 'no')) };
    await expect(recordPairedCar(inner, store).claim('000000', signal)).rejects.toBeInstanceOf(HttpError);
    expect(store.dump()).toEqual({});
  });

  it('저장하지 못해도 연결 결과는 성공으로 돌려준다', async () => {
    const store = { ...createMemoryStore(), set: jest.fn().mockRejectedValue(new Error('storage')) };
    const inner = { claim: jest.fn().mockResolvedValue(result) };
    await expect(recordPairedCar(inner, store).claim('123456', signal)).resolves.toBe(result);
  });
});
