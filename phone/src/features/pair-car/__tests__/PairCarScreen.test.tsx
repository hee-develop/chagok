import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import type { PairingApi } from '../pairingApi';
import { PairCarScreen } from '../PairCarScreen';

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
}));

let mockGranted = false;
const mockRequestPermission = jest.fn();
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual('react-native');
  return {
    CameraView: (props: object) => <View {...props} />,
    useCameraPermissions: () => [{ granted: mockGranted }, mockRequestPermission],
  };
});

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const PAIRED = { seatId: 'seat-1', name: 'Pixel', mode: 'new' as const, pairedAt: '2026-11-06T00:20:00.000Z' };
const makeApi = (claim: PairingApi['claim'] = jest.fn().mockResolvedValue(PAIRED)): PairingApi => ({ claim, disconnect: jest.fn(), status: jest.fn() });
const renderScreen = (api: PairingApi, props: { onSkip?: () => void; onDone?: () => void; standalone?: boolean } = {}) =>
  render(
    <SafeAreaProvider initialMetrics={insets}>
      <PairCarScreen api={api} {...props} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockReplace.mockReset();
  mockBack.mockReset();
  mockCanGoBack = true;
  mockRequestPermission.mockReset();
  mockGranted = false;
});

it('4단계 진행 표시와 제목을 보이고, 번호 6자리를 넣어야 연결할 수 있다', async () => {
  const api = makeApi();
  await renderScreen(api);
  expect(screen.getByRole('header', { name: '차와 연결해요' })).toBeOnTheScreen();
  expect(screen.getByText('4 / 4')).toBeOnTheScreen();
  expect(screen.getAllByTestId('progress-bar-filled')).toHaveLength(4);
  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled();

  await fireEvent.changeText(screen.getByTestId('pair-code-input'), '123 45');
  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('pair-code-input'), '123 456');
  await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));

  expect(api.claim).toHaveBeenCalledWith('123456', expect.any(AbortSignal));
  expect(await screen.findByRole('header', { name: '✓ 차와 연결됐어요' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '완료' }));
  expect(mockReplace).toHaveBeenCalledWith('/setup/fill-places');
});

it('없거나 만료된 번호는 새 번호를 넣으라고 하고, 네트워크 실패는 같은 번호로 다시 시도한다', async () => {
  const claim = jest.fn()
    .mockRejectedValueOnce(new HttpError(404, 'POST /pair/claim 404'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(PAIRED);
  await renderScreen(makeApi(claim));

  await fireEvent.changeText(screen.getByTestId('pair-code-input'), '111111');
  await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));
  expect(await screen.findByText('번호가 맞지 않거나 시간이 지났어요. 차 화면의 새 번호로 다시 해 주세요.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();

  await fireEvent.changeText(screen.getByTestId('pair-code-input'), '222222');
  expect(screen.queryByText('번호가 맞지 않거나 시간이 지났어요. 차 화면의 새 번호로 다시 해 주세요.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));
  expect(await screen.findByText('연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

  await screen.findByRole('header', { name: '✓ 차와 연결됐어요' });
  expect(claim).toHaveBeenLastCalledWith('222222', expect.any(AbortSignal));
});

it('카메라를 허락하면 QR을 찍어 바로 연결하고, 차곡 QR이 아니면 알린다', async () => {
  mockRequestPermission.mockResolvedValue({ granted: true });
  const api = makeApi();
  await renderScreen(api);

  await fireEvent.press(screen.getByRole('button', { name: 'QR 찍기' }));
  const camera = await screen.findByTestId('pair-camera');
  await fireEvent(camera, 'barcodeScanned', { type: 'qr', data: 'https://example.com' });
  expect(await screen.findByText('차곡 차 화면의 QR이 아니에요.')).toBeOnTheScreen();
  expect(api.claim).not.toHaveBeenCalled();

  await fireEvent(camera, 'barcodeScanned', { type: 'qr', data: 'chagok://pair?code=654321' });
  await screen.findByRole('header', { name: '✓ 차와 연결됐어요' });
  expect(api.claim).toHaveBeenCalledTimes(1);
  expect(api.claim).toHaveBeenCalledWith('654321', expect.any(AbortSignal));
});

it('카메라를 거부하면 번호를 넣으라고 안내한다', async () => {
  mockRequestPermission.mockResolvedValue({ granted: false });
  await renderScreen(makeApi());
  await fireEvent.press(screen.getByRole('button', { name: 'QR 찍기' }));
  expect(await screen.findByText('카메라를 쓸 수 없어요. 차 화면의 번호를 넣어 주세요.')).toBeOnTheScreen();
  expect(screen.queryByTestId('pair-camera')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'QR 찍기' })).toBeOnTheScreen());
});

it('차에 폰이 가득이면(409)·요청이 몰려 잠시 막히면(429) 번호 오류와 다른 안내를 보이고 다시 시도 버튼은 없다', async () => {
  const claim = jest.fn()
    .mockRejectedValueOnce(new HttpError(409, 'POST /pair/claim 409'))
    .mockRejectedValueOnce(new HttpError(429, 'POST /pair/claim 429'));
  await renderScreen(makeApi(claim));

  await fireEvent.changeText(screen.getByTestId('pair-code-input'), '111111');
  await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));
  expect(await screen.findByText('이 차에는 더 연결할 수 없어요. 차에 연결된 폰이 많아요.')).toBeOnTheScreen();
  expect(screen.queryByText('번호가 맞지 않거나 시간이 지났어요. 차 화면의 새 번호로 다시 해 주세요.')).toBeNull();
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));
  expect(await screen.findByText('지금은 연결할 수 없어요. 잠시 뒤 다시 해 주세요.')).toBeOnTheScreen();
  expect(screen.queryByText('이 차에는 더 연결할 수 없어요. 차에 연결된 폰이 많아요.')).toBeNull();
  expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
});

