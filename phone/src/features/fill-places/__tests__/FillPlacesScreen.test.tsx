import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { FillPlacesScreen } from '../FillPlacesScreen';
import type { SchedulePlacesApi, SetupSchedule } from '../schedulePlacesApi';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});
const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const empty: SetupSchedule = { id: 'lunch', title: '육전집 점심', start: '2026-11-06T04:00:00Z', end: '2026-11-06T05:00:00Z', place: null, locationText: null, noTravel: false, noTravelReason: null, suggestion: null };
const resolved: SetupSchedule = { ...empty, id: 'game', title: 'KIA 직관', place: { name: '챔피언스필드', lat: 35.1, lng: 126.8 } };
const makeApi = (overrides: Partial<SchedulePlacesApi> = {}) => ({
  fetchSchedules: jest.fn().mockResolvedValue({ anchor: empty.start, schedules: [empty, resolved] }),
  savePlace: jest.fn().mockResolvedValue({ id: empty.id, place: null, locationText: null, noTravel: true }),
  ...overrides,
});
const renderScreen = (api: SchedulePlacesApi, timeoutMs?: number) => render(<SafeAreaProvider initialMetrics={insets}><FillPlacesScreen api={api} timeoutMs={timeoutMs} /></SafeAreaProvider>);
beforeEach(() => mockPush.mockReset());

it('서버 일정으로 개수를 계산하고 장소가 있는 일정과 한국 시각도 보여 준다', async () => {
  await renderScreen(makeApi());
  expect(await screen.findByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
  expect(screen.getByText('3 / 4')).toBeOnTheScreen();
  expect(screen.getAllByText('11월 6일 (금) 13:00')).toHaveLength(2);
  expect(screen.getByText('✓ 챔피언스필드')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 장소 넣기' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/schedule-place-search', params: { scheduleId: 'lunch' } });
});

it('이동 없음을 서버에 저장한 뒤 개수를 줄이고 이미 채운 일정은 유지한다', async () => {
  const api = makeApi();
  await renderScreen(api);
  await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 이동 없음' }));
  expect(await screen.findByText('일정 장소를 모두 확인했어요')).toBeOnTheScreen();
  expect(api.savePlace).toHaveBeenCalledWith('lunch', { noTravel: true }, expect.any(AbortSignal));
  expect(screen.getByText('✓ 이동 없음')).toBeOnTheScreen();
  expect(screen.getByText('✓ 챔피언스필드')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 장소 변경' }));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: { scheduleId: 'lunch' } }));
});

it('조회가 실패하면 개수를 만들지 않고 재시도하며, 빈 목록에서도 다음으로 갈 수 있다', async () => {
  const fetchSchedules = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ anchor: empty.start, schedules: [] });
  await renderScreen(makeApi({ fetchSchedules }));
  await screen.findByText('일정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  await fireEvent.press(screen.getByText('다시 시도'));
  await screen.findByText('선택한 캘린더에 확인할 일정이 없어요.');
  await fireEvent.press(screen.getByText('다음'));
  expect(mockPush).toHaveBeenCalledWith('/setup/talk');
});

it('저장 실패는 원래 상태를 유지하고 같은 연산만 재시도한다', async () => {
  const savePlace = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: empty.id, place: null, locationText: null, noTravel: true });
  await renderScreen(makeApi({ savePlace }));
  await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 이동 없음' }));
  await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  expect(screen.getByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 시도'));
  await screen.findByText('일정 장소를 모두 확인했어요');
  expect(savePlace).toHaveBeenCalledTimes(2);
});

it('저장 중에는 중복 저장과 화면 이동을 막고 화면 종료 시 취소한다', async () => {
  const savePlace = jest.fn().mockReturnValue(new Promise(() => {}));
  const view = await renderScreen(makeApi({ savePlace }));
  await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 이동 없음' }));
  await screen.findByRole('progressbar', { name: '저장하는 중' });
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '나중에 할게요' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 이동 없음' }));
  expect(savePlace).toHaveBeenCalledTimes(1);
  const signal = savePlace.mock.calls[0][2];
  await view.unmount();
  expect(signal.aborted).toBe(true);
});

it('4xx 거절은 재전송하지 않고 최신 목록을 불러온다', async () => {
  const api = makeApi({ savePlace: jest.fn().mockRejectedValue(new HttpError(404, 'removed')) });
  await renderScreen(api);
  await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 이동 없음' }));
  await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(2));
  expect(api.savePlace).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('다시 시도')).toBeNull();
  expect(screen.getByText('일정이 바뀌었어요. 목록에서 다시 확인해 주세요.')).toBeOnTheScreen();
  expect(screen.queryByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeNull();
});

