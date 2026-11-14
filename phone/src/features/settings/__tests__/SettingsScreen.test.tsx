import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makeConnection, makePermissions } from '../../../__tests__/support/todaySupport';
import { SettingsScreen } from '../SettingsScreen';

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
const setup = (props: Partial<React.ComponentProps<typeof SettingsScreen>> = {}) =>
  renderWith(<SettingsScreen connectionSource={makeConnection(false)} permissionsSource={makePermissions()} {...props} />);

beforeEach(() => mockPush.mockReset());

describe('설정 탭', () => {
  it('주행 중 고정 안내를 늘 보인다', async () => {
    await setup();
    expect(await screen.findByText('주행 중에는 차곡이 먼저 말하지 않아요.')).toBeOnTheScreen();
  });

  it('차 연결 입구와 캘린더 고르기 입구가 각 화면으로 이어진다', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: '차 연결하기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/pair-car', params: { from: 'tab' } });
    await fireEvent.press(screen.getByRole('button', { name: '캘린더 고르기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/calendar', params: { from: 'tab' } });
  });

  it('스위치(플러스 모드·늦을 때 연락·음성만)와 캘린더에 장소 적기는 두지 않는다', async () => {
    await setup();
    await screen.findByText('주행 중에는 차곡이 먼저 말하지 않아요.');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/플러스|늦을 때|음성만|캘린더에 장소/)).toBeNull();
  });

  it('권한 구역은 켜진 권한을 켜져 있어요로, 꺼진 권한은 켜는 버튼으로 보인다', async () => {
    await setup({ permissionsSource: makePermissions({ calendar: 'granted', camera: 'denied' }) });
    const perms = within(await screen.findByTestId('permission-calendar'));
    expect(perms.getByText('✓ 켜져 있어요')).toBeOnTheScreen();
    expect(within(screen.getByTestId('permission-camera')).getByText(/카메라를 켜면/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '카메라 설정 열기' })).toBeOnTheScreen();
  });

  it('처음부터 권한을 읽지 못하면 오류를 보이고 [다시 확인]으로 복구한다', async () => {
    const read = jest.fn().mockRejectedValueOnce(new Error('native')).mockResolvedValueOnce({ calendar: 'granted', camera: 'granted' });
    await setup({ permissionsSource: makePermissions(undefined, { read }) });
    expect(await screen.findByText('권한을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 확인'));
    expect(await screen.findAllByText('✓ 켜져 있어요')).toHaveLength(2);
  });

  it('로딩: 권한을 기다리는 동안 진행 표시를 보인다', async () => {
    await setup({ permissionsSource: makePermissions(undefined, { read: jest.fn(() => new Promise(() => {})) }) });
    expect(await screen.findByLabelText('권한을 확인하는 중')).toBeOnTheScreen();
  });
});
