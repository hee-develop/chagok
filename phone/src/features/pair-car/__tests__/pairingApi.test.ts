import { HttpError } from '../../../api/request';
import { pairingApi } from '../pairingApi';

const mockClaim = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../../api/client', () => ({
  api: { pair: { claim: { $post: (...args: unknown[]) => mockClaim(...args) }, $delete: (...args: unknown[]) => mockDelete(...args) } },
}));
const mockSetToken = jest.fn();
const mockClearToken = jest.fn();
jest.mock('../../../api/session', () => ({
  session: { setToken: (...args: unknown[]) => mockSetToken(...args), clearToken: (...args: unknown[]) => mockClearToken(...args) },
}));
jest.mock('../deviceName', () => ({ getDeviceName: () => 'Pixel 9' }));

beforeEach(() => {
  mockClaim.mockReset();
  mockDelete.mockReset();
  mockSetToken.mockReset();
  mockClearToken.mockReset();
});

describe('pairingApi.claim', () => {
  it('코드와 기기 이름을 보내고, 받은 폰 토큰은 저장하되 결과에는 담지 않는다', async () => {
    const body = { carId: 'car-1', seatId: 'seat-1', name: 'Pixel 9', pairedAt: 'x', mode: 'new', phoneToken: 'secret' };
    mockClaim.mockResolvedValue({ ok: true, json: async () => body });
    const { signal } = new AbortController();

    const result = await pairingApi.claim('123456', signal);

    expect(mockClaim).toHaveBeenCalledWith({ json: { code: '123456', name: 'Pixel 9' } }, { init: { signal } });
    expect(mockSetToken).toHaveBeenCalledWith('secret');
    expect(result).toEqual({ carId: 'car-1', seatId: 'seat-1', name: 'Pixel 9', pairedAt: 'x', mode: 'new' });
  });

  it('응답이 ok가 아니면 상태를 담아 던지고 토큰을 저장하지 않는다', async () => {
    mockClaim.mockResolvedValue({ ok: false, status: 404 });
    await expect(pairingApi.claim('123456', new AbortController().signal)).rejects.toMatchObject({ status: 404 });
    await expect(pairingApi.claim('123456', new AbortController().signal)).rejects.toBeInstanceOf(HttpError);
    expect(mockSetToken).not.toHaveBeenCalled();
  });
});

describe('pairingApi.disconnect', () => {
  it('서버가 지우면 토큰을 버린다', async () => {
    mockDelete.mockResolvedValue({ status: 200 });
    await pairingApi.disconnect(new AbortController().signal);
    expect(mockClearToken).toHaveBeenCalledTimes(1);
  });

  it('이미 모르는 토큰(401)이어도 끊긴 것이라 토큰을 버린다', async () => {
    mockDelete.mockResolvedValue({ status: 401 });
    await pairingApi.disconnect(new AbortController().signal);
    expect(mockClearToken).toHaveBeenCalledTimes(1);
  });

  it('서버 오류면 던지고 토큰은 남긴다(다시 시도할 수 있게)', async () => {
    mockDelete.mockResolvedValue({ status: 500 });
    await expect(pairingApi.disconnect(new AbortController().signal)).rejects.toMatchObject({ status: 500 });
    expect(mockClearToken).not.toHaveBeenCalled();
  });
});
