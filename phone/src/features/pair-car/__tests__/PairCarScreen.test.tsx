import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import type { PairingApi } from '../pairingApi';
import { PairCarScreen } from '../PairCarScreen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
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
const PAIRED = { carId: 'car-1', seatId: 'seat-1', name: 'Pixel', mode: 'new' as const, pairedAt: '2026-11-06T00:20:00.000Z' };
const makeApi = (claim: PairingApi['claim'] = jest.fn().mockResolvedValue(PAIRED)): PairingApi => ({ claim, disconnect: jest.fn() });
const renderScreen = (api: PairingApi) =>
  render(
    <SafeAreaProvider initialMetrics={insets}>
      <PairCarScreen api={api} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockReplace.mockReset();
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
