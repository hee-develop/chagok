import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { ScheduleCareScreen } from '../ScheduleCareScreen';
import type { SchedulePlacesApi } from '../schedulePlacesApi';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));
const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const makeApi = (saveCare: jest.Mock = jest.fn().mockResolvedValue({ id: 'kia', care: null })): SchedulePlacesApi => ({
  fetchSchedules: jest.fn(),
  savePlace: jest.fn(),
  undoNoTravel: jest.fn(),
  saveCare,
});
const renderScreen = (api: SchedulePlacesApi, initialCare = '') =>
  render(
    <SafeAreaProvider initialMetrics={insets}>
      <ScheduleCareScreen scheduleId="kia" title="KIA 직관" initialCare={initialCare} api={api} />
    </SafeAreaProvider>,
  );
beforeEach(() => {
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack = true;
});

it('적은 채비를 앞뒤 공백 없이 저장하고 일정 목록으로 돌아간다', async () => {
  const api = makeApi();
  await renderScreen(api);
  expect(screen.getByText('KIA 직관 채비')).toBeOnTheScreen();
  expect(screen.getByText('차에 탈 때 읽어 드려요. 캘린더에는 저장하지 않아요.')).toBeOnTheScreen();
  // 바꾼 것이 없으면 저장할 수 없다.
  expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('채비'), '  유니폼·응원봉·티켓 ');
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(api.saveCare).toHaveBeenCalledWith('kia', '유니폼·응원봉·티켓', expect.any(AbortSignal));
});

it('적어 둔 채비는 고치거나 지울 수 있고, 다 지우고 저장하면 null로 지운다', async () => {
  const api = makeApi();
  await renderScreen(api, '티켓');
  expect(screen.getByDisplayValue('티켓')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '채비 지우기' }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(api.saveCare).toHaveBeenLastCalledWith('kia', null, expect.any(AbortSignal));

  await fireEvent.changeText(screen.getByLabelText('채비'), '   ');
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(2));
  expect(api.saveCare).toHaveBeenLastCalledWith('kia', null, expect.any(AbortSignal));
});

it('저장에 실패하면 화면에 머물고 같은 내용으로 다시 시도한다', async () => {
  const saveCare = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'kia', care: '우산' });
  await renderScreen(makeApi(saveCare));
  await fireEvent.changeText(screen.getByLabelText('채비'), '우산');
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(saveCare).toHaveBeenCalledTimes(2);
  expect(saveCare).toHaveBeenLastCalledWith('kia', '우산', expect.any(AbortSignal));
});

it('일정이 사라져 4xx가 오면 목록에서 다시 확인하라고 안내하고 목록으로 돌려보낸다', async () => {
  mockCanGoBack = false;
  await renderScreen(makeApi(jest.fn().mockRejectedValue(new HttpError(404, 'gone'))));
  await fireEvent.changeText(screen.getByLabelText('채비'), '우산');
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('일정이 바뀌었어요. 목록에서 다시 확인해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '일정 목록으로' }));
  expect(mockReplace).toHaveBeenCalledWith('/setup/fill-places');
});
