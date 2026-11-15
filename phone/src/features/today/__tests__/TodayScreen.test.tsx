import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '../../../ui/theme';

import { HttpError } from '../../../api/request';
import { appEventSync } from '../../calendar-sync/eventSync';
import type { FilteredEvent } from '../../calendar-sync/filteredEvents';
import type { SchedulePlacesApi } from '../../fill-places/schedulePlacesApi';
import { createInbox } from '../../notifications/inbox';
import { makeContacts, makeSettingsApi } from '../../settings/__tests__/support/settingsSupport';
import { registerTapHandler } from '../../notifications/taps';
import { createMemoryStore } from '../../../storage/keyValueStore';
import { TodayScreen } from '../TodayScreen';
import { DENTIST, GRANTED, LUNCH, makeConnection, makePermissions, makeScheduleApi, SEAT } from '../../../__tests__/support/todaySupport';

const mockPush = jest.fn();
// 화면 포커스를 테스트가 켜고 끈다(탭을 바꿨다 돌아오는 상황).
const mockFocus = { focused: true, listeners: new Set<(focused: boolean) => void>() };
jest.mock('expo-router', () => {
  const { useEffect, useState } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      const [focused, setFocused] = useState(mockFocus.focused);
      useEffect(() => {
        mockFocus.listeners.add(setFocused);
        return () => { mockFocus.listeners.delete(setFocused); };
      }, []);
      useEffect(() => (focused ? callback() : undefined), [focused, callback]);
    },
  };
});
const setFocus = async (focused: boolean) => {
  mockFocus.focused = focused;
  await act(async () => { mockFocus.listeners.forEach((listener) => listener(focused)); });
};

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWith = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);
const setup = (props: Partial<React.ComponentProps<typeof TodayScreen>> = {}) =>
  renderWith(<TodayScreen scheduleApi={makeScheduleApi()} connectionSource={makeConnection(true)} permissionsSource={makePermissions()} settingsApi={makeSettingsApi()} contactsSource={makeContacts('granted')} {...props} />);
// 줄 이름은 '제목 시간 상태', 펼치기는 힌트다.
const rowName = (title: string) => new RegExp(`^${title} (\\d+월 \\d+일 \\(.\\) )?\\d{2}:\\d{2} `);
const rowButton = (title: string) => screen.getByRole('button', { name: rowName(title) });
const findRowButton = (title: string) => screen.findByRole('button', { name: rowName(title) });

// WCAG 대비(상대 휘도). 흐린 줄의 글자가 4.5:1 아래로 내려가지 않는지 본다.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const textColorOf = (node: ReturnType<typeof screen.getByText>) => StyleSheet.flatten(node.props.style).color as string;

const ONLINE_EVENT: FilteredEvent = { id: 'evt-online', title: '온라인 스탠드업', start: '2026-11-06T02:00:00Z', end: '2026-11-06T02:30:00Z', reason: 'online' };
const ROOM_EVENT: FilteredEvent = { id: 'evt-room', title: '3층 회의실 점검', start: '2026-11-08T02:00:00Z', end: '2026-11-08T03:00:00Z', reason: 'meetingRoom' };

