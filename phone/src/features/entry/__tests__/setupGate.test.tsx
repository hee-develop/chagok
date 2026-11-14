import { renderHook, waitFor } from '@testing-library/react-native';

import { createMemoryStore, type KeyValueStore } from '../../../storage/keyValueStore';
import { isSetupDone, markSetupDone, resetSetupDoneForTests, SETUP_DONE_KEY, useSetupGate } from '../setupGate';

const brokenStore: KeyValueStore = {
  getItem: jest.fn().mockRejectedValue(new Error('storage')),
  setItem: jest.fn().mockRejectedValue(new Error('storage')),
  removeItem: jest.fn().mockRejectedValue(new Error('storage')),
};

beforeEach(() => resetSetupDoneForTests());

describe('첫 설정 완료 표시', () => {
  it('처음에는 끝나지 않은 것으로 읽고, 표시한 뒤에는 끝난 것으로 읽는다', async () => {
    const store = createMemoryStore();
    expect(await isSetupDone(store)).toBe(false);
    await markSetupDone(store);
    expect(store.dump()).toEqual({ [SETUP_DONE_KEY]: '1' });
    expect(await isSetupDone(store)).toBe(true);
  });

  it('저장소를 읽지 못하면 던지지 않고 처음인 것으로 본다', async () => {
    expect(await isSetupDone(brokenStore)).toBe(false);
  });

  it('저장소에 쓰지 못해도 던지지 않고, 이번 실행에서는 끝난 것으로 본다(탭으로 갈 수 있다)', async () => {
    await expect(markSetupDone(brokenStore)).resolves.toBeUndefined();
    // 저장소는 읽지도 못하지만 메모리에 남은 표시로 끝난 것으로 읽는다.
    expect(await isSetupDone(brokenStore)).toBe(true);
    expect(await isSetupDone(createMemoryStore())).toBe(true);
    // 앱을 다시 열면(메모리가 비면) 저장된 것이 없으니 첫 설정이 한 번 더 보인다.
    resetSetupDoneForTests();
    expect(await isSetupDone(createMemoryStore())).toBe(false);
  });
});

describe('useSetupGate', () => {
  it('읽는 동안 loading, 끝났으면 done, 아니면 needed', async () => {
    const pending = await renderHook(() => useSetupGate({ ...createMemoryStore(), getItem: () => new Promise(() => {}) }));
    expect(pending.result.current).toBe('loading');

    const done = await renderHook(() => useSetupGate(createMemoryStore({ [SETUP_DONE_KEY]: '1' })));
    await waitFor(() => expect(done.result.current).toBe('done'));

    const fresh = await renderHook(() => useSetupGate(createMemoryStore()));
    await waitFor(() => expect(fresh.result.current).toBe('needed'));
  });

  it('저장소 오류는 needed(첫 설정으로 보냄)', async () => {
    const { result } = await renderHook(() => useSetupGate(brokenStore));
    await waitFor(() => expect(result.current).toBe('needed'));
  });
});
