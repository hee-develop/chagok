import { HttpError } from '../../../api/request';
import { pairingApi } from '../pairingApi';

const mockClaim = jest.fn();
const mockDelete = jest.fn();
const mockGet = jest.fn();
jest.mock('../../../api/client', () => ({
  api: {
    pair: {
      claim: { $post: (...args: unknown[]) => mockClaim(...args) },
      $delete: (...args: unknown[]) => mockDelete(...args),
      $get: (...args: unknown[]) => mockGet(...args),
    },
  },
}));
const mockSetToken = jest.fn();
const mockClearToken = jest.fn();
jest.mock('../../../api/session', () => ({
  session: { setToken: (...args: unknown[]) => mockSetToken(...args), clearToken: (...args: unknown[]) => mockClearToken(...args) },
}));
jest.mock('../deviceName', () => ({ getDeviceName: () => 'Pixel 9' }));
const mockClearLocal = jest.fn();
const mockQuiesce = jest.fn();
jest.mock('../localState', () => ({
  clearLocalCarState: (...args: unknown[]) => mockClearLocal(...args),
  quiesceLocalCarState: (...args: unknown[]) => mockQuiesce(...args),
}));

beforeEach(() => {
  mockClaim.mockReset();
  mockDelete.mockReset();
  mockGet.mockReset();
  mockSetToken.mockReset();
  mockClearToken.mockReset();
  mockClearLocal.mockReset();
  mockQuiesce.mockReset();
  mockQuiesce.mockReturnValue(jest.fn());
});

describe('pairingApi.claim', () => {
  it('코드와 기기 이름을 보내고, 받은 폰 토큰은 저장하되 결과에는 담지 않는다', async () => {
    const body = { seatId: 'seat-1', name: 'Pixel 9', pairedAt: 'x', mode: 'new', phoneToken: 'secret' };
    mockClaim.mockResolvedValue({ ok: true, json: async () => body });
    const { signal } = new AbortController();

    const result = await pairingApi.claim('123456', signal);

    expect(mockClaim).toHaveBeenCalledWith({ json: { code: '123456', name: 'Pixel 9' } }, { init: { signal } });
    expect(mockSetToken).toHaveBeenCalledWith('secret');
    expect(result).toEqual({ seatId: 'seat-1', name: 'Pixel 9', pairedAt: 'x', mode: 'new' });
  });

  it('응답이 ok가 아니면 상태를 담아 던지고 토큰을 저장하지 않는다', async () => {
    mockClaim.mockResolvedValue({ ok: false, status: 404 });
    await expect(pairingApi.claim('123456', new AbortController().signal)).rejects.toMatchObject({ status: 404 });
    await expect(pairingApi.claim('123456', new AbortController().signal)).rejects.toBeInstanceOf(HttpError);
    expect(mockSetToken).not.toHaveBeenCalled();
  });
});

describe('pairingApi.disconnect', () => {
  it('서버가 지우면 토큰을 버리고, 그 자리에 딸린 로컬 상태(알림함·폴링·일정 보내기 기억·거른 일정)를 비운다', async () => {
    const order: string[] = [];
    mockQuiesce.mockImplementation(() => (order.push('quiesce'), () => void order.push('release')));
    mockDelete.mockImplementation(async () => (order.push('delete'), { status: 200 }));
    mockClearToken.mockImplementation(async () => void order.push('token'));
    mockClearLocal.mockImplementation(() => void order.push('local'));
    await pairingApi.disconnect(new AbortController().signal);
    // 일정 보내기·폴링은 서버 DELETE와 토큰 삭제보다 먼저 멈춘다.
    expect(order).toEqual(['quiesce', 'delete', 'token', 'local', 'release']);
    expect(mockClearToken).toHaveBeenCalledTimes(1);
    expect(mockClearLocal).toHaveBeenCalledTimes(1);
  });

  it('이미 모르는 토큰(401)이어도 끊긴 것이라 토큰을 버린다', async () => {
    mockDelete.mockResolvedValue({ status: 401 });
    await pairingApi.disconnect(new AbortController().signal);
    expect(mockClearToken).toHaveBeenCalledTimes(1);
    expect(mockClearLocal).toHaveBeenCalledTimes(1);
  });

  it('서버 오류면 던지고 토큰은 남긴다(다시 시도할 수 있게). 붙잡은 일정 보내기는 푼다', async () => {
    const release = jest.fn();
    mockQuiesce.mockReturnValue(release);
    mockDelete.mockResolvedValue({ status: 500 });
    await expect(pairingApi.disconnect(new AbortController().signal)).rejects.toMatchObject({ status: 500 });
    expect(mockClearToken).not.toHaveBeenCalled();
    expect(mockClearLocal).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('네트워크 오류로 던져도 붙잡은 일정 보내기는 푼다', async () => {
    const release = jest.fn();
    mockQuiesce.mockReturnValue(release);
    mockDelete.mockRejectedValue(new Error('network'));
    await expect(pairingApi.disconnect(new AbortController().signal)).rejects.toThrow('network');
    expect(release).toHaveBeenCalledTimes(1);
    expect(mockClearToken).not.toHaveBeenCalled();
  });
});

describe('pairingApi.status', () => {
  const connected = { paired: true, seatId: 'seat-1', name: 'Pixel 9', pairedAt: '2026-11-15T00:00:00.000Z', lastEventsAt: null, presence: null, lastPresenceAt: null };

  it('연결돼 있으면(200) 자리 이름·연결 시각을 돌려준다', async () => {
    mockGet.mockResolvedValue({ ok: true, status: 200, json: async () => connected });
    const { signal } = new AbortController();
    expect(await pairingApi.status(signal)).toEqual(connected);
    expect(mockGet).toHaveBeenCalledWith(undefined, { init: { signal } });
  });

  it('연결 안 됨(401)이면 null이다', async () => {
    mockGet.mockResolvedValue({ ok: false, status: 401 });
    expect(await pairingApi.status(new AbortController().signal)).toBeNull();
  });

  it('그 밖의 서버 오류는 던진다(연결 안 됨으로 오해하지 않게)', async () => {
    mockGet.mockResolvedValue({ ok: false, status: 500 });
    await expect(pairingApi.status(new AbortController().signal)).rejects.toMatchObject({ status: 500 });
  });
});
