import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useSettings } from '../useSettings';
import { deferred, makeSettingsApi, OFF } from '../testSupport';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});

const ready = (result: { current: ReturnType<typeof useSettings> }) => result.current.state.status === 'ready';

describe('useSettings · 오래된 응답 막기', () => {
  it('저장 뒤에 늦게 도착한 이전 조회 응답은 방금 저장한 값을 되돌리지 않는다', async () => {
    const slow = deferred<typeof OFF>();
    const api = makeSettingsApi();
    const { result } = await renderHook(() => useSettings({ api }));
    await waitFor(() => expect(ready(result)).toBe(true));
    // 다시 읽기를 시작하지만 응답이 늦다(서버가 저장 전의 값으로 답한다).
    api.fetchSettings.mockImplementationOnce(() => slow.promise);
    await act(async () => result.current.reload());
    await act(async () => { await result.current.toggle('plusMode', true); });
    expect(result.current.state).toEqual({ status: 'ready', values: { ...OFF, plusMode: true } });
    await act(async () => slow.resolve({ ...OFF }));
    expect(result.current.state).toEqual({ status: 'ready', values: { ...OFF, plusMode: true } });
  });

  it('저장하는 동안 늦게 온 조회 응답도 저장 결과를 덮지 않는다', async () => {
    const api = makeSettingsApi();
    const { result } = await renderHook(() => useSettings({ api }));
    await waitFor(() => expect(ready(result)).toBe(true));
    const save = deferred<typeof OFF>();
    api.saveSettings.mockImplementationOnce(() => save.promise);
    const late = deferred<typeof OFF>();
    let toggling!: Promise<boolean>;
    await act(async () => { toggling = result.current.toggle('voiceOnly', true); });
    // 저장 중에 시작한 조회(포커스를 다시 얻음)가 저장보다 먼저 끝나지만 저장 전의 값이다.
    api.fetchSettings.mockImplementationOnce(() => late.promise);
    await act(async () => result.current.reload());
    await act(async () => late.resolve({ ...OFF }));
    expect(result.current.state).toEqual({ status: 'ready', values: { ...OFF, voiceOnly: true } });
    await act(async () => { save.resolve({ ...OFF, voiceOnly: true }); await toggling; });
    expect(result.current.state).toEqual({ status: 'ready', values: { ...OFF, voiceOnly: true } });
    expect(result.current.savingKey).toBeNull();
  });

  it('새 조회가 시작되면 이전 조회의 응답은 버리고 마지막 조회만 반영한다', async () => {
    const first = deferred<typeof OFF>();
    const second = deferred<typeof OFF>();
    const api = makeSettingsApi({}, { fetchSettings: jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
    const { result } = await renderHook(() => useSettings({ api }));
    await act(async () => result.current.reload());
    await act(async () => second.resolve({ ...OFF, lateContact: true }));
    await act(async () => first.resolve({ ...OFF, plusMode: true }));
    expect(result.current.state).toEqual({ status: 'ready', values: { ...OFF, lateContact: true } });
  });

  it('이미 읽은 값은 다시 읽다 실패해도 그대로 둔다(처음부터 못 읽었을 때만 오류)', async () => {
    const api = makeSettingsApi({ plusMode: true });
    const { result } = await renderHook(() => useSettings({ api }));
    await waitFor(() => expect(ready(result)).toBe(true));
    api.fetchSettings.mockRejectedValueOnce(new Error('offline'));
    await act(async () => result.current.reload());
    await waitFor(() => expect(api.fetchSettings).toHaveBeenCalledTimes(2));
    expect(result.current.state).toEqual({ status: 'ready', values: { ...OFF, plusMode: true } });
  });

  it('아직 읽지 못했거나 같은 값이거나 저장 중이면 toggle은 아무것도 보내지 않는다', async () => {
    const api = makeSettingsApi({}, { fetchSettings: jest.fn(() => new Promise(() => {})) });
    const { result } = await renderHook(() => useSettings({ api }));
    await act(async () => { expect(await result.current.toggle('plusMode', true)).toBe(false); });
    expect(api.saveSettings).not.toHaveBeenCalled();
    const ok = makeSettingsApi();
    const loaded = await renderHook(() => useSettings({ api: ok }));
    await waitFor(() => expect(ready(loaded.result)).toBe(true));
    await act(async () => { expect(await loaded.result.current.toggle('plusMode', false)).toBe(false); });
    expect(ok.saveSettings).not.toHaveBeenCalled();
  });

  it('저장에 성공하면 onSaved를 부르고, 실패하면 부르지 않고 issue를 남긴다', async () => {
    const onSaved = jest.fn();
    const saveSettings = jest.fn(async (patch: object) => ({ ...OFF, ...patch })).mockRejectedValueOnce(new Error('x'));
    const api = makeSettingsApi({}, { saveSettings });
    const { result } = await renderHook(() => useSettings({ api, onSaved }));
    await waitFor(() => expect(ready(result)).toBe(true));
    await act(async () => { expect(await result.current.toggle('lateContact', true)).toBe(false); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.issue).toEqual({ key: 'lateContact' });
    expect(result.current.state).toEqual({ status: 'ready', values: OFF });
    await act(async () => { expect(await result.current.toggle('lateContact', true)).toBe(true); });
    expect(onSaved).toHaveBeenCalledWith('lateContact', true);
    expect(result.current.issue).toBeNull();
  });
});
