import { render, screen } from '@testing-library/react-native';

import TabsLayout from '../app/(tabs)/_layout';
import { markSetupDone, resetSetupDoneForTests, SETUP_DONE_KEY } from '../features/entry/setupGate';
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
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return { Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text> };
});
jest.mock('expo-router/js-tabs', () => {
  const { Text, View } = jest.requireActual('react-native');
  function Tabs({ children }: { children: unknown }) {
    return <View testID="tabs">{children as never}</View>;
  }
  Tabs.Screen = function Screen({ name, options }: { name: string; options: { title: string; tabBarButtonTestID: string } }) {
    return <Text testID={options.tabBarButtonTestID}>{`${name}:${options.title}`}</Text>;
  };
  return { Tabs };
});

beforeEach(() => {
  useStore(createMemoryStore());
  resetSetupDoneForTests();
});

describe('앱을 열 때 탭과 첫 설정을 가른다', () => {
  it('첫 설정을 끝냈거나 건너뛴 기기는 탭 네 개로 들어간다(오늘·가족·장소·설정 순서)', async () => {
    useStore(createMemoryStore({ [SETUP_DONE_KEY]: '1' }));
    await render(<TabsLayout />);
    expect(await screen.findByTestId('tabs')).toBeOnTheScreen();
    expect(screen.getByTestId('tabbar-today')).toHaveTextContent('index:오늘');
    expect(screen.getByTestId('tabbar-family')).toHaveTextContent('family:가족');
    expect(screen.getByTestId('tabbar-places')).toHaveTextContent('places:장소');
    expect(screen.getByTestId('tabbar-settings')).toHaveTextContent('settings:설정');
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });

  it('처음이면 기존 첫 설정 흐름(1단계 캘린더)으로 보낸다', async () => {
    await render(<TabsLayout />);
    expect(await screen.findByText('redirect:/setup/calendar')).toBeOnTheScreen();
    expect(screen.queryByTestId('tabs')).toBeNull();
  });

  it('저장소에 쓰지 못했어도 이번 실행에서 끝냈으면(4단계 건너뛰기·완료) 새로 연 탭이 첫 설정으로 되돌리지 않는다', async () => {
    useStore({ ...createMemoryStore(), set: () => Promise.reject(new Error('storage')) } as ReturnType<typeof createMemoryStore>);
    await markSetupDone();
    await render(<TabsLayout />);
    expect(await screen.findByTestId('tabs')).toBeOnTheScreen();
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });

  it('저장소를 읽는 동안에는 탭도 첫 설정도 보이지 않는다(깜빡임 방지)', async () => {
    useStore({ ...createMemoryStore(), get: () => new Promise(() => {}) } as ReturnType<typeof createMemoryStore>);
    await render(<TabsLayout />);
    expect(screen.getByTestId('entry-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('tabs')).toBeNull();
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });
});
