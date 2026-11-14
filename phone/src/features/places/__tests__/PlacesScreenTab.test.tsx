import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlacesScreen } from '../PlacesScreen';
import { APT, EMPTY, makeApi } from '../testSupport';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWith = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);

beforeEach(() => mockPush.mockReset());

describe('PlacesScreen 장소 탭 모드', () => {
  it('첫 설정의 단계 표시와 다음·건너뛰기는 없고 자주 가는 곳은 그대로 보인다', async () => {
    await renderWith(<PlacesScreen mode="tab" api={makeApi({}, { ...EMPTY, home: APT })} />);
    expect(await screen.findByText('자주 가는 곳을 알려주세요')).toBeOnTheScreen();
    expect(screen.getByText(`${APT.name} · ${APT.address}`)).toBeOnTheScreen();
    expect(screen.queryByText('2 / 4')).toBeNull();
    expect(screen.queryByTestId('progress-bar-filled')).toBeNull();
    expect(screen.queryByText('다음')).toBeNull();
    expect(screen.queryByText('건너뛰기')).toBeNull();
  });

  it('검색 화면을 단계 표시 없는 출처(from=tab)로 연다', async () => {
    await renderWith(<PlacesScreen mode="tab" api={makeApi()} />);
    await fireEvent.press(await screen.findByRole('button', { name: '집, 주소 미설정' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/place-search', params: { target: 'home', from: 'tab' } });
  });

  it('기억한 장소·이동 없음 목록은 다음 묶음이 채울 자리만 둔다', async () => {
    await renderWith(<PlacesScreen mode="tab" api={makeApi()} />);
    await screen.findByText('기억한 장소');
    expect(screen.getByText('일정 제목으로 기억한 장소가 생기면 여기에 모여요.')).toBeOnTheScreen();
    expect(screen.getByText('이동 없음으로 둔 일정')).toBeOnTheScreen();
    expect(screen.getByText('이동 없음으로 둔 일정이 생기면 여기에 모여요.')).toBeOnTheScreen();
  });

  it('첫 설정 모드(기본)에는 자리 구역이 없다', async () => {
    await renderWith(<PlacesScreen api={makeApi()} />);
    await screen.findByText('2 / 4');
    expect(screen.queryByText('기억한 장소')).toBeNull();
  });
});
