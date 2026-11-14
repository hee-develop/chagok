import { act, renderHook, waitFor } from '@testing-library/react-native';

import { HttpError } from '../../../api/request';
import { createMemoryStore } from '../../../storage/keyValueStore';
import { createCarConnectionSource, LEGACY_PAIRED_CAR_KEY, useCarConnection, type CarConnectionSource } from '../carConnection';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});

const signal = new AbortController().signal;
const SEAT = { seatId: 'seat-1', name: 'Pixel 9', pairedAt: '2026-11-06T00:30:00Z', lastEventsAt: null };

describe('createCarConnectionSource: 폰 토큰으로 GET /pair를 묻는다', () => {
  it('연결돼 있으면 자리 이름과 연결 시각만 돌려준다(차 id는 폰 응답에 없다)', async () => {
    const api = { status: jest.fn().mockResolvedValue(SEAT) };
    const found = await createCarConnectionSource(api as never, createMemoryStore()).status(signal);
    expect(found).toEqual({ name: 'Pixel 9', pairedAt: '2026-11-06T00:30:00Z' });
    expect(api.status).toHaveBeenCalledWith(signal);
  });

  it('연결 안 됨(서버 401을 null로 바꾼 값)이면 null이다', async () => {
    const api = { status: jest.fn().mockResolvedValue(null) };
    expect(await createCarConnectionSource(api, createMemoryStore()).status(signal)).toBeNull();
  });

  it('서버 오류는 연결 안 됨으로 단정하지 않고 던진다(화면이 오류 상태로 보인다)', async () => {
    const api = { status: jest.fn().mockRejectedValue(new HttpError(500, 'boom')) };
    await expect(createCarConnectionSource(api, createMemoryStore()).status(signal)).rejects.toBeInstanceOf(HttpError);
  });

  it('J1 이전 버전이 폰에 남긴 차 id는 처음 확인할 때 한 번 지운다', async () => {
    const store = createMemoryStore({ [LEGACY_PAIRED_CAR_KEY]: 'car-1', other: 'keep' });
    const remove = jest.spyOn(store, 'remove');
    const source = createCarConnectionSource({ status: jest.fn().mockResolvedValue(null) }, store);
    await source.status(signal);
    await source.status(signal);
    expect(store.dump()).toEqual({ other: 'keep' });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('예전 키를 지우지 못해도 상태 확인은 그대로 된다', async () => {
    const store = { ...createMemoryStore(), remove: jest.fn().mockRejectedValue(new Error('storage')) };
    const api = { status: jest.fn().mockResolvedValue(SEAT) };
    await expect(createCarConnectionSource(api, store).status(signal)).resolves.toEqual({ name: 'Pixel 9', pairedAt: SEAT.pairedAt });
  });
});

describe('useCarConnection', () => {
  const source = (status: CarConnectionSource['status']): CarConnectionSource => ({ status });

  it('연결됨은 자리 이름·시각을 담고, 다시 확인하는 동안에는 직전 결과를 그대로 둔다', async () => {
    let resolveNext: (v: { name: string; pairedAt: string } | null) => void = () => {};
    const status = jest.fn()
      .mockResolvedValueOnce({ name: 'Pixel 9', pairedAt: SEAT.pairedAt })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    const src = source(status);
    const { result } = await renderHook(() => useCarConnection({ source: src }));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'connected', name: 'Pixel 9', pairedAt: SEAT.pairedAt }));

    await act(async () => { result.current.recheck(); });
    // 두 번째 조회가 끝나기 전에도 '연결됨'이 남아 카드가 깜빡이지 않는다.
    expect(status).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe('connected');
    await act(async () => { resolveNext(null); });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'notConnected' }));
  });

  it('오류에서 다시 확인하면 확인 중으로 바뀌고 복구된다', async () => {
    const status = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    const src = source(status);
    const { result } = await renderHook(() => useCarConnection({ source: src }));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    await act(async () => { result.current.recheck(); });
    await waitFor(() => expect(result.current.state.status).toBe('notConnected'));
  });
});
