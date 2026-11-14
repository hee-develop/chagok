import { renderHook, waitFor } from '@testing-library/react-native';

import { createMemoryStore, type KeyValueStore } from '../../../storage/keyValueStore';
import { isSetupDone, markSetupDone, SETUP_DONE_KEY, useSetupGate } from '../setupGate';

const brokenStore: KeyValueStore = {
  get: jest.fn().mockRejectedValue(new Error('storage')),
  set: jest.fn().mockRejectedValue(new Error('storage')),
  remove: jest.fn().mockRejectedValue(new Error('storage')),
};

describe('첫 설정 완료 표시', () => {
  it('처음에는 끝나지 않은 것으로 읽고, 표시한 뒤에는 끝난 것으로 읽는다', async () => {
    const store = createMemoryStore();
    expect(await isSetupDone(store)).toBe(false);
    await markSetupDone(store);
    expect(store.dump()).toEqual({ [SETUP_DONE_KEY]: '1' });
    expect(await isSetupDone(store)).toBe(true);
  });

  it('저장소를 읽거나 쓰지 못해도 던지지 않고, 읽지 못하면 처음인 것으로 본다', async () => {
    await expect(markSetupDone(brokenStore)).resolves.toBeUndefined();
    expect(await isSetupDone(brokenStore)).toBe(false);
  });
});

describe('useSetupGate', () => {
  it('읽는 동안 loading, 끝났으면 done, 아니면 needed', async () => {
    const pending = await renderHook(() => useSetupGate({ ...createMemoryStore(), get: () => new Promise(() => {}) }));
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
