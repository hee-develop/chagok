import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { TodayScreen } from '../TodayScreen';
import { DENTIST, GRANTED, LUNCH, makeConnection, makePermissions, makeScheduleApi } from '../testSupport';

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
const setup = (props: Partial<React.ComponentProps<typeof TodayScreen>> = {}) =>
  renderWith(<TodayScreen scheduleApi={makeScheduleApi()} connectionSource={makeConnection(true)} permissionsSource={makePermissions()} {...props} />);
const rowButton = (title: string) => screen.getByRole('button', { name: `${title} 일정 펼치기` });

beforeEach(() => mockPush.mockReset());

describe('오늘 탭: 정상', () => {
  it('오늘 일정을 시간순으로 보이고 다른 날 일정은 오늘 목록에 넣지 않는다', async () => {
    await setup();
    expect(await screen.findByText('육전집 점심')).toBeOnTheScreen();
    const section = within(screen.getByTestId('today-schedules'));
    expect(section.getAllByText(/^(육전집 점심|주간 회의|KIA 직관)$/).map((n) => n.props.children)).toEqual(['육전집 점심', '주간 회의', 'KIA 직관']);
    expect(section.getByText('13:00')).toBeOnTheScreen();
    expect(section.queryByText('치과')).toBeNull();
    // 서버 기준 오늘이 11월 6일(금)이라는 것을 제목 아래에 보인다.
    expect(screen.getByText('11월 6일 (금)')).toBeOnTheScreen();
  });

  it('장소가 빈 일정 수를 한 줄로 알리고, 다른 날 빈 일정은 따로 모은다', async () => {
    await setup();
    expect(await screen.findByText('장소가 빈 일정이 2개 있어요')).toBeOnTheScreen();
    const other = within(screen.getByTestId('other-missing'));
    expect(other.getByText('치과')).toBeOnTheScreen();
    expect(other.getByText('11월 8일 (일)')).toBeOnTheScreen();
  });

  it('이동 없음 일정은 흐리게 보이고 글로도 이동 없음을 적는다. 장소 있는 일정은 흐리지 않다', async () => {
    await setup();
    await screen.findByText('주간 회의');
    const dimmed = StyleSheet.flatten(screen.getByTestId('today-row-head-online').props.style);
    expect(dimmed.opacity).toBeLessThan(1);
    const normal = StyleSheet.flatten(screen.getByTestId('today-row-head-game').props.style);
    expect(normal.opacity).toBeUndefined();
    expect(within(screen.getByTestId('today-row-online')).getByText('이동 없음 · 온라인 회의')).toBeOnTheScreen();
    expect(within(screen.getByTestId('today-row-game')).getByText('챔피언스필드')).toBeOnTheScreen();
    expect(within(screen.getByTestId('today-row-game')).getByText('채비 · 유니폼·응원봉')).toBeOnTheScreen();
  });

  it('받은 가족 요청은 서버에 받는 쪽이 없어 빈 상태만 보인다', async () => {
    await setup();
    const inbox = within(screen.getByTestId('family-inbox'));
    expect(inbox.getByText('아직 받은 요청이 없어요.')).toBeOnTheScreen();
    expect(inbox.getByText('가족이 보낸 요청은 곧 여기에서 볼 수 있어요.')).toBeOnTheScreen();
  });
});

