import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { deliverPlace, listenForPlace } from '../placePicker';
import { PlaceSearchScreen } from '../PlaceSearchScreen';
import { makeScheduleApi } from '../../../__tests__/support/todaySupport';
import { APT, found, makeApi, TOWER } from '../testSupport';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
}));

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderScreen = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);
const input = () => screen.getByLabelText('장소 검색');

beforeEach(() => {
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack.mockReset().mockReturnValue(true);
});

describe('장소 고르기 다리(placePicker)', () => {
  it('키로 기다리는 화면에만 전하고, 기다리는 화면이 없으면 false', () => {
    const a = jest.fn();
    const b = jest.fn();
    const offA = listenForPlace('a', a);
    listenForPlace('b', b);
    expect(deliverPlace('a', { text: '집' })).toBe(true);
    expect(a).toHaveBeenCalledWith({ text: '집' });
    expect(b).not.toHaveBeenCalled();
    offA();
    expect(deliverPlace('a', { text: '집' })).toBe(false);
    expect(deliverPlace('zzz', { text: '집' })).toBe(false);
  });

  it('같은 키를 다시 기다리면 새 화면이 받고, 옛 화면의 해제가 새 화면을 끊지 않는다', () => {
    const first = jest.fn();
    const second = jest.fn();
    const offFirst = listenForPlace('k', first);
    listenForPlace('k', second);
    offFirst();
    deliverPlace('k', { text: 'x' });
    expect(second).toHaveBeenCalledWith({ text: 'x' });
    expect(first).not.toHaveBeenCalled();
  });
});

describe('PlaceSearchScreen: 가족 요청의 장소 칸(pickerKey)', () => {
  it('제목은 요청 장소 찾기이고 단계 표시가 없다', async () => {
    await renderScreen(<PlaceSearchScreen pickerKey="request-place" api={makeApi()} debounceMs={0} standalone />);
    expect(screen.getByRole('header', { name: '요청 장소 찾기' })).toBeOnTheScreen();
    expect(screen.queryByText('2 / 4')).toBeNull();
    expect(screen.queryByText('3 / 4')).toBeNull();
  });

  it('결과를 고르면 서버에 저장하지 않고 이름과 좌표만 돌려주고 닫는다', async () => {
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue(found([APT, TOWER])) });
    const scheduleApi = makeScheduleApi();
    const received = jest.fn();
    const off = listenForPlace('request-place', received);
    await renderScreen(<PlaceSearchScreen pickerKey="request-place" api={api} scheduleApi={scheduleApi} debounceMs={0} standalone />);
    await fireEvent.changeText(input(), '광주');
    await fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    expect(received).toHaveBeenCalledWith({ text: APT.name, lat: APT.lat, lng: APT.lng });
    expect(api.assignPlace).not.toHaveBeenCalled();
    expect(scheduleApi.savePlace).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
    off();
  });

  it('검색어를 넣으면 [그대로 쓰기]가 보이고, 누르면 좌표 없이 글자만 돌려준다', async () => {
    const received = jest.fn();
    const off = listenForPlace('request-pickup', received);
    await renderScreen(<PlaceSearchScreen pickerKey="request-pickup" api={makeApi()} debounceMs={0} standalone />);
    expect(screen.queryByRole('button', { name: /그대로 쓰기/ })).toBeNull();
    await fireEvent.changeText(input(), '  우리집 앞  ');
    await fireEvent.press(screen.getByRole('button', { name: '‘우리집 앞’ 그대로 쓰기' }));
    expect(received).toHaveBeenCalledWith({ text: '우리집 앞' });
    expect(received.mock.calls[0]![0]).not.toHaveProperty('lat');
    expect(mockBack).toHaveBeenCalledTimes(1);
    off();
  });

  it('검색이 안 돼도(검색 불가) 글자만 넣어 요청을 보낼 수 있다', async () => {
    const received = jest.fn();
    const off = listenForPlace('request-dropoff', received);
    await renderScreen(<PlaceSearchScreen pickerKey="request-dropoff" api={makeApi({ searchPlaces: jest.fn().mockResolvedValue(found([], 'unavailable')) })} debounceMs={0} standalone />);
    await fireEvent.changeText(input(), '학원');
    expect(await screen.findByText('지금은 장소를 검색할 수 없어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '‘학원’ 그대로 쓰기' }));
    expect(received).toHaveBeenCalledWith({ text: '학원' });
    off();
  });

  it('[취소]는 아무것도 돌려주지 않고 닫는다', async () => {
    const received = jest.fn();
    const off = listenForPlace('request-place', received);
    await renderScreen(<PlaceSearchScreen pickerKey="request-place" api={makeApi()} debounceMs={0} standalone />);
    await fireEvent.press(screen.getByText('취소'));
    expect(received).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
    off();
  });

  it('돌아갈 곳이 없으면 오늘 탭으로 간다(standalone)', async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderScreen(<PlaceSearchScreen pickerKey="request-place" api={makeApi()} debounceMs={0} standalone />);
    await fireEvent.press(screen.getByText('취소'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('기존 사용(자주 가는 곳)에는 [그대로 쓰기]가 없다', async () => {
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi()} debounceMs={0} />);
    await fireEvent.changeText(input(), '광주');
    expect(screen.queryByRole('button', { name: /그대로 쓰기/ })).toBeNull();
  });
});
