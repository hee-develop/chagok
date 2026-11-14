import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makeConnection, makePermissions } from '../../../__tests__/support/todaySupport';
import { HttpError } from '../../../api/request';
import { SettingsScreen } from '../SettingsScreen';
import { deferred, makeContacts, makeSettingsApi, OFF } from '../testSupport';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWith = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);
const setup = (props: Partial<React.ComponentProps<typeof SettingsScreen>> = {}) =>
  renderWith(
    <SettingsScreen
      connectionSource={makeConnection(false)}
      permissionsSource={makePermissions()}
      settingsApi={makeSettingsApi()}
      contactsSource={makeContacts('granted')}
      onLateContactChanged={jest.fn()}
      {...props}
    />,
  );
const switchOf = (name: string) => screen.getByRole('switch', { name });

beforeEach(() => {
  mockPush.mockReset();
  mockNavigate.mockReset();
});

describe('설정 탭 · 고정 안내와 입구', () => {
  it('기본 말 걸기는 켜짐·끌 수 없음이고 주행 중 고정 안내를 늘 보인다(스위치가 아니다)', async () => {
    await setup();
    expect(await screen.findByText('주행 중에는 차곡이 먼저 말하지 않아요.')).toBeOnTheScreen();
    expect(screen.getByText('기본 말 걸기 · 항상 켜져 있어요')).toBeOnTheScreen();
    expect(screen.queryByRole('switch', { name: /기본 말 걸기/ })).toBeNull();
  });

  it('차 연결 입구와 캘린더 고르기 입구가 각 화면으로 이어진다', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: '차 연결하기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/pair-car', params: { from: 'tab' } });
    await fireEvent.press(screen.getByRole('button', { name: '캘린더 고르기' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/setup/calendar', params: { from: 'tab' } });
  });

  it('자주 가는 곳·기억한 장소·이동 없음 목록 입구는 장소 탭으로 이어진다', async () => {
    await setup();
    for (const label of ['자주 가는 곳 열기', '기억한 장소 열기', '이동 없음 목록 열기']) {
      mockNavigate.mockReset();
      await fireEvent.press(await screen.findByRole('button', { name: label }));
      expect(mockNavigate).toHaveBeenCalledWith('/places');
    }
    expect(within(screen.getByTestId('settings-places-frequent')).getByText('자주 가는 곳')).toBeOnTheScreen();
  });

  it('캘린더에 장소 적기는 두지 않는다(사용자가 뺀 기능)', async () => {
    await setup();
    await screen.findByRole('switch', { name: '플러스 모드' });
    expect(screen.queryByText(/캘린더에 장소/)).toBeNull();
  });
});