it('onSkip이 없으면 건너뛰기 버튼이 없다(지금 동작 그대로. 기본 [완료] 이동은 첫 테스트가 본다)', async () => {
  await renderScreen(makeApi());
  expect(screen.queryByRole('button', { name: '건너뛰기' })).toBeNull();
});

it('onSkip을 주면 연결하기 전에 건너뛸 수 있고, 연결된 뒤에는 건너뛰기가 사라진다', async () => {
  const onSkip = jest.fn();
  await renderScreen(makeApi(), { onSkip });
  await fireEvent.press(screen.getByRole('button', { name: '건너뛰기' }));
  expect(onSkip).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByTestId('pair-code-input'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));
  await screen.findByRole('header', { name: '✓ 차와 연결됐어요' });
  expect(screen.queryByRole('button', { name: '건너뛰기' })).toBeNull();
});

it('onDone을 주면 [완료]가 기본 이동 대신 그 콜백을 부른다', async () => {
  const onDone = jest.fn();
  await renderScreen(makeApi(), { onDone });
  await fireEvent.changeText(screen.getByTestId('pair-code-input'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));
  await fireEvent.press(await screen.findByRole('button', { name: '완료' }));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

describe('standalone(오늘·설정 탭의 [차 연결하기])', () => {
  const connect = async () => {
    await fireEvent.changeText(screen.getByTestId('pair-code-input'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: '연결하기' }));
    return screen.findByRole('button', { name: '완료' });
  };

  it('단계 표시(4 / 4)가 없고 제목·번호 입력은 그대로다. 첫 설정 기본(standalone 없음)은 4 / 4가 보인다', async () => {
    const { unmount } = await renderScreen(makeApi(), { standalone: true });
    expect(screen.queryByText('4 / 4')).toBeNull();
    expect(screen.queryAllByTestId('progress-bar-filled')).toHaveLength(0);
    expect(screen.getByRole('header', { name: '차와 연결해요' })).toBeOnTheScreen();
    expect(screen.getByTestId('pair-code-input')).toBeOnTheScreen();
    await unmount();
    await renderScreen(makeApi());
    expect(screen.getByText('4 / 4')).toBeOnTheScreen();
  });

  it('연결한 뒤 [완료]는 3단계가 아니라 왔던 화면(탭)으로 되돌아간다', async () => {
    await renderScreen(makeApi(), { standalone: true });
    await fireEvent.press(await connect());
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('되돌아갈 화면이 없으면(딥링크로 바로 열림) 오늘 탭으로 간다', async () => {
    mockCanGoBack = false;
    await renderScreen(makeApi(), { standalone: true });
    await fireEvent.press(await connect());
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockReplace).not.toHaveBeenCalledWith('/setup/fill-places');
  });

  it('onDone을 함께 주면 그것이 우선한다', async () => {
    const onDone = jest.fn();
    await renderScreen(makeApi(), { standalone: true, onDone });
    await fireEvent.press(await connect());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });
});
