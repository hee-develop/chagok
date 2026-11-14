import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import type { FamilyApi, FamilyRequest } from '../familyApi';
import { FamilySendScreen } from '../FamilySendScreen';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));
const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const MEMBERS = [{ id: 'family-mom', name: '엄마' }, { id: 'family-brother', name: '동생' }];
const request = (memberId: string): FamilyRequest => ({
  id: `kia:${memberId}`, scheduleId: 'kia', memberId, memberName: memberId === 'family-mom' ? '엄마' : '동생', title: 'KIA 직관',
  start: '2026-11-06T08:00:00.000Z', end: '2026-11-06T11:00:00.000Z', locationText: null, place: null, care: null,
  status: 'delivered', sentAt: '2026-11-06T00:20:00.000Z',
});
const makeApi = (overrides: Partial<FamilyApi> = {}): FamilyApi => ({
  fetchMembers: jest.fn().mockResolvedValue(MEMBERS),
  fetchRequests: jest.fn().mockResolvedValue([]),
  send: jest.fn().mockImplementation(async (_s: string, memberId: string) => request(memberId)),
  ...overrides,
});
const renderScreen = (api: FamilyApi) =>
  render(
    <SafeAreaProvider initialMetrics={insets}>
      <FamilySendScreen scheduleId="kia" title="KIA 직관" api={api} />
    </SafeAreaProvider>,
  );
beforeEach(() => {
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack = true;
});

it('묶어 둔 가족을 보여 주고, 보내면 그 가족 줄이 전달됨으로 바뀐다', async () => {
  const api = makeApi();
  await renderScreen(api);
  expect(await screen.findByText('엄마')).toBeOnTheScreen();
  expect(screen.getByText('‘KIA 직관’ 일정을 주소 · 채비와 함께 보내요.')).toBeOnTheScreen();
  expect(api.fetchRequests).toHaveBeenCalledWith('kia', expect.any(AbortSignal));
  await fireEvent.press(screen.getByRole('button', { name: '엄마에게 보내기' }));
  await waitFor(() => expect(screen.getByText('✓ 전달됨')).toBeOnTheScreen());
  expect(api.send).toHaveBeenCalledWith('kia', 'family-mom', expect.any(AbortSignal));
  expect(screen.getByRole('button', { name: '엄마에게 다시 보내기' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '동생에게 보내기' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '완료' }));
  expect(mockBack).toHaveBeenCalled();
});

it('이미 보낸 가족은 처음부터 전달됨으로 보인다', async () => {
  await renderScreen(makeApi({ fetchRequests: jest.fn().mockResolvedValue([request('family-brother')]) }));
  expect(await screen.findByRole('button', { name: '동생에게 다시 보내기' })).toBeOnTheScreen();
  expect(screen.getAllByText('✓ 전달됨')).toHaveLength(1);
});

it('불러오기에 실패하면 다시 시도할 수 있다', async () => {
  const fetchMembers = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(MEMBERS);
  await renderScreen(makeApi({ fetchMembers }));
  expect(await screen.findByText('가족을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('엄마')).toBeOnTheScreen();
});

it('보내기에 실패하면 같은 가족에게 다시 보낸다', async () => {
  const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(request('family-mom'));
  await renderScreen(makeApi({ send }));
  await fireEvent.press(await screen.findByRole('button', { name: '엄마에게 보내기' }));
  expect(await screen.findByText('보내지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() => expect(screen.getByText('✓ 전달됨')).toBeOnTheScreen());
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith('kia', 'family-mom', expect.any(AbortSignal));
});

it('일정이 사라져 4xx가 오면 목록에서 다시 확인하라고 안내하고 목록으로 돌려보낸다', async () => {
  mockCanGoBack = false;
  await renderScreen(makeApi({ send: jest.fn().mockRejectedValue(new HttpError(404, 'gone')) }));
  await fireEvent.press(await screen.findByRole('button', { name: '엄마에게 보내기' }));
  expect(await screen.findByText('일정이 바뀌었어요. 목록에서 다시 확인해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '일정 목록으로' }));
  expect(mockReplace).toHaveBeenCalledWith('/setup/fill-places');
});