describe('설정 탭 · 스위치', () => {
  it('플러스 모드·늦을 때 연락·화면 없이 음성만이 모두 꺼짐으로 시작한다', async () => {
    await setup();
    for (const name of ['플러스 모드', '늦을 때 연락', '화면 없이 음성만']) {
      expect(await screen.findByRole('switch', { name })).not.toBeChecked();
    }
    expect(screen.getByText('켜면 주행 중 늦어질 때 일정당 한 번 먼저 말해요.')).toBeOnTheScreen();
  });

  it('서버에 켜져 있는 값은 켜진 스위치로 보인다', async () => {
    await setup({ settingsApi: makeSettingsApi({ plusMode: true, voiceOnly: true }) });
    expect(await screen.findByRole('switch', { name: '플러스 모드' })).toBeChecked();
    expect(switchOf('화면 없이 음성만')).toBeChecked();
    expect(switchOf('늦을 때 연락')).not.toBeChecked();
  });

  it('플러스 모드를 켜면 그 키만 서버에 저장하고, 켜면 일정당 한 번 먼저 말한다는 안내가 보인다', async () => {
    const api = makeSettingsApi();
    await setup({ settingsApi: api });
    await fireEvent.press(await screen.findByRole('switch', { name: '플러스 모드' }));
    await waitFor(() => expect(switchOf('플러스 모드')).toBeChecked());
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ plusMode: true }, expect.any(AbortSignal));
    expect(screen.getByText('주행 중 늦어질 때 일정당 한 번 먼저 말해요.')).toBeOnTheScreen();
    expect(switchOf('늦을 때 연락')).not.toBeChecked();
  });

  it('낙관적 갱신: 서버 응답 전에 스위치가 먼저 바뀌고, 저장 중에는 다른 스위치를 누를 수 없다', async () => {
    const pending = deferred<typeof OFF>();
    const api = makeSettingsApi({}, { saveSettings: jest.fn(() => pending.promise) });
    await setup({ settingsApi: api });
    await fireEvent.press(await screen.findByRole('switch', { name: '화면 없이 음성만' }));
    expect(switchOf('화면 없이 음성만')).toBeChecked();
    expect(switchOf('플러스 모드')).toBeDisabled();
    await fireEvent.press(switchOf('플러스 모드'));
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ...OFF, voiceOnly: true }));
    await waitFor(() => expect(switchOf('플러스 모드')).toBeEnabled());
    expect(switchOf('화면 없이 음성만')).toBeChecked();
  });

  it('저장에 실패하면 스위치를 되돌리고 안내한다. 다시 누르면 저장한다', async () => {
    // 첫 저장만 실패하고 그 뒤는 서버처럼 보낸 키를 반영한다.
    const saveSettings = jest.fn(async (patch: object) => ({ ...OFF, ...patch })).mockRejectedValueOnce(new HttpError(500, 'x'));
    const api = makeSettingsApi({}, { saveSettings });
    await setup({ settingsApi: api });
    await fireEvent.press(await screen.findByRole('switch', { name: '플러스 모드' }));
    expect(await screen.findByTestId('switch-plusMode-issue')).toHaveTextContent('저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    expect(switchOf('플러스 모드')).not.toBeChecked();
    await fireEvent.press(switchOf('플러스 모드'));
    await waitFor(() => expect(switchOf('플러스 모드')).toBeChecked());
    expect(screen.queryByTestId('switch-plusMode-issue')).toBeNull();
  });

  it('응답이 없는 저장은 시간 제한 뒤 되돌린다', async () => {
    const api = makeSettingsApi({}, { saveSettings: jest.fn(() => new Promise(() => {})) });
    await setup({ settingsApi: api, timeoutMs: 20 });
    await fireEvent.press(await screen.findByRole('switch', { name: '플러스 모드' }));
    expect(await screen.findByTestId('switch-plusMode-issue')).toBeOnTheScreen();
    expect(switchOf('플러스 모드')).not.toBeChecked();
  });

  it('로딩: 설정을 기다리는 동안 진행 표시를 보이고 스위치는 없다', async () => {
    await setup({ settingsApi: makeSettingsApi({}, { fetchSettings: jest.fn(() => new Promise(() => {})) }) });
    expect(await screen.findByLabelText('설정을 불러오는 중')).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('오류(오프라인 포함): 불러오지 못하면 안내와 [다시 시도]를 보이고 다시 시도하면 복구한다', async () => {
    const fetchSettings = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...OFF, plusMode: true });
    await setup({ settingsApi: makeSettingsApi({}, { fetchSettings }) });
    expect(await screen.findByText('설정을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.queryByRole('switch')).toBeNull();
    // 같은 화면의 권한 구역에도 '다시 시도'가 없도록 설정 구역의 버튼만 누른다.
    await fireEvent.press(within(screen.getByTestId('settings-switches')).getByText('다시 시도'));
    expect(await screen.findByRole('switch', { name: '플러스 모드' })).toBeChecked();
  });
});

describe('설정 탭 · 늦을 때 연락과 연락처 권한', () => {
  it('문자는 내용을 채운 문자 창으로 연다는 안내를 보이고, 문자 권한은 묻지 않는다', async () => {
    const contacts = makeContacts('granted');
    await setup({ contactsSource: contacts });
    expect(await screen.findByText('문자는 내용을 채운 문자 창으로 열어 드려요.')).toBeOnTheScreen();
    expect(contacts.request).not.toHaveBeenCalled();
  });

  it('켜면 서버에 저장한 뒤 연락처 권한을 묻고, 허용하면 안내가 없다', async () => {
    const api = makeSettingsApi();
    const contacts = makeContacts('ask', 'granted');
    const onLateContactChanged = jest.fn();
    await setup({ settingsApi: api, contactsSource: contacts, onLateContactChanged });
    await fireEvent.press(await screen.findByRole('switch', { name: '늦을 때 연락' }));
    await waitFor(() => expect(contacts.request).toHaveBeenCalledTimes(1));
    expect(api.saveSettings).toHaveBeenCalledWith({ lateContact: true }, expect.any(AbortSignal));
    await waitFor(() => expect(onLateContactChanged).toHaveBeenCalledTimes(1));
    expect(switchOf('늦을 때 연락')).toBeChecked();
    expect(screen.queryByTestId('late-contact-permission-notice')).toBeNull();
  });

  it('연락처 권한을 거부하면 기능은 켜 둔 채 상대를 미리 찾지 않는다는 안내와 설정 열기가 남는다', async () => {
    const contacts = makeContacts('ask', 'denied');
    await setup({ contactsSource: contacts });
    await fireEvent.press(await screen.findByRole('switch', { name: '늦을 때 연락' }));
    const notice = await screen.findByTestId('late-contact-permission-notice');
    expect(within(notice).getByText('상대를 미리 찾지 않아요. 차가 연락할 때 번호를 물어요.')).toBeOnTheScreen();
    expect(within(notice).getByRole('button', { name: '연락처 설정 열기' })).toBeOnTheScreen();
    expect(switchOf('늦을 때 연락')).toBeChecked();
  });

  it('이미 거부해 둔 채 켜져 있으면 처음부터 안내를 보인다. 꺼 두면 안내가 없다', async () => {
    const { unmount } = await setup({ settingsApi: makeSettingsApi({ lateContact: true }), contactsSource: makeContacts('denied') });
    expect(await screen.findByTestId('late-contact-permission-notice')).toBeOnTheScreen();
    await unmount();
    await setup({ settingsApi: makeSettingsApi({ lateContact: false }), contactsSource: makeContacts('denied') });
    await screen.findByRole('switch', { name: '늦을 때 연락' });
    expect(screen.queryByTestId('late-contact-permission-notice')).toBeNull();
  });

  it('권한을 아직 안 물은 채 켜져 있으면 [연락처 켜기]로 물을 수 있다', async () => {
    const contacts = makeContacts('ask', 'granted');
    await setup({ settingsApi: makeSettingsApi({ lateContact: true }), contactsSource: contacts });
    await fireEvent.press(await screen.findByRole('button', { name: '연락처 켜기' }));
    await waitFor(() => expect(contacts.request).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('late-contact-permission-notice')).toBeNull());
  });

  it('저장에 실패하면 연락처 권한을 묻지 않는다', async () => {
    const contacts = makeContacts('ask');
    const api = makeSettingsApi({}, { saveSettings: jest.fn().mockRejectedValue(new HttpError(500, 'x')) });
    await setup({ settingsApi: api, contactsSource: contacts });
    await fireEvent.press(await screen.findByRole('switch', { name: '늦을 때 연락' }));
    await screen.findByTestId('switch-lateContact-issue');
    expect(contacts.request).not.toHaveBeenCalled();
    expect(switchOf('늦을 때 연락')).not.toBeChecked();
  });

  it('끄면 연락처 권한을 묻지 않고 알린다', async () => {
    const contacts = makeContacts('granted');
    const onLateContactChanged = jest.fn();
    await setup({ settingsApi: makeSettingsApi({ lateContact: true }), contactsSource: contacts, onLateContactChanged });
    await fireEvent.press(await screen.findByRole('switch', { name: '늦을 때 연락' }));
    await waitFor(() => expect(onLateContactChanged).toHaveBeenCalledTimes(1));
    expect(contacts.request).not.toHaveBeenCalled();
  });
});

