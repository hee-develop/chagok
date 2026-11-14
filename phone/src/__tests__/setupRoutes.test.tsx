import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CalendarRoute from '../app/setup/calendar';
import FillPlacesRoute from '../app/setup/fill-places';
import PairCarRoute from '../app/setup/pair-car';
import { isSetupDone, resetSetupDoneForTests, SETUP_DONE_KEY } from '../features/entry/setupGate';
import { createMemoryStore } from '../storage/keyValueStore';

// deviceStore를 테스트마다 바꿀 수 있는 메모리 저장소로 돌려 쓴다(import 시점에 값이 굳지 않도록 위임한다).
jest.mock('../storage/keyValueStore', () => {
  const actual = jest.requireActual('../storage/keyValueStore');
  const delegate = { current: actual.createMemoryStore() };
  return {
    ...actual,
    __delegate: delegate,
    deviceStore: {
      getItem: (key: string) => delegate.current.getItem(key),
      setItem: (key: string, value: string) => delegate.current.setItem(key, value),
      removeItem: (key: string) => delegate.current.removeItem(key),
    },
  };
});
const delegate = (jest.requireMock('../storage/keyValueStore') as { __delegate: { current: ReturnType<typeof createMemoryStore> } }).__delegate;
const useStore = (store: ReturnType<typeof createMemoryStore>) => { delegate.current = store; return store; };

const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
let mockCanDismiss = true;
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, dismissAll: mockDismissAll, canDismiss: () => mockCanDismiss }),
  useLocalSearchParams: () => mockParams,
}));

// 연결 화면 자리: 받은 선택 속성을 버튼으로 드러낸다.
jest.mock('../features/pair-car/PairCarScreen', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    PairCarScreen: ({ onSkip, onDone, standalone, onPaired }: { onSkip?: () => void; onDone?: () => void; standalone?: boolean; onPaired?: () => void }) => (
      <View>
        <Text>{standalone ? '연결 화면(탭에서 연 것)' : '연결 화면(첫 설정)'}</Text>
        {onPaired ? <Pressable onPress={onPaired}><Text>연결 성공</Text></Pressable> : null}
        {onSkip ? <Pressable onPress={onSkip}><Text>건너뛰기</Text></Pressable> : null}
        {onDone ? <Pressable onPress={onDone}><Text>완료</Text></Pressable> : null}
      </View>
    ),
  };
});
const mockAskNotification = jest.fn();
jest.mock('../features/notifications/permission', () => ({
  askNotificationPermissionOnce: (...args: unknown[]) => mockAskNotification(...args),
}));
jest.mock('../features/calendar-select/CalendarSelectScreen', () => {
  const { Text } = jest.requireActual('react-native');
  return { CalendarSelectScreen: ({ standalone }: { standalone?: boolean }) => <Text>{standalone ? '캘린더(탭에서 연 것)' : '캘린더(첫 설정)'}</Text> };
});
jest.mock('../features/calendar-sync/eventSync', () => ({ appEventSync: { rememberSelection: jest.fn(), run: jest.fn() } }));
jest.mock('../features/fill-places/FillPlacesScreen', () => {
  const { Text } = jest.requireActual('react-native');
  return { FillPlacesScreen: () => <Text>3단계 화면</Text> };
});

beforeEach(() => {
  useStore(createMemoryStore());
  resetSetupDoneForTests();
  mockReplace.mockReset();
  mockDismissAll.mockReset();
  mockCanDismiss = true;
  mockParams = {};
  mockAskNotification.mockReset();
  mockAskNotification.mockResolvedValue('granted');
});

