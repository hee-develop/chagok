import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FamilySendScreen } from '../../family/FamilySendScreen';
import { ScheduleCareScreen } from '../../fill-places/ScheduleCareScreen';
import { PlaceSearchScreen } from '../../places/PlaceSearchScreen';
import { makeApi as makePlacesApi } from '../../places/testSupport';
import { makeScheduleApi } from '../../../__tests__/support/todaySupport';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWith = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);
const familyApi = { fetchMembers: jest.fn().mockResolvedValue([]), fetchRequests: jest.fn().mockResolvedValue([]), send: jest.fn() };

beforeEach(() => {
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack = true;
});

describe('오늘·장소 탭에서 연 화면(standalone)은 첫 설정 단계 표시를 빼고 열었던 자리로 돌아간다', () => {
  it('채비: 단계 표시가 없고, 되돌아갈 곳이 없으면 오늘 탭으로 간다', async () => {
    mockCanGoBack = false;
    await renderWith(<ScheduleCareScreen standalone scheduleId="lunch" title="육전집 점심" initialCare="" api={makeScheduleApi()} />);
    expect(screen.queryByText('3 / 4')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('채비: 첫 설정에서 열면(기본) 3 / 4 표시와 3단계로 돌아가는 동작이 그대로다', async () => {
    mockCanGoBack = false;
    await renderWith(<ScheduleCareScreen scheduleId="lunch" title="육전집 점심" initialCare="" api={makeScheduleApi()} />);
    expect(screen.getByText('3 / 4')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(mockReplace).toHaveBeenCalledWith('/setup/fill-places');
  });

  it('가족에게 보내기: 단계 표시가 없고, 되돌아갈 곳이 없으면 오늘 탭으로 간다', async () => {
    mockCanGoBack = false;
    await renderWith(<FamilySendScreen standalone scheduleId="lunch" title="육전집 점심" api={familyApi} />);
    expect(screen.queryByText('3 / 4')).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: '완료' }));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('일정 장소 검색: 단계 표시가 없다', async () => {
    await renderWith(<PlaceSearchScreen standalone scheduleId="lunch" scheduleApi={makeScheduleApi()} api={makePlacesApi()} />);
    expect(screen.queryByText('3 / 4')).toBeNull();
    expect(screen.getByText('일정 장소 찾기')).toBeOnTheScreen();
  });

  it('자주 가는 곳 검색: 단계 표시가 없고 되돌아갈 곳이 없으면 오늘 탭으로 간다', async () => {
    mockCanGoBack = false;
    await renderWith(<PlaceSearchScreen standalone target="home" scheduleApi={makeScheduleApi()} api={makePlacesApi()} />);
    expect(screen.queryByText('2 / 4')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