describe('오늘 탭: 일정을 누르면 장소와 채비를 바로 적는다', () => {
  it('누르기 전에는 편집 버튼이 없고, 누르면 3단계와 같은 버튼이 펼쳐진다', async () => {
    await setup();
    await screen.findByText('육전집 점심');
    expect(screen.queryByRole('button', { name: '육전집 점심 장소 넣기' })).toBeNull();
    await fireEvent.press(rowButton('육전집 점심'));
    expect(screen.getByRole('button', { name: '육전집 점심 장소 넣기' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '육전집 점심 이동 없음' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '육전집 점심 채비 넣기' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '육전집 점심 가족에게 보내기' })).toBeOnTheScreen();
    // 다시 누르면 접힌다.
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 일정 접기' }));
    expect(screen.queryByRole('button', { name: '육전집 점심 장소 넣기' })).toBeNull();
  });

  it('장소 넣기·채비·가족에게 보내기는 첫 설정 화면을 오늘 탭 출처(from=today)로 연다', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 일정 펼치기' }));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 장소 넣기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/schedule-place-search', params: { scheduleId: 'lunch', from: 'today' } });
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 채비 넣기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/schedule-care', params: { scheduleId: 'lunch', title: '육전집 점심', care: '', from: 'today' } });
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 가족에게 보내기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/family-send', params: { scheduleId: 'lunch', title: '육전집 점심', from: 'today' } });
  });

  it('이동 없음을 서버에 저장하고 줄을 바로 흐리게 바꾼다', async () => {
    const api = makeScheduleApi();
    await setup({ scheduleApi: api });
    await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 일정 펼치기' }));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 이동 없음' }));
    await waitFor(() => expect(api.savePlace).toHaveBeenCalledWith('lunch', { noTravel: true }, expect.any(AbortSignal)));
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId('today-row-head-lunch').props.style).opacity).toBeLessThan(1));
    // 빈 일정이 하나 줄어 배너 개수가 바뀐다(치과만 남는다).
    expect(await screen.findByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
  });

  it("'여기 맞아요'로 기억한 장소를 저장한다", async () => {
    const api = makeScheduleApi([DENTIST], { savePlace: jest.fn().mockResolvedValue({ id: 'dentist', place: { name: '예시치과의원', lat: 1, lng: 2 }, locationText: '예시치과의원', noTravel: false, noTravelReason: null }) });
    await setup({ scheduleApi: api });
    // 오늘 일정이 없어도 다른 날 빈 일정에서 같은 방식으로 적는다.
    await fireEvent.press(await screen.findByRole('button', { name: '치과 일정 펼치기' }));
    expect(screen.getByText('예시치과의원')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '치과 여기 맞아요' }));
    await waitFor(() => expect(api.savePlace).toHaveBeenCalledWith('dentist', { placeId: 'mock-dental' }, expect.any(AbortSignal)));
    // 장소가 정해진 다른 날 일정은 '장소가 빈 일정' 구역에서 빠지고 배너도 사라진다.
    await waitFor(() => expect(screen.queryByTestId('other-missing')).toBeNull());
    expect(screen.queryByTestId('missing-banner')).toBeNull();
  });

  it('저장이 실패하면 같은 저장을 다시 시도할 수 있다', async () => {
    const savePlace = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'lunch', place: null, locationText: null, noTravel: true, noTravelReason: null });
    await setup({ scheduleApi: makeScheduleApi(undefined, { savePlace }) });
    await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 일정 펼치기' }));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 이동 없음' }));
    expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(savePlace).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeNull());
  });
});

describe('오늘 탭: 상태 5종(일정 구역)', () => {
  it('로딩: 일정을 기다리는 동안 진행 표시를 보이고 다른 구역은 이미 보인다', async () => {
    const api = makeScheduleApi(undefined, { fetchSchedules: jest.fn(() => new Promise(() => {})) });
    await setup({ scheduleApi: api });
    expect(await screen.findByLabelText('일정을 불러오는 중')).toBeOnTheScreen();
    expect(screen.getByText('받은 가족 요청')).toBeOnTheScreen();
  });

  it('빈 상태: 오늘 일정이 없으면 안내한다', async () => {
    await setup({ scheduleApi: makeScheduleApi([]) });
    expect(await screen.findByText('오늘은 차로 갈 일정이 없어요.')).toBeOnTheScreen();
    expect(screen.queryByTestId('missing-banner')).toBeNull();
  });

  it('오류: 불러오지 못하면 다시 시도로 복구한다', async () => {
    const fetchSchedules = jest.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ anchor: '2026-11-06T00:30:00Z', schedules: [LUNCH] });
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules }) });
    expect(await screen.findByText('일정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText('육전집 점심')).toBeOnTheScreen();
  });

  it('오류: 서버가 4xx로 거절해도 같은 오류 상태다', async () => {
    const fetchSchedules = jest.fn().mockRejectedValue(new HttpError(500, 'boom'));
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules }) });
    expect(await screen.findByText('일정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  });

  it('권한 없음: 캘린더가 꺼져 있으면 일정을 요청하지 않고 켜는 법을 안내한다', async () => {
    const api = makeScheduleApi();
    const permissions = makePermissions({ calendar: 'denied', camera: 'granted' });
    await setup({ scheduleApi: api, permissionsSource: permissions });
    expect(await screen.findByText('캘린더를 켜면 오늘 일정을 볼 수 있어요.')).toBeOnTheScreen();
    expect(api.fetchSchedules).not.toHaveBeenCalled();
    expect(screen.queryByText('육전집 점심')).toBeNull();
    // 다시 물을 수 없으면 설정 열기로 보낸다.
    await fireEvent.press(screen.getByRole('button', { name: '캘린더 설정 열기' }));
    expect(permissions.openSettings).toHaveBeenCalled();
  });

  it('권한 없음: 아직 안 물었으면 [켜기]로 권한을 요청하고 허용되면 일정을 불러온다', async () => {
    const api = makeScheduleApi();
    const permissions = makePermissions({ calendar: 'ask', camera: 'granted' });
    await setup({ scheduleApi: api, permissionsSource: permissions });
    await fireEvent.press(await screen.findByRole('button', { name: '캘린더 켜기' }));
    expect(permissions.request).toHaveBeenCalledWith('calendar');
    expect(await screen.findByText('육전집 점심')).toBeOnTheScreen();
    expect(api.fetchSchedules).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('permission-guide')).toBeNull();
  });
});