describe('4단계(차 연결) 라우트: 연결하지 않아도 홈으로 간다', () => {
  it('4단계에 닿기만 해서는 첫 설정 완료로 표시하지 않는다', async () => {
    await render(<PairCarRoute />);
    expect(screen.getByText('연결 화면(첫 설정)')).toBeOnTheScreen();
    expect(delegate.current.dump()[SETUP_DONE_KEY]).toBeUndefined();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('연결 전 [건너뛰기]: 완료 표시를 남기고 설정 화면을 모두 닫아 탭(오늘)으로 간다', async () => {
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText('건너뛰기'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(delegate.current.dump()[SETUP_DONE_KEY]).toBe('1');
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
  });

  it('연결 뒤 [완료]도 같다(3단계로 되돌아가지 않는다)', async () => {
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText('완료'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockReplace).not.toHaveBeenCalledWith('/setup/fill-places');
    expect(delegate.current.dump()[SETUP_DONE_KEY]).toBe('1');
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
  });

  it.each([['건너뛰기'], ['완료']])('[%s]는 완료 표시 뒤 알림 권한을 한 번 묻고(정책 10.4 첫 설정 끝) 그 창을 기다리지 않고 탭으로 간다', async (label) => {
    mockAskNotification.mockReturnValue(new Promise(() => {})); // 사용자가 창에 답할 때까지 끝나지 않는다
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText(label));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockAskNotification).toHaveBeenCalledTimes(1);
    expect(delegate.current.dump()[SETUP_DONE_KEY]).toBe('1');
  });

  it('알림 권한 요청이 던져도(거부·오류) 탭으로 가는 데 영향이 없다', async () => {
    mockAskNotification.mockRejectedValue(new Error('denied'));
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText('건너뛰기'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('닫을 화면이 없으면(탭이 처음부터 첫 설정으로 보낸 경우) 닫지 않고 탭으로만 간다', async () => {
    mockCanDismiss = false;
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText('건너뛰기'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockDismissAll).not.toHaveBeenCalled();
  });

  it('완료 표시를 저장하지 못해도 이번 실행에서는 탭으로 간다(메모리 표시)', async () => {
    useStore({ ...createMemoryStore(), setItem: () => Promise.reject(new Error('storage')) } as ReturnType<typeof createMemoryStore>);
    await render(<PairCarRoute />);
    await fireEvent.press(screen.getByText('건너뛰기'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    // 탭이 새로 열려 표시를 읽을 때 이번 실행에서는 끝난 것으로 읽는다.
    expect(await isSetupDone(createMemoryStore())).toBe(true);
  });

  it('탭에서 연 화면(from=tab)은 연결에 성공했을 때 알림 권한을 한 번 묻고, 첫 설정 선택 속성을 주지 않아 건너뛰기·완료 표시가 없다', async () => {
    mockParams = { from: 'tab' };
    await render(<PairCarRoute />);
    expect(screen.getByText('연결 화면(탭에서 연 것)')).toBeOnTheScreen();
    expect(mockAskNotification).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('연결 성공'));
    expect(mockAskNotification).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('건너뛰기')).toBeNull();
    expect(screen.queryByText('완료')).toBeNull();
    expect(delegate.current.dump()[SETUP_DONE_KEY]).toBeUndefined();
  });
});

describe('3단계 라우트', () => {
  it('완료 표시가 이미 있어도 화면을 그대로 보이고 어디로도 보내지 않는다(빈 화면·엉뚱한 탭 이동이 없다)', async () => {
    useStore(createMemoryStore({ [SETUP_DONE_KEY]: '1' }));
    await render(<FillPlacesRoute />);
    expect(screen.getByText('3단계 화면')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissAll).not.toHaveBeenCalled();
  });
});

describe('1단계(캘린더) 라우트', () => {
  it('첫 설정에서는 단계 표시가 있는 화면이고, 설정 탭에서 열면(from=tab) standalone이다', async () => {
    const { unmount } = await render(<CalendarRoute />);
    expect(screen.getByText('캘린더(첫 설정)')).toBeOnTheScreen();
    await unmount();
    mockParams = { from: 'tab' };
    await render(<CalendarRoute />);
    expect(screen.getByText('캘린더(탭에서 연 것)')).toBeOnTheScreen();
  });
});
