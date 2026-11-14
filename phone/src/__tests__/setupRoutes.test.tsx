import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import FillPlacesRoute from '../app/setup/fill-places';
import PairCarRoute from '../app/setup/pair-car';
import { SETUP_DONE_KEY } from '../features/entry/setupGate';
import { PAIRED_CAR_KEY } from '../features/today/carConnection';
import { createMemoryStore } from '../storage/keyValueStore';

// deviceStore를 테스트마다 바꿀 수 있는 메모리 저장소로 돌려 쓴다(import 시점에 값이 굳지 않도록 위임한다).
jest.mock('../storage/keyValueStore', () => {
  const actual = jest.requireActual('../storage/keyValueStore');
  const delegate = { current: actual.createMemoryStore() };
  return {
    ...actual,
    __delegate: delegate,
    deviceStore: {
      get: (key: string) => delegate.current.get(key),
      set: (key: string, value: string) => delegate.current.set(key, value),
      remove: (key: string) => delegate.current.remove(key),
    },
  };
});
const delegate = (jest.requireMock('../storage/keyValueStore') as { __delegate: { current: ReturnType<typeof createMemoryStore> } }).__delegate;
const useStore = (store: ReturnType<typeof createMemoryStore>) => { delegate.current = store; return store; };

const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
let mockCanDismiss = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, dismissAll: mockDismissAll, canDismiss: () => mockCanDismiss }),
}));

const mockClaim = jest.fn();
jest.mock('../features/pair-car/PairCarScreen', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    // 연결 화면 자리: 받은 api로 번호를 보내 본다.
    PairCarScreen: ({ api }: { api: { claim: (code: string, signal: AbortSignal) => Promise<unknown> } }) => (
      <Pressable onPress={() => api.claim('123456', new AbortController().signal).catch(() => {})}><Text>연결 화면</Text></Pressable>
    ),
  };
});
jest.mock('../features/pair-car/pairingApi', () => ({
  pairingApi: { claim: (...args: unknown[]) => mockClaim(...args) },
}));
jest.mock('../features/fill-places/FillPlacesScreen', () => {
  const { Text } = jest.requireActual('react-native');
  return { FillPlacesScreen: () => <Text>3단계 화면</Text> };
});

beforeEach(() => {
  useStore(createMemoryStore());
  mockReplace.mockReset();
  mockDismissAll.mockReset();
  mockClaim.mockReset();
  mockCanDismiss = true;
});

describe('4단계(차 연결) 라우트', () => {
  it('4단계에 닿으면 첫 설정 완료로 표시한다(다음에 앱을 열면 탭으로 간다)', async () => {
    await render(<PairCarRoute />);
    await waitFor(() => expect(delegate.current.dump()[SETUP_DONE_KEY]).toBe('1'));
  });

  it('연결에 성공하면 차 id를 폰에 남기고 결과는 그대로 돌려준다', async () => {
    mockClaim.mockResolvedValue({ carId: 'car-1', pairedAt: '2026-11-06T00:00:00Z' });
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText('연결 화면'));
    await waitFor(() => expect(delegate.current.dump()[PAIRED_CAR_KEY]).toBe('car-1'));
    expect(mockClaim).toHaveBeenCalledWith('123456', expect.any(AbortSignal));
  });

  it('연결에 실패하면 차 id를 남기지 않는다', async () => {
    mockClaim.mockRejectedValue(new Error('404'));
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText('연결 화면'));
    await waitFor(() => expect(mockClaim).toHaveBeenCalled());
    expect(delegate.current.dump()[PAIRED_CAR_KEY]).toBeUndefined();
  });
});

describe('3단계 라우트', () => {
  it('첫 설정 중(표시 없음)에는 3단계 화면을 보인다', async () => {
    await render(<FillPlacesRoute />);
    expect(await screen.findByText('3단계 화면')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('첫 설정이 이미 끝났는데 새로 열리면(4단계 [완료]가 되돌려 보낸 경우) 쌓인 설정 화면을 닫고 탭으로 간다', async () => {
    useStore(createMemoryStore({ [SETUP_DONE_KEY]: '1' }));
    await render(<FillPlacesRoute />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('3단계 화면')).toBeNull();
  });

  it('닫을 화면이 없으면(딥링크로 바로 열림) 닫지 않고 탭으로만 간다', async () => {
    mockCanDismiss = false;
    useStore(createMemoryStore({ [SETUP_DONE_KEY]: '1' }));
    await render(<FillPlacesRoute />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockDismissAll).not.toHaveBeenCalled();
  });
});
