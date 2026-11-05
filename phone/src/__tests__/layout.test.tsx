import { render, screen } from '@testing-library/react-native';

import * as SplashScreen from 'expo-splash-screen';

import RootLayout from '../app/_layout';

const mockUseFonts = jest.fn();

jest.mock('expo-font', () => ({ useFonts: (...args: unknown[]) => mockUseFonts(...args) }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hide: jest.fn() }));
jest.mock('expo-router', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { Stack: () => <T>화면</T> };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: unknown }) => children }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

beforeEach(() => {
  mockUseFonts.mockReset();
  (SplashScreen.hide as jest.Mock).mockReset();
});

describe('RootLayout 글꼴 로딩', () => {
  it('로딩 중에는 화면을 그리지 않고 스플래시를 유지한다', async () => {
    mockUseFonts.mockReturnValue([false, null]);
    await render(<RootLayout />);
    expect(screen.queryByText('화면')).toBeNull();
    expect(SplashScreen.hide).not.toHaveBeenCalled();
  });

  it('로드되면 화면을 그리고 스플래시를 내린다', async () => {
    mockUseFonts.mockReturnValue([true, null]);
    await render(<RootLayout />);
    expect(screen.getByText('화면')).toBeOnTheScreen();
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });

  it('로드에 실패해도 화면을 그리고 스플래시를 내린다', async () => {
    mockUseFonts.mockReturnValue([false, new Error('font')]);
    await render(<RootLayout />);
    expect(screen.getByText('화면')).toBeOnTheScreen();
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });
});
