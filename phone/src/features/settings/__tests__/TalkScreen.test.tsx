import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { TalkScreen } from '../TalkScreen';
import { deferred, makeContacts, makeSettingsApi, OFF } from '../testSupport';

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
const setup = (props: Partial<React.ComponentProps<typeof TalkScreen>> = {}) =>
  renderWith(<TalkScreen api={makeSettingsApi()} contactsSource={makeContacts('granted')} onLateContactChanged={jest.fn()} {...props} />);

beforeEach(() => mockPush.mockReset());

describe('첫 설정 4단계 · 말 거는 방법', () => {
  it('5단계 중 4단계 표시와 제목, 플러스 모드·늦을 때 연락 두 스위치만 보인다(음성만은 설정 탭에서만)', async () => {
    await setup();
    expect(screen.getByRole('header', { name: '말 거는 방법을 정해요' })).toBeOnTheScreen();
    expect(screen.getByText('4 / 5')).toBeOnTheScreen();
    expect(screen.getAllByTestId('progress-bar-filled')).toHaveLength(4);
    expect(screen.getAllByTestId('progress-bar-empty')).toHaveLength(1);
    expect(await screen.findByRole('switch', { name: '플러스 모드' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: '늦을 때 연락' })).not.toBeChecked();
    expect(screen.queryByRole('switch', { name: '화면 없이 음성만' })).toBeNull();
    expect(screen.getByText(/주행 중에는 먼저 말하지 않아요/)).toBeOnTheScreen();
  });

  it('[건너뛰기]는 아무것도 저장하지 않고 5단계(차 연결)로 간다', async () => {
    const api = makeSettingsApi();
    await setup({ api });
    await screen.findByRole('switch', { name: '플러스 모드' });
    await fireEvent.press(screen.getByRole('button', { name: '건너뛰기' }));
    expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('스위치는 바꾸는 즉시 서버에 저장하고 [다음]도 5단계로 간다', async () => {
    const api = makeSettingsApi();
    await setup({ api });
    await fireEvent.press(await screen.findByRole('switch', { name: '플러스 모드' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: '플러스 모드' })).toBeChecked());
    expect(api.saveSettings).toHaveBeenCalledWith({ plusMode: true }, expect.any(AbortSignal));
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
  });

  it('이미 저장된 값(뒤로 돌아온 경우)은 켜진 채 보인다', async () => {
    await setup({ api: makeSettingsApi({ plusMode: true, lateContact: true }) });
    expect(await screen.findByRole('switch', { name: '플러스 모드' })).toBeChecked();
    expect(screen.getByRole('switch', { name: '늦을 때 연락' })).toBeChecked();
  });

  it('늦을 때 연락을 켜면 연락처 권한을 묻고, 거부하면 켜 둔 채 안내를 보인다. 그래도 이어 갈 수 있다', async () => {
    const contacts = makeContacts('ask', 'denied');
    const onLateContactChanged = jest.fn();
    await setup({ contactsSource: contacts, onLateContactChanged });
    await fireEvent.press(await screen.findByRole('switch', { name: '늦을 때 연락' }));
    const notice = await screen.findByTestId('late-contact-permission-notice');
    expect(within(notice).getByText('상대를 미리 찾지 않아요. 차가 연락할 때 번호를 물어요.')).toBeOnTheScreen();
    expect(contacts.request).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch', { name: '늦을 때 연락' })).toBeChecked();
    await waitFor(() => expect(onLateContactChanged).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
  });

  it('저장에 실패하면 되돌리고 안내한다(연락처 권한은 묻지 않는다)', async () => {
    const contacts = makeContacts('ask');
    const api = makeSettingsApi({}, { saveSettings: jest.fn().mockRejectedValue(new HttpError(500, 'x')) });
    await setup({ api, contactsSource: contacts });
    await fireEvent.press(await screen.findByRole('switch', { name: '늦을 때 연락' }));
    await screen.findByTestId('switch-lateContact-issue');
    expect(screen.getByRole('switch', { name: '늦을 때 연락' })).not.toBeChecked();
    expect(contacts.request).not.toHaveBeenCalled();
  });

  it('저장하는 동안에는 [다음]·[건너뛰기]를 막는다', async () => {
    const pending = deferred<typeof OFF>();
    const api = makeSettingsApi({}, { saveSettings: jest.fn(() => pending.promise) });
    await setup({ api });
    await fireEvent.press(await screen.findByRole('switch', { name: '플러스 모드' }));
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '건너뛰기' })).toBeDisabled();
    pending.resolve({ ...OFF, plusMode: true });
    await waitFor(() => expect(screen.getByRole('button', { name: '다음' })).toBeEnabled());
  });

  it('로딩 중에는 진행 표시를 보이고, 읽지 못해도(오프라인) 안내와 [다시 시도]가 있으며 건너뛸 수 있다', async () => {
    const fetchSettings = jest.fn().mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = await setup({ api: makeSettingsApi({}, { fetchSettings }) });
    expect(await screen.findByLabelText('설정을 불러오는 중')).toBeOnTheScreen();
    await unmount();
    const failing = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...OFF, plusMode: true });
    await setup({ api: makeSettingsApi({}, { fetchSettings: failing }) });
    expect(await screen.findByText('설정을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '건너뛰기' }));
    expect(mockPush).toHaveBeenCalledWith('/setup/pair-car');
    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByRole('switch', { name: '플러스 모드' })).toBeChecked();
  });
});