it('응답이 없는 조회는 시간 제한 후 실패하고 나중에 진행해도 저장하지 않는다', async () => {
  const api = makeApi({ fetchSchedules: jest.fn().mockReturnValue(new Promise(() => {})) });
  await renderScreen(api, 20);
  await screen.findByText('일정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  await fireEvent.press(screen.getByText('나중에 할게요'));
  expect(mockPush).toHaveBeenCalledWith('/setup/talk');
  expect(api.savePlace).not.toHaveBeenCalled();
});

describe('지난번 장소 기억', () => {
  const dentist: SetupSchedule = { ...empty, id: 'dentist', title: '치과', suggestion: { placeId: 'mock-dentist', name: '예시치과의원' } };
  const withDentist = (overrides: Partial<SchedulePlacesApi> = {}) => makeApi({
    fetchSchedules: jest.fn().mockResolvedValue({ anchor: empty.start, schedules: [empty, dentist] }),
    ...overrides,
  });

  it('후보가 있는 일정에만 지난번 장소를 보여 주고 빈 개수에 함께 센다', async () => {
    await renderScreen(withDentist());
    expect(await screen.findByText('장소가 빈 일정이 2개 있어요')).toBeOnTheScreen();
    expect(screen.getByText("지난번 '치과' 일정")).toBeOnTheScreen();
    expect(screen.getByText('예시치과의원')).toBeOnTheScreen();
    expect(screen.getAllByText('여기 맞아요')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '치과 이동 없음' })).toBeOnTheScreen();
  });

  it('여기 맞아요는 후보 장소 id를 서버에 저장하고 후보를 숨긴다', async () => {
    const savePlace = jest.fn().mockResolvedValue({ id: 'dentist', place: { name: '예시치과의원', lat: 1, lng: 2 }, locationText: '예시치과의원', noTravel: false });
    await renderScreen(withDentist({ savePlace }));
    await fireEvent.press(await screen.findByRole('button', { name: '치과 여기 맞아요' }));
    expect(await screen.findByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
    expect(savePlace).toHaveBeenCalledWith('dentist', { placeId: 'mock-dentist' }, expect.any(AbortSignal));
    expect(screen.getByText('✓ 예시치과의원')).toBeOnTheScreen();
    expect(screen.queryByText("지난번 '치과' 일정")).toBeNull();
  });

  it('저장 실패는 후보를 유지하고 같은 후보로 재시도하며 저장 중에는 비활성이다', async () => {
    const savePlace = jest.fn().mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(new Promise(() => {}));
    await renderScreen(withDentist({ savePlace }));
    await fireEvent.press(await screen.findByRole('button', { name: '치과 여기 맞아요' }));
    await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(screen.getByText("지난번 '치과' 일정")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 시도'));
    await screen.findByRole('progressbar', { name: '저장하는 중' });
    expect(screen.getByRole('button', { name: '치과 여기 맞아요' })).toBeDisabled();
    expect(savePlace).toHaveBeenNthCalledWith(2, 'dentist', { placeId: 'mock-dentist' }, expect.any(AbortSignal));
  });

  it('4xx 거절은 재전송하지 않고 최신 목록을 불러온다', async () => {
    const api = withDentist({ savePlace: jest.fn().mockRejectedValue(new HttpError(404, 'removed')) });
    await renderScreen(api);
    await fireEvent.press(await screen.findByRole('button', { name: '치과 여기 맞아요' }));
    await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(2));
    expect(api.savePlace).toHaveBeenCalledTimes(1);
  });
});

it('온라인 회의·회의실이라 저절로 거른 일정은 이유를 붙이고 흐리게 보이며 빈 개수에서 뺀다', async () => {
  const online: SetupSchedule = { ...empty, id: 'zoom', title: '주간 회의', noTravel: true, noTravelReason: 'online' };
  const room: SetupSchedule = { ...empty, id: 'room', title: '기획 리뷰', noTravel: true, noTravelReason: 'meetingRoom' };
  const manual: SetupSchedule = { ...empty, id: 'gym', title: '운동', noTravel: true };
  await renderScreen(makeApi({ fetchSchedules: jest.fn().mockResolvedValue({ anchor: empty.start, schedules: [empty, online, room, manual] }) }));
  expect(await screen.findByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
  expect(screen.getByText('✓ 이동 없음 · 온라인 회의')).toBeOnTheScreen();
  expect(screen.getByText('✓ 이동 없음 · 회의실')).toBeOnTheScreen();
  expect(screen.getByText('✓ 이동 없음')).toBeOnTheScreen();
  expect(screen.getByTestId('schedule-zoom')).toHaveStyle({ opacity: 0.55 });
  expect(screen.getByTestId('schedule-gym')).not.toHaveStyle({ opacity: 0.55 });
  // 잘못 거른 일정은 장소를 넣어 다시 차로 보낼 수 있다.
  await fireEvent.press(screen.getByRole('button', { name: '주간 회의 장소 변경' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/schedule-place-search', params: { scheduleId: 'zoom' } });
});
