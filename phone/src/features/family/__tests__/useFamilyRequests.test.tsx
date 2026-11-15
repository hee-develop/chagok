import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { makeFamilyApi, receivedCare, sentCare, sentStop } from '../../../__tests__/support/familySupport';
import { createMemberSession, type MemberStorage } from '../memberSecret';
import { REQUESTS_POLL_MS, useFamilyRequests } from '../useFamilyRequests';

// 화면이 포커스를 얻은 것으로 본다(탭이 열려 있음).
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});

const setAppState = (state: string | undefined) => {
  (AppState as unknown as { currentState: string | undefined }).currentState = state;
};
/** AppState 변화 리스너를 잡아 테스트가 직접 부른다. */
const captureAppState = () => {
  const listeners: ((state: string) => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    listeners.push(h);
    return { remove: () => listeners.splice(listeners.indexOf(h), 1) };
  }) as never);
  return { emit: (state: string) => listeners.slice().forEach((l) => l(state)), count: () => listeners.length, spy };
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const memory = (): MemberStorage => ({ read: async () => null, write: async () => undefined, remove: async () => undefined });

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setAppState(undefined);
});

describe('useFamilyRequests: 읽기', () => {
  it('포커스를 얻으면 읽어 보낸·받은 요청을 돌려준다', async () => {
    const api = makeFamilyApi({ fetchRequests: jest.fn().mockResolvedValue({ sent: [sentCare()], received: [receivedCare()] }) });
    const { result } = await renderHook(() => useFamilyRequests({ api, intervalMs: 0 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(api.fetchRequests).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result.current.state).toMatchObject({ sent: [{ id: 'r-care' }], received: [{ id: 'in-care' }] });
  });

  it('enabled가 false면 요청하지 않는다', async () => {
    const api = makeFamilyApi();
    await renderHook(() => useFamilyRequests({ api, enabled: false, intervalMs: 0 }));
    expect(api.fetchRequests).not.toHaveBeenCalled();
  });

  it('처음 읽기가 실패하면 오류이고 다시 시도로 복구한다', async () => {
    const fetchRequests = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ sent: [sentCare()], received: [] });
    const api = makeFamilyApi({ fetchRequests });
    const { result } = await renderHook(() => useFamilyRequests({ api, intervalMs: 0 }));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
  });

  it('이미 목록이 있으면 다시 읽다 실패해도 그대로 둔다(오류로 깜빡이지 않는다)', async () => {
    const fetchRequests = jest.fn().mockResolvedValueOnce({ sent: [sentCare()], received: [] }).mockRejectedValue(new Error('offline'));
    const api = makeFamilyApi({ fetchRequests });
    const { result } = await renderHook(() => useFamilyRequests({ api, intervalMs: 0 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(fetchRequests).toHaveBeenCalledTimes(2));
    expect(result.current.state.status).toBe('ready');
  });

  it('새 조회가 시작되면 이전 조회는 취소되고, 늦게 온 이전 응답은 화면에 반영하지 않는다', async () => {
    const first = deferred<{ sent: never[]; received: never[] }>();
    const signals: AbortSignal[] = [];
    const fetchRequests = jest.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : Promise.resolve({ sent: [sentStop()], received: [] });
    });
    const api = makeFamilyApi({ fetchRequests });
    const { result } = await renderHook(() => useFamilyRequests({ api, intervalMs: 0 }));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'ready', sent: [{ id: 'r-stop' }] }));
    expect(signals[0]!.aborted).toBe(true);
    // 취소된 첫 요청이 뒤늦게 비어 있는 목록으로 끝나도 덮어쓰지 않는다
    await act(async () => first.resolve({ sent: [], received: [] }));
    expect(result.current.state).toMatchObject({ status: 'ready', sent: [{ id: 'r-stop' }] });
  });

  it('화면이 내려가면(언마운트) 진행 중인 조회를 취소한다', async () => {
    let signal: AbortSignal | undefined;
    const api = makeFamilyApi({ fetchRequests: jest.fn((s: AbortSignal) => { signal = s; return new Promise(() => {}); }) });
    const { unmount } = await renderHook(() => useFamilyRequests({ api, intervalMs: 0 }));
    await waitFor(() => expect(signal).toBeDefined());
    await unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('가족에서 나가 비밀값이 지워지면 옛 목록을 비운다', async () => {
    const member = createMemberSession(memory());
    const api = makeFamilyApi({ fetchRequests: jest.fn().mockResolvedValue({ sent: [sentCare()], received: [receivedCare()] }) });
    const { result } = await renderHook(() => useFamilyRequests({ api, member, intervalMs: 0 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await member.set('s'.repeat(64));
    await act(async () => { await member.clear('gone'); });
    expect(result.current.state).toEqual({ status: 'ready', sent: [], received: [] });
  });
});

describe('useFamilyRequests: 앞에 있는 동안 주기적으로 다시 읽기', () => {
  it('기본 주기는 알림 폴링(60초)과 박자가 겹치지 않는 45초다', () => {
    expect(REQUESTS_POLL_MS).toBe(45_000);
    expect(60_000 % REQUESTS_POLL_MS).not.toBe(0);
    expect(REQUESTS_POLL_MS % 60_000).not.toBe(0);
  });

  it('앱이 앞(active)이면 주기마다 읽고, 뒤로 가면 멈추고, 앞으로 오면 바로 읽고 이어 간다', async () => {
    jest.useFakeTimers();
    setAppState('active');
    const app = captureAppState();
    const api = makeFamilyApi();
    await renderHook(() => useFamilyRequests({ api, intervalMs: 1000 }));
    await act(async () => { await Promise.resolve(); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(2);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(4);

    await act(async () => app.emit('background'));
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(4);

    await act(async () => app.emit('active'));
    expect(api.fetchRequests).toHaveBeenCalledTimes(5);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(6);
  });

  it('뒤에서 열렸으면 처음 한 번만 읽고 앞으로 올 때 주기를 시작한다', async () => {
    jest.useFakeTimers();
    setAppState('background');
    const app = captureAppState();
    const api = makeFamilyApi();
    await renderHook(() => useFamilyRequests({ api, intervalMs: 1000 }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(1);
    await act(async () => app.emit('active'));
    expect(api.fetchRequests).toHaveBeenCalledTimes(2);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(3);
  });

  it('마지막 응답이 가족 없음(family: false)이면 주기 조회를 돌리지 않고, 가족이 생기면(set) 다시 돈다. 포커스·직접 읽기는 그대로 읽는다', async () => {
    jest.useFakeTimers();
    setAppState('active');
    captureAppState();
    const member = createMemberSession(memory());
    const fetchRequests = jest.fn().mockResolvedValue({ sent: [], received: [], family: false });
    const api = makeFamilyApi({ fetchRequests });
    const { result } = await renderHook(() => useFamilyRequests({ api, member, intervalMs: 1000 }));
    await act(async () => { await Promise.resolve(); });
    expect(fetchRequests).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(fetchRequests).toHaveBeenCalledTimes(1);
    // 직접 읽기는 읽는다
    await act(async () => result.current.refresh());
    expect(fetchRequests).toHaveBeenCalledTimes(2);
    // 가족이 생기면(구성원 비밀값 저장) 주기 조회가 다시 돈다
    fetchRequests.mockResolvedValue({ sent: [], received: [], family: true });
    await act(async () => { await member.set('s'.repeat(64)); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(fetchRequests).toHaveBeenCalledTimes(3);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(fetchRequests).toHaveBeenCalledTimes(4);
  });

  it('응답을 화면에 반영할 때마다 reads가 늘어난다(취소된 응답은 세지 않는다)', async () => {
    const first = deferred<{ sent: never[]; received: never[] }>();
    let n = 0;
    const fetchRequests = jest.fn(() => (++n === 1 ? first.promise : Promise.resolve({ sent: [], received: [] })));
    const api = makeFamilyApi({ fetchRequests });
    const { result } = await renderHook(() => useFamilyRequests({ api, intervalMs: 0 }));
    expect(result.current.reads).toBe(0);
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.reads).toBe(1));
    await act(async () => first.resolve({ sent: [], received: [] }));
    expect(result.current.reads).toBe(1);
  });

  it('화면이 내려가면 주기와 앱 상태 리스너를 모두 정리한다', async () => {
    jest.useFakeTimers();
    setAppState('active');
    const app = captureAppState();
    const api = makeFamilyApi();
    const { unmount } = await renderHook(() => useFamilyRequests({ api, intervalMs: 1000 }));
    await act(async () => { await Promise.resolve(); });
    expect(app.count()).toBe(1);
    await unmount();
    expect(app.count()).toBe(0);
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(api.fetchRequests).toHaveBeenCalledTimes(1);
  });
});