describe('오늘 탭: 꺼진 권한 안내', () => {
  it('켜져 있는 권한은 안내하지 않는다', async () => {
    await setup({ permissionsSource: makePermissions(GRANTED) });
    await screen.findByText('육전집 점심');
    expect(screen.queryByTestId('permission-guide')).toBeNull();
  });

  it('꺼진 권한은 켜면 되는 일을 한 줄씩 보인다(차와 연결되지 않았으면 카메라도)', async () => {
    await setup({ connectionSource: makeConnection(false), permissionsSource: makePermissions({ calendar: 'ask', camera: 'denied' }) });
    const guide = within(await screen.findByTestId('permission-guide'));
    expect(guide.getByText('캘린더를 켜면 오늘 일정을 차에 보내 드려요.')).toBeOnTheScreen();
    expect(guide.getByText('카메라를 켜면 차 화면의 QR을 찍어 바로 연결할 수 있어요.')).toBeOnTheScreen();
  });

  it('차와 이미 연결돼 있으면 카메라 안내는 숨긴다', async () => {
    await setup({ connectionSource: makeConnection(true), permissionsSource: makePermissions({ calendar: 'ask', camera: 'denied' }) });
    await screen.findByText('연결 화면 열기');
    const guide = within(screen.getByTestId('permission-guide'));
    expect(guide.queryByText(/카메라를 켜면/)).toBeNull();
    expect(guide.getByText(/캘린더를 켜면/)).toBeOnTheScreen();
  });
});

describe('오늘 탭: 차 연결 상태', () => {
  it('연결됨: 상태와 연결 화면 버튼을 보인다', async () => {
    await setup({ connectionSource: makeConnection(true) });
    expect(await screen.findByText('✓ 차와 연결돼 있어요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '연결 화면 열기' }));
    expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
  });

  it('연결 안 됨: [차 연결하기]로 연결 화면에 간다', async () => {
    await setup({ connectionSource: makeConnection(false) });
    expect(await screen.findByText('차와 연결되지 않았어요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '차 연결하기' }));
    expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
  });

  it('확인하는 동안 진행 표시, 실패하면 다시 확인으로 복구한다', async () => {
    const source = makeConnection(new Error('offline'));
    await setup({ connectionSource: source });
    expect(await screen.findByText('연결 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    source.isConnected.mockResolvedValueOnce(true);
    await fireEvent.press(screen.getByText('다시 확인'));
    expect(await screen.findByText('✓ 차와 연결돼 있어요')).toBeOnTheScreen();
  });

  it('연결 상태 확인이 끝나기 전에는 진행 표시를 보인다', async () => {
    await setup({ connectionSource: { isConnected: jest.fn(() => new Promise(() => {})) } });
    expect(await screen.findByLabelText('연결 상태를 확인하는 중')).toBeOnTheScreen();
  });
});