beforeEach(() => {
  mockPush.mockReset();
  mockFocus.focused = true;
});

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

  it('이동 없음 일정은 opacity 대신 색으로 낮추되 상태 글자 대비가 4.5:1 이상이고 글로도 이동 없음을 적는다. 장소 있는 일정은 그대로다', async () => {
    await setup();
    await screen.findByText('주간 회의');
    const head = (id: string) => StyleSheet.flatten(screen.getByTestId(`today-row-head-${id}`).props.style);
    // opacity로 낮추면 글자 대비가 같이 떨어지므로 쓰지 않는다.
    expect(head('online').opacity).toBeUndefined();
    expect(head('online').backgroundColor).toBe(colors.notice);
    expect(head('game').backgroundColor).toBeUndefined();
    const status = within(screen.getByTestId('today-row-online')).getByText('이동 없음 · 온라인 회의');
    expect(contrast(textColorOf(status), colors.notice)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(textColorOf(within(screen.getByTestId('today-row-online')).getByText('주간 회의')), colors.notice)).toBeGreaterThanOrEqual(4.5);
    // 같은 행의 평범한 줄보다 제목이 옅다(색으로 구분된다).
    expect(textColorOf(within(screen.getByTestId('today-row-online')).getByText('주간 회의')))
      .not.toBe(textColorOf(within(screen.getByTestId('today-row-game')).getByText('KIA 직관')));
    expect(within(screen.getByTestId('today-row-game')).getByText('챔피언스필드')).toBeOnTheScreen();
    expect(within(screen.getByTestId('today-row-game')).getByText('채비 · 유니폼·응원봉')).toBeOnTheScreen();
  });

  it('줄의 접근성 이름에 제목·시간·상태(이동 없음·장소 없음)가 들어가고 펼치기는 힌트로 따로 읽힌다', async () => {
    await setup();
    await screen.findByText('주간 회의');
    const online = screen.getByTestId('today-row-head-online');
    expect(online.props.accessibilityLabel).toBe('주간 회의 15:00 이동 없음 · 온라인 회의');
    expect(online.props.accessibilityHint).toBe('누르면 장소·채비·가족에게 보내기를 펼쳐요');
    expect(screen.getByTestId('today-row-head-lunch').props.accessibilityLabel).toBe('육전집 점심 13:00 장소 없음');
    expect(screen.getByTestId('today-row-head-game').props.accessibilityLabel).toBe('KIA 직관 18:00 챔피언스필드');
    // 펼치면 상태와 힌트가 바뀐다.
    await fireEvent.press(rowButton('육전집 점심'));
    expect(screen.getByTestId('today-row-head-lunch').props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByTestId('today-row-head-lunch').props.accessibilityHint).toBe('누르면 접어요');
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
    await fireEvent.press(rowButton('육전집 점심'));
    expect(screen.queryByRole('button', { name: '육전집 점심 장소 넣기' })).toBeNull();
  });

  it('장소 넣기·채비·가족에게 보내기는 첫 설정 화면을 오늘 탭 출처(from=today)로 연다', async () => {
    await setup();
    await fireEvent.press(await findRowButton('육전집 점심'));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 장소 넣기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/schedule-place-search', params: { scheduleId: 'lunch', from: 'today' } });
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 채비 넣기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/schedule-care', params: { scheduleId: 'lunch', title: '육전집 점심', care: '', from: 'today' } });
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 가족에게 보내기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/family-send', params: { scheduleId: 'lunch', title: '육전집 점심', from: 'today' } });
  });

  it('이동 없음을 서버에 저장하고 줄을 바로 흐린 색으로 바꾼다', async () => {
    const api = makeScheduleApi();
    await setup({ scheduleApi: api });
    await fireEvent.press(await findRowButton('육전집 점심'));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 이동 없음' }));
    await waitFor(() => expect(api.savePlace).toHaveBeenCalledWith('lunch', { noTravel: true }, expect.any(AbortSignal)));
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId('today-row-head-lunch').props.style).backgroundColor).toBe(colors.notice));
    // 빈 일정이 하나 줄어 배너 개수가 바뀐다(치과만 남는다).
    expect(await screen.findByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
  });

  it("'여기 맞아요'로 기억한 장소를 저장한다", async () => {
    const api = makeScheduleApi([DENTIST], { savePlace: jest.fn().mockResolvedValue({ id: 'dentist', place: { name: '예시치과의원', lat: 1, lng: 2 }, locationText: '예시치과의원', noTravel: false, noTravelReason: null }) });
    await setup({ scheduleApi: api });
    // 오늘 일정이 없어도 다른 날 빈 일정에서 같은 방식으로 적는다.
    await fireEvent.press(await findRowButton('치과'));
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
    await fireEvent.press(await findRowButton('육전집 점심'));
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

  it.each([[500], [404]])('오류: 조회가 HTTP %i로 실패해도 같은 오류 상태다', async (status) => {
    const fetchSchedules = jest.fn().mockRejectedValue(new HttpError(status, 'boom'));
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules }) });
    expect(await screen.findByText('일정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
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

  it('캘린더는 아직 묻지 않은 상태에서도 [켜기]를 보인다(홈에 꼭 필요하다)', async () => {
    await setup({ connectionSource: makeConnection(false), permissionsSource: makePermissions({ calendar: 'ask', camera: 'granted' }) });
    const guide = within(await screen.findByTestId('permission-guide'));
    expect(guide.getByText('캘린더를 켜면 오늘 일정을 차에 보내 드려요.')).toBeOnTheScreen();
    expect(guide.getByRole('button', { name: '캘린더 켜기' })).toBeOnTheScreen();
  });

  it('카메라는 한 번도 묻지 않았으면(ask) 홈에 보이지 않는다', async () => {
    await setup({ connectionSource: makeConnection(false), permissionsSource: makePermissions({ calendar: 'granted', camera: 'ask' }) });
    await screen.findByText('차와 연결되지 않았어요');
    expect(screen.queryByTestId('permission-guide')).toBeNull();
    expect(screen.queryByText(/카메라를 켜면/)).toBeNull();
  });

  it('거부한 카메라는 차와 연결되지 않았을 때 [설정 열기]로 보인다', async () => {
    const permissions = makePermissions({ calendar: 'granted', camera: 'denied' });
    await setup({ connectionSource: makeConnection(false), permissionsSource: permissions });
    const guide = within(await screen.findByTestId('permission-guide'));
    expect(guide.getByText('카메라를 켜면 차 화면의 QR을 찍어 바로 연결할 수 있어요.')).toBeOnTheScreen();
    await fireEvent.press(guide.getByRole('button', { name: '카메라 설정 열기' }));
    expect(permissions.openSettings).toHaveBeenCalled();
  });

  it('차와 이미 연결돼 있으면 거부한 카메라도 안내하지 않는다', async () => {
    await setup({ connectionSource: makeConnection(true), permissionsSource: makePermissions({ calendar: 'ask', camera: 'denied' }) });
    await screen.findByText('연결 화면 열기');
    const guide = within(screen.getByTestId('permission-guide'));
    expect(guide.queryByText(/카메라를 켜면/)).toBeNull();
    expect(guide.getByText(/캘린더를 켜면/)).toBeOnTheScreen();
  });

  it('권한 안내는 홈 맨 위, 그 아래가 연결 상태다(정책 10.4)', async () => {
    await setup({ connectionSource: makeConnection(false), permissionsSource: makePermissions({ calendar: 'denied', camera: 'granted' }) });
    await screen.findByTestId('permission-guide');
    await screen.findByTestId('car-connection');
    // 렌더 트리에서 testID가 나오는 순서를 본다.
    const ids: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { props?: { testID?: string }; children?: unknown[] };
      if (n.props?.testID) ids.push(n.props.testID);
      n.children?.forEach(walk);
    };
    const tree = screen.toJSON();
    (Array.isArray(tree) ? tree : [tree]).forEach(walk);
    expect(ids.indexOf('permission-guide')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('permission-guide')).toBeLessThan(ids.indexOf('car-connection'));
  });

  it('권한을 다시 확인하다 실패해도 직전 결과를 그대로 둔다(안내가 사라졌다 나타나지 않는다)', async () => {
    const permissions = makePermissions({ calendar: 'denied', camera: 'granted' });
    await setup({ connectionSource: makeConnection(false), permissionsSource: permissions });
    expect(await screen.findByTestId('permission-guide')).toBeOnTheScreen();
    permissions.read.mockRejectedValueOnce(new Error('boom'));
    await setFocus(false);
    await setFocus(true);
    await waitFor(() => expect(permissions.read).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('permission-guide')).toBeOnTheScreen();
    expect(screen.getByText('캘린더를 켜면 오늘 일정을 볼 수 있어요.')).toBeOnTheScreen();
  });
});