describe('설정 탭 · 차 연결 끊기', () => {
  const connected = () => makeConnection(true);

  it('연결돼 있지 않으면 끊기 버튼이 없다', async () => {
    await setup();
    await screen.findByRole('button', { name: '차 연결하기' });
    expect(screen.queryByRole('button', { name: '차 연결 끊기' })).toBeNull();
  });

  it('[차 연결 끊기]는 확인을 거치고, 서버의 연결·일정·기억을 지운다는 안내를 보인다. 취소하면 아무것도 하지 않는다', async () => {
    const pairing = { disconnect: jest.fn().mockResolvedValue(undefined) };
    await setup({ connectionSource: connected(), pairing });
    await fireEvent.press(await screen.findByRole('button', { name: '차 연결 끊기' }));
    expect(screen.getByText('차 연결을 끊을까요?')).toBeOnTheScreen();
    expect(screen.getByText(/서버에 있는 연결, 일정, 기억한 장소가 바로 삭제되고 차 화면 목록에서도 빠져요/)).toBeOnTheScreen();
    expect(pairing.disconnect).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('차 연결을 끊을까요?')).toBeNull();
    expect(pairing.disconnect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '차 연결 끊기' })).toBeOnTheScreen();
  });

  it('확인하면 끊고, 연결 상태와 설정을 다시 읽어 연결 전 상태가 된다', async () => {
    let paired = true;
    const connection = { status: jest.fn(async () => (paired ? { name: 'Pixel 9', pairedAt: '2026-11-06T00:30:00Z' } : null)) };
    const settingsClient = makeSettingsApi({ plusMode: true });
    const pairing = { disconnect: jest.fn(async () => { paired = false; settingsClient.fetchSettings.mockResolvedValue({ ...OFF }); }) };
    await setup({ connectionSource: connection, pairing, settingsApi: settingsClient });
    expect(await screen.findByText('✓ 차와 연결돼 있어요')).toBeOnTheScreen();
    expect(await screen.findByRole('switch', { name: '플러스 모드' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: '차 연결 끊기' }));
    await fireEvent.press(screen.getByRole('button', { name: '차 연결 끊기 확인' }));
    expect(await screen.findByText('차와 연결되지 않았어요')).toBeOnTheScreen();
    expect(pairing.disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '차 연결 끊기' })).toBeNull();
    // 자리와 함께 서버의 설정이 지워졌으니 다시 읽은 설정은 기본값이다.
    await waitFor(() => expect(switchOf('플러스 모드')).not.toBeChecked());
  });

  it('끊기에 실패하면 안내와 [다시 시도]를 보이고 연결은 그대로다', async () => {
    const disconnect = jest.fn().mockRejectedValueOnce(new HttpError(500, 'x')).mockResolvedValueOnce(undefined);
    await setup({ connectionSource: connected(), pairing: { disconnect } });
    await fireEvent.press(await screen.findByRole('button', { name: '차 연결 끊기' }));
    await fireEvent.press(screen.getByRole('button', { name: '차 연결 끊기 확인' }));
    expect(await screen.findByTestId('disconnect-failed')).toHaveTextContent('연결을 끊지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    expect(screen.getByText('✓ 차와 연결돼 있어요')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('disconnect-failed')).toBeNull());
  });

  it('끊는 동안 버튼을 막아 두 번 보내지 않는다', async () => {
    const pending = deferred<void>();
    const disconnect = jest.fn(() => pending.promise);
    await setup({ connectionSource: connected(), pairing: { disconnect } });
    await fireEvent.press(await screen.findByRole('button', { name: '차 연결 끊기' }));
    await fireEvent.press(screen.getByRole('button', { name: '차 연결 끊기 확인' }));
    expect(await screen.findByText('끊는 중')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '차 연결 끊기 확인' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: '차 연결 끊기 확인' }));
    expect(disconnect).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });
});

describe('설정 탭 · 권한 구역', () => {
  it('권한 구역은 켜진 권한을 켜져 있어요로, 꺼진 권한은 켜는 버튼으로 보인다', async () => {
    await setup({ permissionsSource: makePermissions({ calendar: 'granted', camera: 'denied' }) });
    const perms = within(await screen.findByTestId('permission-calendar'));
    expect(perms.getByText('✓ 켜져 있어요')).toBeOnTheScreen();
    expect(within(screen.getByTestId('permission-camera')).getByText(/카메라를 켜면/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '카메라 설정 열기' })).toBeOnTheScreen();
  });

  it('알림 권한도 같은 구역에 보이고 아직 안 물었으면 [켜기]로 요청한다', async () => {
    const permissions = makePermissions({ notifications: 'ask' });
    await setup({ permissionsSource: permissions });
    const row = within(await screen.findByTestId('permission-notifications'));
    expect(row.getByText(/알림을 켜면 차곡 소식을 바로 알려 드려요/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '알림 켜기' }));
    expect(permissions.request).toHaveBeenCalledWith('notifications');
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
