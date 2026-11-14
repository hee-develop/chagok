import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
const empty: SetupSchedule = { id: 'lunch', title: '육전집 점심', start: '2026-11-06T04:00:00Z', end: '2026-11-06T05:00:00Z', place: null, locationText: null, noTravel: false, noTravelReason: null, care: null, suggestion: null, familyRequests: [] };
const resolved: SetupSchedule = { ...empty, id: 'game', title: 'KIA 직관', place: { name: '챔피언스필드', lat: 35.1, lng: 126.8 } };
const makeApi = (overrides: Partial<SchedulePlacesApi> = {}) => ({
  fetchSchedules: jest.fn().mockResolvedValue({ anchor: empty.start, schedules: [empty, resolved] }),
  savePlace: jest.fn().mockResolvedValue({ id: empty.id, place: null, locationText: null, noTravel: true }),
  saveCare: jest.fn().mockResolvedValue({ id: empty.id, care: null }),
  ...overrides,
});
const renderScreen = (api: SchedulePlacesApi, timeoutMs?: number, extra: Partial<React.ComponentProps<typeof FillPlacesScreen>> = {}) =>
  render(<SafeAreaProvider initialMetrics={insets}><FillPlacesScreen api={api} timeoutMs={timeoutMs} filteredEvents={[]} {...extra} /></SafeAreaProvider>);
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
  expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
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
  expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
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
  expect(screen.getByText('✓ 이동 없음 · 건물 안')).toBeOnTheScreen();
  expect(screen.getByText('✓ 이동 없음')).toBeOnTheScreen();
  expect(screen.getByTestId('schedule-zoom')).toHaveStyle({ opacity: 0.55 });
  expect(screen.getByTestId('schedule-gym')).not.toHaveStyle({ opacity: 0.55 });
  // 잘못 거른 일정은 장소를 넣어 다시 차로 보낼 수 있다.
  await fireEvent.press(screen.getByRole('button', { name: '주간 회의 장소 변경' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/schedule-place-search', params: { scheduleId: 'zoom' } });
});

it('차로 가는 일정에는 채비 줄을 두고, 적어 둔 채비는 보여 주며 채비 화면으로 넘긴다', async () => {
  const kia: SetupSchedule = { ...resolved, id: 'kia', care: '유니폼·응원봉·티켓' };
  const filtered: SetupSchedule = { ...empty, id: 'zoom', title: '주간 회의', noTravel: true, noTravelReason: 'online' };
  await renderScreen(makeApi({ fetchSchedules: jest.fn().mockResolvedValue({ anchor: empty.start, schedules: [empty, kia, filtered] }) }));
  expect(await screen.findByText('채비 · 유니폼·응원봉·티켓')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '육전집 점심 채비 넣기' })).toBeOnTheScreen();
  // 이동 없음 일정은 차로 가지 않으니 채비 줄이 없다.
  expect(screen.queryByRole('button', { name: '주간 회의 채비 넣기' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'KIA 직관 채비 수정' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/schedule-care', params: { scheduleId: 'kia', title: 'KIA 직관', care: '유니폼·응원봉·티켓' } });
  await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 채비 넣기' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/schedule-care', params: { scheduleId: 'lunch', title: '육전집 점심', care: '' } });
});