describe('오늘 탭: 차 연결 상태', () => {
  it('연결됨: 자리 이름·연결 시각과 연결 화면 버튼을 보인다', async () => {
    await setup({ connectionSource: makeConnection(true) });
    expect(await screen.findByText('✓ 차와 연결돼 있어요')).toBeOnTheScreen();
    expect(screen.getByTestId('car-connection-detail')).toHaveTextContent(`${SEAT.name} · 11월 6일 (금) 09:30에 연결했어요`);
    await fireEvent.press(screen.getByRole('button', { name: '연결 화면 열기' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/pair-car', params: { from: 'tab' } });
  });

  it('연결 안 됨: [차 연결하기]로 연결 화면에 간다', async () => {
    await setup({ connectionSource: makeConnection(false) });
    expect(await screen.findByText('차와 연결되지 않았어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('car-connection-detail')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '차 연결하기' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/pair-car', params: { from: 'tab' } });
  });

  it('확인에 실패하면 오류를 보이고 [다시 확인]으로 복구한다', async () => {
    const source = makeConnection(new Error('offline'));
    await setup({ connectionSource: source });
    expect(await screen.findByText('연결 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    source.status.mockResolvedValueOnce(SEAT);
    await fireEvent.press(screen.getByText('다시 확인'));
    expect(await screen.findByText('✓ 차와 연결돼 있어요')).toBeOnTheScreen();
  });

  it('연결 상태 확인이 끝나기 전에는 진행 표시를 보인다', async () => {
    await setup({ connectionSource: { status: jest.fn(() => new Promise(() => {})) } });
    expect(await screen.findByLabelText('연결 상태를 확인하는 중')).toBeOnTheScreen();
  });
});

describe('오늘 탭: 폰이 거른 일정(이동 없음)', () => {
  const lunchApi = () => makeScheduleApi([LUNCH]);

  it('거른 일정이 오늘이면 시간순으로 흐린 줄에 이동 없음과 이유를 적어 보이고, 오늘이 아닌 거른 일정은 보이지 않는다', async () => {
    await setup({ scheduleApi: lunchApi(), filteredEvents: [ROOM_EVENT, ONLINE_EVENT] });
    await screen.findByText('육전집 점심');
    const section = within(screen.getByTestId('today-schedules'));
    expect(section.getAllByText(/^(육전집 점심|온라인 스탠드업)$/).map((n) => n.props.children)).toEqual(['온라인 스탠드업', '육전집 점심']);
    const row = within(screen.getByTestId('today-row-evt-online'));
    expect(row.getByText('이동 없음 · 온라인 회의')).toBeOnTheScreen();
    expect(row.getByText('11:00')).toBeOnTheScreen();
    expect(screen.queryByText('3층 회의실 점검')).toBeNull();
    // 거른 줄은 이동 없음이라 '장소가 빈 일정'에 세지 않는다.
    expect(screen.getByText('장소가 빈 일정이 1개 있어요')).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByTestId('today-row-head-evt-online').props.style).opacity).toBeUndefined();
  });

  it('서버에 일정이 하나도 없어도 거른 일정만 보이면 빈 상태 대신 그 줄을 보인다', async () => {
    await setup({ scheduleApi: makeScheduleApi([]), filteredEvents: [ONLINE_EVENT] });
    expect(await screen.findByText('온라인 스탠드업')).toBeOnTheScreen();
    expect(screen.queryByText('오늘은 차로 갈 일정이 없어요.')).toBeNull();
  });

  it('줄을 누르면 확인이 나오고 취소하면 아무것도 바뀌지 않는다. [바꾸기]를 눌러야 바뀐다', async () => {
    const mark = jest.fn().mockResolvedValue('ok');
    await setup({ scheduleApi: lunchApi(), filteredEvents: [ONLINE_EVENT], travelMark: { mark } });
    await fireEvent.press(await screen.findByRole('button', { name: /^온라인 스탠드업 / }));
    expect(screen.getByText('‘온라인 스탠드업’ 일정을 이동 일정으로 바꿀까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('‘온라인 스탠드업’ 일정을 이동 일정으로 바꿀까요?')).toBeNull();
    expect(mark).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: /^온라인 스탠드업 / }));
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    await waitFor(() => expect(mark).toHaveBeenCalledWith('온라인 스탠드업'));
  });

  it('바꾼 뒤에는 되돌리기를 보이고, 서버 목록을 다시 읽고, 되돌리기를 누르면 되돌린다', async () => {
    const mark = jest.fn().mockResolvedValue('ok');
    const undo = jest.fn().mockResolvedValue('ok');
    const api = lunchApi();
    await setup({ scheduleApi: api, filteredEvents: [ONLINE_EVENT], travelMark: { mark, undo } });
    await fireEvent.press(await screen.findByRole('button', { name: /^온라인 스탠드업 / }));
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    expect(await screen.findByText('‘온라인 스탠드업’ 일정을 이동 일정으로 바꿨어요.')).toBeOnTheScreen();
    await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(2));
    await fireEvent.press(screen.getByRole('button', { name: '온라인 스탠드업 되돌리기' }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith('온라인 스탠드업'));
    await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(3));
  });

  it('바꾸지 못하면 안내하고 줄은 그대로 남는다', async () => {
    const mark = jest.fn().mockResolvedValue('failed');
    await setup({ scheduleApi: lunchApi(), filteredEvents: [ONLINE_EVENT], travelMark: { mark } });
    await fireEvent.press(await screen.findByRole('button', { name: /^온라인 스탠드업 / }));
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    expect(await screen.findByText('바꾸지 못했어요. 일정은 그대로예요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByText('온라인 스탠드업')).toBeOnTheScreen();
  });

  it('서버가 같은 id의 일정을 알면 서버 줄만 보이고 거른 줄은 겹쳐 나오지 않는다', async () => {
    await setup({ scheduleApi: lunchApi(), filteredEvents: [{ ...ONLINE_EVENT, id: 'lunch', title: '육전집 점심' }] });
    await screen.findByText('육전집 점심');
    expect(screen.getAllByText('육전집 점심')).toHaveLength(1);
  });
});

describe('오늘 탭: 이동 없음 기억(정책서 10.3 4번)', () => {
  const KIA_SKIPPED: FilteredEvent = { id: 'evt-kia', title: 'KIA 직관', start: '2026-11-06T09:00:00Z', end: '2026-11-06T12:00:00Z', reason: 'skipped' };
  const makeSkips = (remembered: string[] = []) => {
    const state = { full: false, names: new Set(remembered) };
    const listeners = new Set<() => void>();
    return {
      has: (title: string) => state.names.has(title),
      full: () => state.full,
      dismissFull: jest.fn(() => { state.full = false; listeners.forEach((l) => l()); }),
      subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
      setFull: () => { state.full = true; listeners.forEach((l) => l()); },
    };
  };

  it('[이동 없음]을 누르면 3단계와 같은 안내와 [되돌리기]를 보이고, 되돌리면 이름 기억도 함께 되돌린다(undoNoTravel)', async () => {
    const api = makeScheduleApi();
    await setup({ scheduleApi: api, skips: makeSkips() });
    await fireEvent.press(await findRowButton('육전집 점심'));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 이동 없음' }));
    expect(await screen.findByText('‘육전집 점심’ 일정을 이동 없음으로 두었어요. 같은 이름 일정을 앞으로 차에 보내지 않아요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 되돌리기' }));
    await waitFor(() => expect(api.undoNoTravel).toHaveBeenCalledWith('lunch', '육전집 점심', false, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryByRole('button', { name: '육전집 점심 되돌리기' })).toBeNull());
  });

  it('누르기 전부터 기억하던 이름이면 되돌려도 기억을 지우지 않는다', async () => {
    const api = makeScheduleApi();
    await setup({ scheduleApi: api, skips: makeSkips(['육전집 점심']) });
    await fireEvent.press(await findRowButton('육전집 점심'));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 이동 없음' }));
    await fireEvent.press(await screen.findByRole('button', { name: '육전집 점심 되돌리기' }));
    await waitFor(() => expect(api.undoNoTravel).toHaveBeenCalledWith('lunch', '육전집 점심', true, expect.any(AbortSignal)));
  });

  it('서버가 기억 상한이라 거절하면 가득 참 안내로 바뀌고 [확인]으로 닫는다', async () => {
    const skips = makeSkips();
    await setup({ scheduleApi: makeScheduleApi(), skips });
    await fireEvent.press(await findRowButton('육전집 점심'));
    await fireEvent.press(screen.getByRole('button', { name: '육전집 점심 이동 없음' }));
    await screen.findByRole('button', { name: '육전집 점심 되돌리기' });
    await act(async () => skips.setFull());
    expect(screen.getByTestId('skips-full-notice')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '육전집 점심 되돌리기' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '확인' }));
    expect(skips.dismissFull).toHaveBeenCalled();
  });

  it("이동 없음으로 기억한 이름이라 폰이 거른 일정은 '이동 없음 · 이동 없음으로 기억' 흐린 줄로 보이고, [이동 일정이에요]는 예외가 아니라 기억 지우기(unskip)다", async () => {
    const mark = jest.fn().mockResolvedValue('ok');
    const unskip = jest.fn().mockResolvedValue('ok');
    const undoUnskip = jest.fn().mockResolvedValue('ok');
    const api = makeScheduleApi([LUNCH]);
    await setup({ scheduleApi: api, filteredEvents: [KIA_SKIPPED], travelMark: { mark, unskip, undoUnskip } });
    const row = within(await screen.findByTestId('today-row-evt-kia'));
    expect(row.getByText('이동 없음 · 이동 없음으로 기억')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^KIA 직관 / }));
    await fireEvent.press(screen.getByRole('button', { name: '바꾸기' }));
    await waitFor(() => expect(unskip).toHaveBeenCalledWith('KIA 직관'));
    expect(mark).not.toHaveBeenCalled();
    await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(2));
    await fireEvent.press(await screen.findByRole('button', { name: 'KIA 직관 되돌리기' }));
    await waitFor(() => expect(undoUnskip).toHaveBeenCalledWith('KIA 직관'));
  });
});

