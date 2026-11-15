import { act, renderHook, waitFor } from '@testing-library/react-native';

import { FAMILY, makeFamilyApi } from '../../../__tests__/support/familySupport';
import { FamilyHttpError } from '../familyGroupApi';
import { createMemberSession, type MemberStorage } from '../memberSecret';
import { issueMessage, useFamilyGroup } from '../useFamilyGroup';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};
const memory = (): MemberStorage => ({ read: async () => null, write: async () => undefined, remove: async () => undefined });

describe('useFamilyGroup', () => {
  it('저장은 한 번에 하나만 보낸다(저장 중에 다시 부르면 아무것도 하지 않고 false)', async () => {
    const d = deferred<typeof FAMILY>();
    const api = makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite: jest.fn(() => d.promise) });
    const { result } = await renderHook(() => useFamilyGroup({ api }));
    await waitFor(() => expect(result.current.state.status).toBe('none'));
    let first!: Promise<boolean>;
    await act(async () => { first = result.current.create('아빠'); });
    expect(result.current.busy).toBe(true);
    expect(result.current.action).toEqual({ kind: 'create' });
    let second = true;
    await act(async () => { second = await result.current.remakeInvite(); });
    expect(second).toBe(false);
    expect(api.invite).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(FAMILY); await first; });
    expect(result.current.busy).toBe(false);
    expect(result.current.state.status).toBe('ready');
  });

  it('저장이 시작되면 진행 중인 조회를 취소해, 늦게 온 조회 응답이 저장 결과를 덮어쓰지 않는다', async () => {
    const slow = deferred<null>();
    let loadSignal: AbortSignal | undefined;
    const fetchFamily = jest.fn((signal: AbortSignal) => { loadSignal = signal; return slow.promise; });
    const api = makeFamilyApi({ fetchFamily, invite: jest.fn().mockResolvedValue(FAMILY) });
    const { result } = await renderHook(() => useFamilyGroup({ api }));
    await waitFor(() => expect(loadSignal).toBeDefined());
    await act(async () => { await result.current.create('아빠'); });
    expect(loadSignal!.aborted).toBe(true);
    expect(result.current.state.status).toBe('ready');
    await act(async () => slow.resolve(null)); // 취소된 조회가 가족 없음으로 끝나도 저장 결과를 덮어쓰지 않는다
    expect(result.current.state.status).toBe('ready');
  });

  it('화면이 사라져도 보낸 저장은 취소하지 않는다(만들기 응답에만 있는 비밀값을 놓치지 않게)', async () => {
    const d = deferred<typeof FAMILY>();
    let signal: AbortSignal | undefined;
    const api = makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite: jest.fn((_name: string | undefined, s: AbortSignal) => { signal = s; return d.promise; }) });
    const { result, unmount } = await renderHook(() => useFamilyGroup({ api }));
    await waitFor(() => expect(result.current.state.status).toBe('none'));
    let saving!: Promise<boolean>;
    await act(async () => { saving = result.current.create('아빠'); });
    await unmount();
    expect(signal!.aborted).toBe(false);
    await act(async () => { d.resolve(FAMILY); });
    await expect(saving).resolves.toBe(true);
  });

  it('조회가 실패하면 오류이고 다시 시도하면 읽는다. 이미 읽은 가족이 있으면 다시 읽다 실패해도 그대로다', async () => {
    const fetchFamily = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(FAMILY).mockRejectedValue(new Error('offline'));
    const api = makeFamilyApi({ fetchFamily });
    const { result } = await renderHook(() => useFamilyGroup({ api }));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    // 이름 바꾸기 뒤 다시 읽기가 실패해도 이미 있는 가족 화면은 유지되고 안내가 뜬다
    await act(async () => { await result.current.rename('새 이름'); });
    expect(result.current.state.status).toBe('ready');
    expect(result.current.issue).toMatchObject({ action: 'rename' });
  });

  it('비밀값이 지워지면 이유와 함께 가족이 없는 상태로 돌아간다', async () => {
    const member = createMemberSession(memory());
    const api = makeFamilyApi();
    const { result } = await renderHook(() => useFamilyGroup({ api, member }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await member.set('s'.repeat(64));
    await act(async () => { await member.clear('gone'); });
    expect(result.current.state).toEqual({ status: 'none', notice: 'gone' });
  });

  it('가족을 읽는데 가족이 없으면(401·null) 나온 직후가 아니면 안내 없이 가족 없음이다', async () => {
    const api = makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null) });
    const { result } = await renderHook(() => useFamilyGroup({ api }));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'none', notice: null }));
  });

  it('이미 가족이거나 가족이 없다는 거절은 가족을 다시 읽어 맞춘다', async () => {
    const fetchFamily = jest.fn().mockResolvedValue(FAMILY);
    const rename = jest.fn().mockRejectedValue(new FamilyHttpError(404, 'PUT /family/me', { reason: 'not-in-family', retryAfterSeconds: null, message: null }));
    const api = makeFamilyApi({ fetchFamily, rename });
    const { result } = await renderHook(() => useFamilyGroup({ api }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => { await result.current.rename('아빠 2'); });
    await waitFor(() => expect(fetchFamily).toHaveBeenCalledTimes(2));
  });
});

