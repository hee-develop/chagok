import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FamilyTabScreen } from '../FamilyTabScreen';
import { GAME, LUNCH, makePermissions, makeScheduleApi } from '../../today/testSupport';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ navigate: mockNavigate }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWith = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);
const setup = (props: Partial<React.ComponentProps<typeof FamilyTabScreen>> = {}) =>
  renderWith(<FamilyTabScreen scheduleApi={makeScheduleApi()} permissionsSource={makePermissions()} {...props} />);

beforeEach(() => mockNavigate.mockReset());

describe('가족 탭', () => {
  it('보내기 입구는 오늘 탭의 일정으로 보낸다', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: '일정 고르러 가기' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('정상: 이미 보낸 요청을 일정 제목과 함께 전달됨으로 보인다', async () => {
    await setup();
    const row = within(await screen.findByTestId('family-sent-game:mom'));
    expect(row.getByText('엄마에게 전달됨')).toBeOnTheScreen();
    expect(row.getByText('KIA 직관')).toBeOnTheScreen();
  });

  it('가족 묶기·요청 받기는 다음 묶음이라 자리만 있다', async () => {
    await setup();
    expect(within(screen.getByTestId('family-group')).getByText('가족을 묶고 요청을 받는 기능은 곧 만나요.')).toBeOnTheScreen();
  });

  it('빈 상태: 보낸 요청이 없으면 안내한다', async () => {
    await setup({ scheduleApi: makeScheduleApi([LUNCH]) });
    expect(await screen.findByText('아직 보낸 요청이 없어요.')).toBeOnTheScreen();
  });

  it('로딩: 기다리는 동안 진행 표시를 보인다', async () => {
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules: jest.fn(() => new Promise(() => {})) }) });
    expect(await screen.findByLabelText('보낸 요청을 불러오는 중')).toBeOnTheScreen();
  });

  it('오류: 다시 시도로 복구한다', async () => {
    const fetchSchedules = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ anchor: '2026-11-06T00:30:00Z', schedules: [GAME] });
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules }) });
    expect(await screen.findByText('보낸 요청을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText('엄마에게 전달됨')).toBeOnTheScreen();
  });

  it('권한 없음: 캘린더가 꺼져 있으면 요청하지 않고 켜기를 안내한다', async () => {
    const api = makeScheduleApi();
    await setup({ scheduleApi: api, permissionsSource: makePermissions({ calendar: 'ask', camera: 'granted' }) });
    expect(await screen.findByText('캘린더를 켜면 보낸 요청을 볼 수 있어요.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '캘린더 켜기' })).toBeOnTheScreen();
    expect(api.fetchSchedules).not.toHaveBeenCalled();
  });
});