describe('오늘 탭: 일정 보내기 결과', () => {
  it('일정을 서버로 보냈다는 결과(sent)가 오면 서버 일정을 다시 읽는다(이름으로 기억해 빠진 일정이 서버 줄로 남지 않는다). 다른 결과에는 다시 읽지 않는다', async () => {
    const listeners: ((result: string) => void)[] = [];
    const spy = jest.spyOn(appEventSync, 'subscribe').mockImplementation((listener) => {
      listeners.push(listener as (result: string) => void);
      return () => undefined;
    });
    try {
      const api = makeScheduleApi([LUNCH]);
      await setup({ scheduleApi: api });
      await screen.findByText('육전집 점심');
      expect(api.fetchSchedules).toHaveBeenCalledTimes(1);
      await act(async () => listeners.forEach((l) => l('unchanged')));
      expect(api.fetchSchedules).toHaveBeenCalledTimes(1);
      await act(async () => listeners.forEach((l) => l('sent')));
      await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(2));
    } finally {
      spy.mockRestore();
    }
  });
});

describe('오늘 탭: 저장 오류와 다시 읽기', () => {
  const press = async (name: string | RegExp) => fireEvent.press(await screen.findByRole('button', { name }));

  it('일정이 바뀐 것(4xx) 저장 오류는 [다시 시도] 없이 [닫기]만 두고 목록을 다시 읽는다', async () => {
    const savePlace = jest.fn().mockRejectedValue(new HttpError(409, 'changed'));
    const api = makeScheduleApi(undefined, { savePlace });
    await setup({ scheduleApi: api });
    await fireEvent.press(await findRowButton('육전집 점심'));
    await press('육전집 점심 이동 없음');
    expect(await screen.findByText('일정이 바뀌었어요. 목록에서 다시 확인해 주세요.')).toBeOnTheScreen();
    expect(screen.queryByText('다시 시도')).toBeNull();
    await waitFor(() => expect(api.fetchSchedules).toHaveBeenCalledTimes(2));
    expect(savePlace).toHaveBeenCalledTimes(1);
    await press('닫기');
    expect(screen.queryByText('일정이 바뀌었어요. 목록에서 다시 확인해 주세요.')).toBeNull();
  });

  it('그 밖의 저장 실패(네트워크·5xx)는 [다시 시도]를 두고 닫기는 없다', async () => {
    const savePlace = jest.fn().mockRejectedValue(new HttpError(503, 'down'));
    await setup({ scheduleApi: makeScheduleApi(undefined, { savePlace }) });
    await fireEvent.press(await findRowButton('육전집 점심'));
    await press('육전집 점심 이동 없음');
    expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
    expect(screen.queryByText('닫기')).toBeNull();
  });

  it('탭에서 나갔다 돌아오면 일정을 다시 읽고, 다시 읽는 동안 이미 읽은 목록은 그대로 보인다', async () => {
    let resolveSecond: (value: unknown) => void = () => {};
    const fetchSchedules = jest.fn()
      .mockResolvedValueOnce({ anchor: '2026-11-06T00:30:00Z', schedules: [LUNCH] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules }) });
    expect(await screen.findByText('육전집 점심')).toBeOnTheScreen();
    await setFocus(false);
    await setFocus(true);
    await waitFor(() => expect(fetchSchedules).toHaveBeenCalledTimes(2));
    expect(screen.getByText('육전집 점심')).toBeOnTheScreen();
    expect(screen.queryByLabelText('일정을 불러오는 중')).toBeNull();
    await act(async () => { resolveSecond({ anchor: '2026-11-06T00:30:00Z', schedules: [{ ...LUNCH, title: '육전집 저녁' }] }); });
    expect(await screen.findByText('육전집 저녁')).toBeOnTheScreen();
    expect(screen.queryByText('육전집 점심')).toBeNull();
  });

  it('늦게 온 이전 조회 응답은 버린다(포커스를 잃어 취소한 조회가 새 목록을 덮지 못한다)', async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    const signals: AbortSignal[] = [];
    const fetchSchedules = jest.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<Awaited<ReturnType<SchedulePlacesApi['fetchSchedules']>>>((resolve) => { resolvers.push(resolve as (value: unknown) => void); }); });
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules }) });
    await waitFor(() => expect(fetchSchedules).toHaveBeenCalledTimes(1));
    await setFocus(false);
    expect(signals[0]!.aborted).toBe(true);
    await setFocus(true);
    await waitFor(() => expect(fetchSchedules).toHaveBeenCalledTimes(2));
    await act(async () => { resolvers[1]!({ anchor: '2026-11-06T00:30:00Z', schedules: [{ ...LUNCH, title: '새 일정' }] }); });
    expect(await screen.findByText('새 일정')).toBeOnTheScreen();
    // 먼저 보낸 조회가 뒤늦게 돌아와도 화면은 새 목록 그대로다.
    await act(async () => { resolvers[0]!({ anchor: '2026-11-06T00:30:00Z', schedules: [{ ...LUNCH, title: '옛 일정' }] }); });
    expect(screen.getByText('새 일정')).toBeOnTheScreen();
    expect(screen.queryByText('옛 일정')).toBeNull();
  });

  it('저장 중에 탭을 바꿔도 저장 요청은 취소되지 않고 끝까지 간다. 돌아오면 저장 뒤 상태를 읽는다', async () => {
    let finishSave: (value: unknown) => void = () => {};
    const saveSignals: AbortSignal[] = [];
    const saved = { id: 'lunch', place: null, locationText: null, noTravel: true, noTravelReason: null };
    const savePlace = jest.fn((_id: string, _change: unknown, signal: AbortSignal) => { saveSignals.push(signal); return new Promise<typeof saved>((resolve) => { finishSave = resolve as (value: unknown) => void; }); });
    const fetchSchedules = jest.fn()
      .mockResolvedValueOnce({ anchor: '2026-11-06T00:30:00Z', schedules: [LUNCH] })
      .mockResolvedValueOnce({ anchor: '2026-11-06T00:30:00Z', schedules: [{ ...LUNCH, ...saved }] });
    await setup({ scheduleApi: makeScheduleApi(undefined, { savePlace, fetchSchedules }) });
    await fireEvent.press(await findRowButton('육전집 점심'));
    await press('육전집 점심 이동 없음');
    await waitFor(() => expect(savePlace).toHaveBeenCalledTimes(1));

    await setFocus(false);
    expect(saveSignals[0]!.aborted).toBe(false);
    await setFocus(true);
    // 저장이 끝나기 전에는 다시 읽지 않는다(저장 전 상태를 읽어 되돌리지 않게).
    expect(fetchSchedules).toHaveBeenCalledTimes(1);
    await act(async () => { finishSave(saved); });
    await waitFor(() => expect(fetchSchedules).toHaveBeenCalledTimes(2));
    expect(saveSignals[0]!.aborted).toBe(false);
    await waitFor(() => expect(within(screen.getByTestId('today-row-lunch')).getByText('이동 없음')).toBeOnTheScreen());
  });
});