describe('useFamilyGroup: 만들기·참여는 시간 제한으로 끊지 않는다(구성원 비밀값을 놓치지 않으려고)', () => {
  const abortable = (signal: AbortSignal, pending: Promise<typeof FAMILY>) =>
    Promise.race([pending, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))]);

  it.each(['create', 'join'] as const)('%s: 시간 제한이 지나도 요청을 끊지 않고 \'확인 중\'(slow)으로 바꾸며, 늦게 온 응답도 화면에 반영한다', async (kind) => {
    const d = deferred<typeof FAMILY>();
    let signal: AbortSignal | undefined;
    const handler = jest.fn((...args: unknown[]) => { signal = args.at(-1) as AbortSignal; return abortable(signal, d.promise); });
    const api = makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite: handler, join: handler });
    const { result } = await renderHook(() => useFamilyGroup({ api, timeoutMs: 20 }));
    await waitFor(() => expect(result.current.state.status).toBe('none'));
    let saving!: Promise<boolean>;
    await act(async () => { saving = kind === 'create' ? result.current.create('아빠') : result.current.join('ABCD-EFGH', '엄마'); });
    expect(result.current.slow).toBe(false);
    await waitFor(() => expect(result.current.slow).toBe(true));
    expect(signal!.aborted).toBe(false);
    expect(result.current.busy).toBe(true);
    // 확인 중에는 같은 동작도 다른 동작도 다시 누를 수 없다
    let again = true;
    await act(async () => { again = await (kind === 'create' ? result.current.create('아빠') : result.current.join('ABCD-EFGH', '엄마')); });
    expect(again).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(FAMILY); await saving; });
    await expect(saving).resolves.toBe(true);
    expect(result.current.state).toMatchObject({ status: 'ready' });
    expect(result.current.slow).toBe(false);
    expect(result.current.issue).toBeNull();
  });

  it('새 초대 코드 만들기도 끊지 않는다', async () => {
    const d = deferred<typeof FAMILY>();
    let signal: AbortSignal | undefined;
    const api = makeFamilyApi({ invite: jest.fn((_n: string | undefined, s: AbortSignal) => { signal = s; return d.promise; }) });
    const { result } = await renderHook(() => useFamilyGroup({ api, timeoutMs: 20 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    let saving!: Promise<boolean>;
    await act(async () => { saving = result.current.remakeInvite(); });
    await waitFor(() => expect(result.current.slow).toBe(true));
    expect(signal!.aborted).toBe(false);
    await act(async () => { d.resolve(FAMILY); await saving; });
  });

  it('아주 오래 응답이 없으면(giveUpMs) 포기하고 이미 처리됐을 수 있다고 안내한다', async () => {
    const never = new Promise<typeof FAMILY>(() => {});
    const api = makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite: jest.fn((_n: string | undefined, s: AbortSignal) => abortable(s, never)) });
    const { result } = await renderHook(() => useFamilyGroup({ api, timeoutMs: 10, giveUpMs: 60 }));
    await waitFor(() => expect(result.current.state.status).toBe('none'));
    await act(async () => { await result.current.create('아빠'); });
    expect(result.current.issue).toEqual({ message: '응답을 확인하지 못했어요. 이미 처리됐을 수 있으니 가족 탭을 다시 열어 확인한 뒤 다시 해 주세요.', action: 'create' });
    expect(result.current.busy).toBe(false);
    expect(result.current.slow).toBe(false);
  });

  it('이름 바꾸기·공유는 그대로 시간 제한(timeoutMs)에 끊는다', async () => {
    let signal: AbortSignal | undefined;
    const api = makeFamilyApi({ rename: jest.fn((_n: string, s: AbortSignal) => { signal = s; return new Promise<void>(() => {}); }) });
    const { result } = await renderHook(() => useFamilyGroup({ api, timeoutMs: 30 }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => { await result.current.rename('새 이름'); });
    expect(signal!.aborted).toBe(true);
    expect(result.current.issue).toMatchObject({ action: 'rename' });
  });
});

describe('useFamilyGroup: 구성원 비밀값 저장 실패 안내', () => {
  it('저장소에 쓰지 못하면 storageIssue를 켜고, 다시 저장에 성공하거나 비밀값이 지워지면 끈다', async () => {
    let failing = true;
    const member = createMemberSession({ read: async () => null, write: async () => { if (failing) throw new Error('keystore'); }, remove: async () => undefined });
    const api = makeFamilyApi();
    const { result } = await renderHook(() => useFamilyGroup({ api, member }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.storageIssue).toBe(false);
    await act(async () => { await member.set('s'.repeat(64)); });
    expect(result.current.storageIssue).toBe(true);
    failing = false;
    await act(async () => { await member.set('t'.repeat(64)); });
    expect(result.current.storageIssue).toBe(false);
    failing = true;
    await act(async () => { await member.set('u'.repeat(64)); });
    expect(result.current.storageIssue).toBe(true);
    await act(async () => { await member.clear('left'); });
    expect(result.current.storageIssue).toBe(false);
  });
});

describe('동작 실패 문구', () => {
  const err = (status: number, reason: string, retryAfterSeconds: number | null = null) => new FamilyHttpError(status, 'x', { reason, retryAfterSeconds, message: null });
  it('만들기·참여·초대 코드 실패를 이유로 가른다', () => {
    expect(issueMessage('create', err(429, 'too-many-families'))).toBe('지금은 새 가족을 만들 수 없어요. 잠시 뒤 다시 해 주세요.');
    expect(issueMessage('create', new Error('offline'))).toBe('가족을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(issueMessage('join', err(429, 'locked'))).toBe('초대 코드를 너무 많이 틀렸어요. 60초 뒤에 다시 해 주세요.');
    expect(issueMessage('join', new Error('offline'))).toBe('참여하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(issueMessage('invite', err(409, 'family-full'))).toBe('가족 인원이 가득 차서 더 초대할 수 없어요.');
    expect(issueMessage('invite', err(429, 'rate-limited'))).toBe('코드를 너무 자주 만들었어요. 잠시 뒤 다시 해 주세요.');
    expect(issueMessage('share', err(404, 'unknown-member'))).toBe('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  });
});
