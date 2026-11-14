import { act, renderHook, waitFor } from '@testing-library/react-native';

import { deferred, makeContacts } from '../settings/testSupport';
import { useContactsPermission } from './useContactsPermission';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});

describe('useContactsPermission', () => {
  it('처음에는 모르고(null), 읽으면 현재 권한을 보인다', async () => {
    const pending = deferred<'denied'>();
    const source = makeContacts('denied');
    source.permission.mockReturnValueOnce(pending.promise);
    const { result } = await renderHook(() => useContactsPermission(source));
    expect(result.current.permission).toBeNull();
    await act(async () => pending.resolve('denied'));
    expect(result.current.permission).toBe('denied');
  });

  it('request는 권한 창을 띄우고 결과로 상태를 바꾼다', async () => {
    const source = makeContacts('ask', 'granted');
    const { result } = await renderHook(() => useContactsPermission(source));
    await waitFor(() => expect(result.current.permission).toBe('ask'));
    await act(async () => { expect(await result.current.request()).toBe('granted'); });
    expect(result.current.permission).toBe('granted');
    expect(source.request).toHaveBeenCalledTimes(1);
  });

  it('권한 창이 던져도(오류) denied로 보고 다시 읽는다', async () => {
    const source = makeContacts('ask');
    source.request.mockRejectedValue(new Error('native'));
    const { result } = await renderHook(() => useContactsPermission(source));
    await waitFor(() => expect(result.current.permission).toBe('ask'));
    await act(async () => { expect(await result.current.request()).toBe('denied'); });
    expect(result.current.permission).toBe('ask');
  });

  it('권한을 읽지 못하면 모르는 채(null)로 둔다', async () => {
    const source = makeContacts('granted');
    source.permission.mockRejectedValue(new Error('native'));
    const { result } = await renderHook(() => useContactsPermission(source));
    await waitFor(() => expect(source.permission).toHaveBeenCalled());
    expect(result.current.permission).toBeNull();
  });
});