describe('오늘 탭: 맨 위(알림함·일정을 보낼 수 없는 이유·알림 권한)', () => {
  const NOTE = { id: '1', kind: 'late-sms', title: '늦을 것 같아요', body: '5분 늦는다고 보낼까요?', data: { who: 'mom' }, createdAt: '2026-11-06T00:00:00Z' };
  const makeInbox = async (...notes: (typeof NOTE)[]) => {
    const inbox = createInbox({ storage: createMemoryStore() });
    await inbox.load();
    await inbox.add(notes);
    return inbox;
  };
  const texts = () => {
    const ids: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { props?: { testID?: string }; children?: unknown[] };
      if (n.props?.testID) ids.push(n.props.testID);
      n.children?.forEach(walk);
    };
    const tree = screen.toJSON();
    (Array.isArray(tree) ? tree : [tree]).forEach(walk);
    return ids;
  };

  it('읽지 않은 알림을 맨 위에 보이고, 누르면 종류별 처리를 부르고 읽음이 되어 줄이 사라진다', async () => {
    const handler = jest.fn();
    const off = registerTapHandler('late-sms', handler);
    const inbox = await makeInbox(NOTE);
    await setup({ inbox, connectionSource: makeConnection(false), permissionsSource: makePermissions({ calendar: 'denied' }) });
    const row = await screen.findByRole('button', { name: '늦을 것 같아요 5분 늦는다고 보낼까요?' });
    // 알림함 → 권한 안내 → 차 연결 순서
    await screen.findByTestId('permission-guide');
    await screen.findByTestId('car-connection');
    const ids = texts();
    expect(ids.indexOf('inbox')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('inbox')).toBeLessThan(ids.indexOf('permission-guide'));
    expect(ids.indexOf('permission-guide')).toBeLessThan(ids.indexOf('car-connection'));
    await fireEvent.press(row);
    await waitFor(() => expect(handler).toHaveBeenCalledWith({ id: '1', kind: 'late-sms', data: { who: 'mom' } }));
    await waitFor(() => expect(screen.queryByTestId('inbox')).toBeNull());
    expect(inbox.getState().items[0]!.read).toBe(true);
    off();
  });

  it('이미 읽은 알림이나 빈 알림함이면 구역이 없다. 읽지 않은 것이 둘 이상이면 [모두 읽음]이 있다', async () => {
    const read = await makeInbox(NOTE);
    read.markRead('1');
    await setup({ inbox: read });
    await screen.findByText('육전집 점심');
    expect(screen.queryByTestId('inbox')).toBeNull();

    const two = await makeInbox(NOTE, { ...NOTE, id: '2', title: '가족 요청' });
    await setup({ inbox: two });
    await fireEvent.press(await screen.findByRole('button', { name: '모두 읽음' }));
    await waitFor(() => expect(two.getState().items.every((i) => i.read)).toBe(true));
  });

  it('알림 권한을 거부했으면 켜면 이게 돼요 한 줄과 [설정 열기]가 남는다. 아직 안 물었거나 허용이면 보이지 않는다', async () => {
    const denied = makePermissions({ notifications: 'denied' });
    await setup({ permissionsSource: denied, connectionSource: makeConnection(true) });
    const guide = within(await screen.findByTestId('permission-guide'));
    expect(guide.getByText('알림을 켜면 차곡 소식을 바로 알려 드려요. 꺼 두면 소식은 이 화면에만 쌓여요.')).toBeOnTheScreen();
    await fireEvent.press(guide.getByRole('button', { name: '알림 설정 열기' }));
    expect(denied.openSettings).toHaveBeenCalled();
  });

  it.each([['ask'], ['granted']] as const)('알림 권한이 %s면 홈에 안내하지 않는다', async (state) => {
    await setup({ permissionsSource: makePermissions({ notifications: state }), connectionSource: makeConnection(true) });
    await screen.findByText('육전집 점심');
    expect(screen.queryByTestId('permission-guide')).toBeNull();
  });

  it('일정을 보낼 수 없는 이유: 고른 캘린더가 없으면 한 줄과 [캘린더 고르기]가 맨 위 안내에 들어가고 탭에서 연 화면으로 간다', async () => {
    await setup({ sendBlock: 'no-selection' });
    const row = within(await screen.findByTestId('send-block-no-selection'));
    expect(row.getByText(/고른 캘린더가 없어서 일정을 차에 보내지 못하고 있어요/)).toBeOnTheScreen();
    await fireEvent.press(row.getByRole('button', { name: '캘린더 고르기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/calendar', params: { from: 'tab' } });
  });

  it('일정을 보낼 수 없는 이유: 권한이 꺼졌다고 알려 오면 권한 목록이 아직 켜짐이어도 캘린더 [설정 열기] 안내를 보인다', async () => {
    await setup({ sendBlock: 'permission-denied', permissionsSource: makePermissions({ calendar: 'granted' }) });
    const guide = within(await screen.findByTestId('permission-guide'));
    expect(guide.getByText('캘린더를 켜면 오늘 일정을 차에 보내 드려요.')).toBeOnTheScreen();
    expect(screen.queryByTestId('send-block-no-selection')).toBeNull();
  });

  it('보낼 수 없는 이유가 없으면(null) 안내가 없다', async () => {
    await setup({ sendBlock: null });
    await screen.findByText('육전집 점심');
    expect(screen.queryByTestId('send-block-no-selection')).toBeNull();
    expect(screen.queryByTestId('permission-guide')).toBeNull();
  });
});