it('차로 가는 일정에는 가족에게 보내기 줄을 두고, 보낸 가족은 전달됨으로 보인다', async () => {
  const kia: SetupSchedule = { ...resolved, id: 'kia', familyRequests: [{ memberId: 'family-mom', name: '엄마', status: 'delivered', sentAt: '2026-11-06T00:20:00Z' }] };
  const filtered: SetupSchedule = { ...empty, id: 'zoom', title: '주간 회의', noTravel: true, noTravelReason: 'online' };
  await renderScreen(makeApi({ fetchSchedules: jest.fn().mockResolvedValue({ anchor: empty.start, schedules: [empty, kia, filtered] }) }));
  expect(await screen.findByText('엄마에게 전달됨')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '주간 회의 가족에게 보내기' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'KIA 직관 가족에게 보내기' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/family-send', params: { scheduleId: 'kia', title: 'KIA 직관' } });
});

describe('폰이 거른 일정(서버로 보내지 않은 것)', () => {
  const zoom = { id: 'zoom@1', title: '고객사 주간 회의', start: '2026-11-06T02:00:00Z', end: '2026-11-06T03:00:00Z', reason: 'online' as const };
  const room = { id: 'room@1', title: '기획 리뷰', start: '2026-11-06T08:00:00Z', end: '2026-11-06T09:00:00Z', reason: 'meetingRoom' as const };

  it('서버 일정과 시간순으로 섞어 흐리게 보이고 이유를 붙이며, 장소 빈 개수에는 넣지 않는다', async () => {
    await renderScreen(makeApi(), undefined, { filteredEvents: [room, zoom] });
    expect(await screen.findByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
    expect(screen.getByText('✓ 이동 없음 · 온라인 회의')).toBeOnTheScreen();
    expect(screen.getByText('✓ 이동 없음 · 건물 안')).toBeOnTheScreen();
    expect(screen.getByTestId('schedule-zoom@1')).toHaveStyle({ opacity: 0.55 });
    const order = screen.getAllByTestId(/^schedule-/).map((n) => n.props.testID);
    expect(order).toEqual(['schedule-zoom@1', 'schedule-lunch', 'schedule-game', 'schedule-room@1']);
  });

  it('거른 일정만 있어도 목록으로 보인다(서버 일정이 0건)', async () => {
    const fetchSchedules = jest.fn().mockResolvedValue({ anchor: empty.start, schedules: [] });
    await renderScreen(makeApi({ fetchSchedules }), undefined, { filteredEvents: [zoom] });
    expect(await screen.findByText('고객사 주간 회의')).toBeOnTheScreen();
    expect(screen.queryByText('선택한 캘린더에 확인할 일정이 없어요.')).toBeNull();
  });

  const markRow = () => screen.findByRole('button', { name: '고객사 주간 회의 이동 일정이에요' });

  it('줄을 누르면 바로 바꾸지 않고 확인을 보인다. [취소]하면 아무것도 하지 않는다', async () => {
    const mark = jest.fn().mockResolvedValue('ok');
    await renderScreen(makeApi(), undefined, { filteredEvents: [zoom], travelMark: { mark } });
    await fireEvent.press(await markRow());
    expect(screen.getByText('‘고객사 주간 회의’ 일정을 이동 일정으로 바꿀까요?')).toBeOnTheScreen();
    expect(screen.getByText('같은 이름 일정을 앞으로 차에 보내요.')).toBeOnTheScreen();
    expect(mark).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('‘고객사 주간 회의’ 일정을 이동 일정으로 바꿀까요?')).toBeNull();
    expect(mark).not.toHaveBeenCalled();
    expect(screen.getByText('✓ 이동 없음 · 온라인 회의')).toBeOnTheScreen();
  });

  it('[바꾸기]를 누르면 그 이름으로 처리하고 서버 목록을 다시 조회하며 되돌리기를 보인다', async () => {
    const mark = jest.fn().mockResolvedValue('ok');
    const api = makeApi();
    await renderScreen(api, undefined, { filteredEvents: [zoom], travelMark: { mark } });
    await screen.findByText('✓ 이동 없음 · 온라인 회의');
    expect(api.fetchSchedules).toHaveBeenCalledTimes(1);
    await fireEvent.press(await markRow());
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    expect(mark).toHaveBeenCalledWith('고객사 주간 회의');
    await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('‘고객사 주간 회의’ 일정을 이동 일정으로 바꿨어요.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '고객사 주간 회의 되돌리기' })).toBeOnTheScreen();
  });

  it('[되돌리기]는 취소 동작을 부르고 서버 목록을 다시 조회한다', async () => {
    const mark = jest.fn().mockResolvedValue('ok');
    const undo = jest.fn().mockResolvedValue('ok');
    const api = makeApi();
    await renderScreen(api, undefined, { filteredEvents: [zoom], travelMark: { mark, undo } });
    await fireEvent.press(await markRow());
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    await fireEvent.press(await screen.findByRole('button', { name: '고객사 주간 회의 되돌리기' }));
    expect(undo).toHaveBeenCalledWith('고객사 주간 회의');
    await waitFor(() => expect(screen.queryByText('‘고객사 주간 회의’ 일정을 이동 일정으로 바꿨어요.')).toBeNull());
    await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/차에는 아직 반영하지 못했고/)).toBeNull();
  });

  it('되돌리기가 차에 반영되지 못하면 안내한다', async () => {
    const undo = jest.fn().mockResolvedValue('failed');
    await renderScreen(makeApi(), undefined, { filteredEvents: [zoom], travelMark: { mark: jest.fn().mockResolvedValue('ok'), undo } });
    await fireEvent.press(await markRow());
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    await fireEvent.press(await screen.findByRole('button', { name: '고객사 주간 회의 되돌리기' }));
    expect(await screen.findByText('되돌렸어요. 차에는 아직 반영하지 못했고 잠시 뒤 다시 보내요.')).toBeOnTheScreen();
  });

  it('되돌리기는 일정 시간이 지나면 사라진다', async () => {
    jest.useFakeTimers();
    try {
      await renderScreen(makeApi(), undefined, { filteredEvents: [zoom], travelMark: { mark: jest.fn().mockResolvedValue('ok'), undoVisibleMs: 3000 } });
      await fireEvent.press(await markRow());
      await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
      expect(await screen.findByRole('button', { name: '고객사 주간 회의 되돌리기' })).toBeOnTheScreen();
      await act(async () => { await jest.advanceTimersByTimeAsync(3001); });
      expect(screen.queryByRole('button', { name: '고객사 주간 회의 되돌리기' })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('차에 반영하지 못하면(failed) 그 줄이 그대로 남고 안내한다', async () => {
    const mark = jest.fn().mockResolvedValue('failed');
    const api = makeApi();
    await renderScreen(api, undefined, { filteredEvents: [zoom], travelMark: { mark } });
    await fireEvent.press(await markRow());
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    expect(await screen.findByText('바꾸지 못했어요. 일정은 그대로예요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByText('✓ 이동 없음 · 온라인 회의')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '고객사 주간 회의 되돌리기' })).toBeNull();
    expect(api.fetchSchedules).toHaveBeenCalledTimes(1); // 서버 일정은 달라지지 않아 다시 조회하지 않는다
  });

  it('처리하는 동안은 다른 저장 버튼을 막는다', async () => {
    const mark = jest.fn().mockReturnValue(new Promise(() => {}));
    await renderScreen(makeApi(), undefined, { filteredEvents: [zoom], travelMark: { mark } });
    await fireEvent.press(await markRow());
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '육전집 점심 이동 없음' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '바꾸기' })).toBeDisabled();
  });

  it('서버 목록에 같은 id가 이미 있으면 서버 쪽만 보인다', async () => {
    await renderScreen(makeApi(), undefined, { filteredEvents: [{ ...zoom, id: 'lunch' }] });
    await screen.findByText('장소가 빈 일정이 1개 있어요');
    expect(screen.getAllByTestId('schedule-lunch')).toHaveLength(1);
    expect(screen.queryByText('고객사 주간 회의')).toBeNull();
  });
});