describe('오늘 탭: 연락처 권한 안내(정책서 10.4 켜면 이게 돼요)', () => {
  it("'늦을 때 연락'이 켜져 있는데 연락처 권한을 거부했으면 홈 맨 위 안내에 [설정 열기]와 함께 남는다", async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await setup({ settingsApi: makeSettingsApi({ lateContact: true }), contactsSource: makeContacts('denied') });
    const guide = await screen.findByTestId('permission-contacts');
    expect(within(guide).getByText('연락처를 켜면 늦을 때 연락할 상대를 미리 찾아 둘 수 있어요. 꺼 두면 차가 연락할 때 번호를 물어요.')).toBeOnTheScreen();
    await fireEvent.press(within(guide).getByRole('button', { name: '연락처 설정 열기' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it.each([
    ['늦을 때 연락이 꺼져 있으면(연락처를 거부해도)', makeSettingsApi({ lateContact: false }), makeContacts('denied')],
    ['연락처 권한이 켜져 있으면', makeSettingsApi({ lateContact: true }), makeContacts('granted')],
    ['아직 한 번도 묻지 않았으면(ask)', makeSettingsApi({ lateContact: true }), makeContacts('ask')],
  ])('%s 안내가 없다', async (_label, settingsApi, contactsSource) => {
    await setup({ settingsApi, contactsSource });
    await screen.findByRole('button', { name: '차 연결하기' }).catch(() => undefined);
    await waitFor(() => expect(settingsApi.fetchSettings).toHaveBeenCalled());
    await waitFor(() => expect(contactsSource.permission).toHaveBeenCalled());
    expect(screen.queryByTestId('permission-contacts')).toBeNull();
  });

  it('설정을 읽지 못하면(오프라인) 안내를 보이지 않고 홈은 그대로 동작한다', async () => {
    const settingsApi = makeSettingsApi({ lateContact: true }, { fetchSettings: jest.fn().mockRejectedValue(new Error('offline')) });
    await setup({ settingsApi, contactsSource: makeContacts('denied') });
    await waitFor(() => expect(settingsApi.fetchSettings).toHaveBeenCalled());
    expect(screen.queryByTestId('permission-contacts')).toBeNull();
    expect(await findRowButton('육전집 점심')).toBeOnTheScreen();
  });
});
