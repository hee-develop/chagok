import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FAMILY, NOW, makeFamilyApi, sentCare, withFamily } from '../../../__tests__/support/familySupport';
import { deliverPlace } from '../../places/placePicker';
import { FamilyHttpError } from '../familyGroupApi';
import { FamilyRequestScreen, sendIssueMessage } from '../FamilyRequestScreen';

const mockNavigate = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ navigate: mockNavigate, push: mockPush, back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWith = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);
const setup = async (api = makeFamilyApi(), now: () => Date = () => NOW) => {
  await renderWith(<FamilyRequestScreen api={api} now={now} />);
  return { api };
};
const choose = (name: string) => fireEvent.press(screen.getByRole('radio', { name }));
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const type = (label: string, value: string) => fireEvent.changeText(screen.getByLabelText(label), value);
const ready = () => screen.findByRole('radio', { name: '채비' });
const lastBody = (api: ReturnType<typeof makeFamilyApi>) => api.createRequest.mock.calls.at(-1)![0];

beforeEach(() => {
  mockNavigate.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack.mockReset().mockReturnValue(true);
});

describe('요청 만들기: 상태', () => {
  it('로딩: 가족을 읽는 동안 진행 표시를 보인다', async () => {
    await setup(makeFamilyApi({ fetchFamily: jest.fn(() => new Promise(() => {})) }));
    expect(await screen.findByLabelText('가족 정보를 불러오는 중')).toBeOnTheScreen();
  });

  it('오류: 불러오지 못하면 [다시 시도]로 복구한다', async () => {
    const fetchFamily = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(FAMILY);
    await setup(makeFamilyApi({ fetchFamily }));
    expect(await screen.findByText('가족 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await press('다시 시도');
    await ready();
  });

  it('가족이 없으면 가족 탭으로 안내한다', async () => {
    await setup(makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null) }));
    expect(await screen.findByText('가족을 먼저 묶어 주세요. 가족 탭에서 가족을 만들거나 초대 코드로 들어올 수 있어요.')).toBeOnTheScreen();
    await press('가족 탭으로');
    expect(mockNavigate).toHaveBeenCalledWith('/family');
    expect(screen.queryByRole('radio', { name: '채비' })).toBeNull();
  });

  it('처음에는 카테고리 4종만 보이고 고르면 받는 사람·내용·메모·[보내기]가 나온다', async () => {
    await setup();
    await ready();
    for (const name of ['채비', '들르기', '약속 가기', '데려다주기·픽업']) expect(screen.getByRole('radio', { name })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '보내기' })).toBeNull();
    await choose('채비');
    expect(screen.getByRole('radio', { name: '채비' })).toBeSelected();
    expect(screen.getByTestId('request-recipient')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '보내기' })).toBeOnTheScreen();
  });
});

describe('받는 사람', () => {
  it("가족 한 사람(차 연결 여부 표시)과 '우리 차'(가족 폰이 연결된 차)를 고를 수 있다. 나는 없다", async () => {
    await setup();
    await ready();
    await choose('채비');
    expect(screen.getByRole('radio', { name: '엄마' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: '지우' })).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: '아빠' })).toBeNull();
    expect(screen.getByRole('radio', { name: '우리 차 · 엄마 연결' })).toBeOnTheScreen();
    expect(screen.getByText('차에 연결하지 않은 가족에게 보내면 그 사람 폰 앱에서만 보여요.')).toBeOnTheScreen();
  });

  it("가족 폰이 연결된 차가 없으면 '우리 차'가 선택지에 안 보이고 이유를 알려 준다", async () => {
    await setup(makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ cars: [] })) }));
    await ready();
    await choose('채비');
    expect(screen.queryByText(/^우리 차/)).toBeNull();
    expect(screen.getByText('가족 폰이 연결된 차가 없어서 ‘우리 차’는 고를 수 없어요.')).toBeOnTheScreen();
  });

  it('차가 둘이면 번호를 붙여 구분한다', async () => {
    const cars = [{ carRef: 'car-1', memberIds: ['mom1'] }, { carRef: 'car-2', memberIds: ['kid1'] }];
    await setup(makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ cars })) }));
    await ready();
    await choose('채비');
    expect(screen.getByRole('radio', { name: '우리 차 1 · 엄마 연결' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: '우리 차 2 · 지우 연결' })).toBeOnTheScreen();
  });

  it('가족이 나 혼자이고 차도 없으면 보낼 곳이 없다고 안내한다', async () => {
    await setup(makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ members: [FAMILY.members[0]!], cars: [] })) }));
    await ready();
    await choose('채비');
    expect(screen.getByText('보낼 수 있는 가족이 아직 없어요. 가족이 초대 코드로 들어오면 보낼 수 있어요.')).toBeOnTheScreen();
  });
});

describe('카테고리 4종 보내기', () => {
  it('채비: 물건·가져갈 때/가져올 때·날짜·메모를 보내고 가족 탭의 그 요청으로 간다', async () => {
    const { api } = await setup();
    await ready();
    await choose('채비');
    await choose('엄마');
    await type('물건', '우산');
    await choose('가져올 때');
    await choose('내일');
    await type('한 줄 메모', '현관 앞에 두기');
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api)).toEqual({ category: 'care', recipient: { memberId: 'mom1' }, item: '우산', timing: 'bring-back', date: '2026-11-07', memo: '현관 앞에 두기' });
    expect(api.createRequest.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/family', params: { request: 'new-1' } }));
  });

  it("들르기: 장소를 장소 검색 화면에서 골라 글자+좌표로 보내고, '우리 차'에 보낸다", async () => {
    const { api } = await setup();
    await ready();
    await choose('들르기');
    await choose('우리 차 · 엄마 연결');
    await press('들를 곳 찾기');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/place-search', params: { picker: 'request-place' } });
    // 장소 검색 화면이 고른 장소를 돌려준다
    await act(async () => { deliverPlace('request-place', { text: '다이소 상무점', lat: 35.15, lng: 126.85 }); });
    expect(screen.getByLabelText('들를 곳').props.value).toBe('다이소 상무점');
    expect(screen.getByText('좌표를 함께 보내요')).toBeOnTheScreen();
    await type('살 것·찾을 것', '건전지');
    await choose('시각까지');
    await type('몇 시까지', '1830');
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api)).toEqual({
      category: 'stop', recipient: { carRef: 'car-1' }, place: { text: '다이소 상무점', lat: 35.15, lng: 126.85 }, item: '건전지', deadline: { type: 'by', time: '18:30' }, date: '2026-11-06',
    });
  });

  it('장소 글자를 직접 고치면 좌표를 버리고 글자만 보낸다', async () => {
    const { api } = await setup();
    await ready();
    await choose('들르기');
    await choose('엄마');
    await act(async () => { deliverPlace('request-place', { text: '다이소 상무점', lat: 35.15, lng: 126.85 }); });
    await type('들를 곳', '동네 마트');
    expect(screen.getByText('글자만 보내요')).toBeOnTheScreen();
    await type('살 것·찾을 것', '우유');
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api)).toMatchObject({ place: { text: '동네 마트' }, deadline: { type: 'today' } });
    expect(lastBody(api).place).not.toHaveProperty('lat');
  });

  it('약속 가기: 시각·장소·함께 가는 사람을 서울 시각으로 보낸다', async () => {
    const { api } = await setup();
    await ready();
    await choose('약속 가기');
    await choose('엄마');
    await type('시각', '1800');
    await type('가는 곳', '챔피언스필드');
    await type('함께 가는 사람', '지우, 하준');
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api)).toEqual({ category: 'appointment', recipient: { memberId: 'mom1' }, at: '2026-11-06T18:00:00+09:00', place: { text: '챔피언스필드' }, companions: ['지우', '하준'] });
  });

  it('데려다주기·픽업: 누구를·어디서·어디로·몇 시', async () => {
    const { api } = await setup();
    await ready();
    await choose('데려다주기·픽업');
    await choose('엄마');
    await type('누구를', '지우');
    await type('어디서', '학원');
    await act(async () => { deliverPlace('request-dropoff', { text: '집', lat: 35.1, lng: 126.8 }); });
    await choose('내일');
    await type('몇 시에', '0830');
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api)).toEqual({
      category: 'ride', recipient: { memberId: 'mom1' }, who: '지우', pickup: { text: '학원' }, dropoff: { text: '집', lat: 35.1, lng: 126.8 }, at: '2026-11-07T08:30:00+09:00',
    });
  });

  it('시각 칸은 숫자 키패드이고 입력을 마치면 HH:MM으로 맞춘다', async () => {
    await setup();
    await ready();
    await choose('약속 가기');
    const time = screen.getByLabelText('시각');
    expect(time.props.keyboardType).toBe('number-pad');
    await fireEvent.changeText(time, '930');
    await fireEvent(time, 'endEditing');
    expect(screen.getByLabelText('시각').props.value).toBe('09:30');
  });
});

describe('입력 검증', () => {
  it('비운 채 보내면 요청하지 않고 칸마다 오류를 보인다', async () => {
    const { api } = await setup();
    await ready();
    await choose('데려다주기·픽업');
    await press('보내기');
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(screen.getByText('받는 사람을 골라 주세요.')).toBeOnTheScreen();
    expect(screen.getByText('누구를 데려다주는지 적어 주세요.')).toBeOnTheScreen();
    expect(screen.getAllByText('장소를 적거나 찾아 주세요.')).toHaveLength(2);
    expect(screen.getByText('시각을 24시간으로 적어 주세요. 예: 18:30')).toBeOnTheScreen();
    expect(screen.getByText('표시된 칸을 고쳐 주세요.')).toBeOnTheScreen();
    expect(screen.getByLabelText('누구를')).toBeOnTheScreen();
  });

  it('이미 지난 시각은 막는다', async () => {
    const { api } = await setup();
    await ready();
    await choose('약속 가기');
    await choose('엄마');
    await type('시각', '0900');
    await type('가는 곳', '병원');
    await press('보내기');
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(screen.getByText('이미 지난 시각이에요. 지금 이후의 시각으로 적어 주세요.')).toBeOnTheScreen();
  });

  it('오류는 고치면 바로 사라진다', async () => {
    await setup();
    await ready();
    await choose('채비');
    await press('보내기');
    expect(screen.getByText('물건을 적어 주세요.')).toBeOnTheScreen();
    await choose('엄마');
    await type('물건', '우산');
    await choose('가져갈 때');
    expect(screen.queryByText('물건을 적어 주세요.')).toBeNull();
    expect(screen.queryByText('표시된 칸을 고쳐 주세요.')).toBeNull();
  });

  it('메모는 한 줄 30자 안내: 30자 안쪽이면 읽어 준다는 안내, 넘으면 메모가 있어요만 말한다는 안내(막지는 않는다)', async () => {
    await setup();
    await ready();
    await choose('채비');
    expect(screen.getByText('30자 안쪽이면 차가 읽어 드려요. 더 길면 ‘메모가 있어요’라고만 말해요.')).toBeOnTheScreen();
    await type('한 줄 메모', 'ㄱ'.repeat(30));
    expect(screen.getByText('30자')).toBeOnTheScreen();
    await type('한 줄 메모', 'ㄱ'.repeat(31));
    expect(screen.getByText('31자 · 30자가 넘어서 차는 ‘메모가 있어요’라고만 말해요.')).toBeOnTheScreen();
    expect(screen.getByLabelText('한 줄 메모').props.maxLength).toBe(100);
  });

  it('메모의 줄바꿈은 공백으로 바꾼다', async () => {
    await setup();
    await ready();
    await choose('채비');
    await type('한 줄 메모', '가\n나');
    expect(screen.getByLabelText('한 줄 메모').props.value).toBe('가 나');
  });
});

describe('보내기와 서버 오류', () => {
  const fillCare = async () => {
    await ready();
    await choose('채비');
    await choose('엄마');
    await type('물건', '우산');
    await choose('가져갈 때');
  };
  const reject = (status: number, reason: string, message: string | null = null) => jest.fn().mockRejectedValue(new FamilyHttpError(status, 'POST /requests', { reason, retryAfterSeconds: null, message }));

  it('보내는 중에는 한 번만 보내고 버튼을 막는다', async () => {
    let resolve: (value: ReturnType<typeof sentCare>) => void = () => {};
    const createRequest = jest.fn(() => new Promise<ReturnType<typeof sentCare>>((r) => { resolve = r; }));
    await setup(makeFamilyApi({ createRequest }));
    await fillCare();
    await press('보내기');
    await press('보내기');
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('보내는 중')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
    await act(async () => resolve(sentCare({ id: 'late' })));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/family', params: { request: 'late' } }));
  });

  it.each([
    ['서버 시각 판단(400 bad-request: 서버 문장에 기대지 않고 같은 안내)', 400, 'bad-request', '이미 지난 시각입니다. 지금 이후의 시각으로 보내 주세요', '입력한 내용을 다시 확인해 주세요.'],
    ['그 밖의 입력 오류(400 bad-request)', 400, 'bad-request', 'item는 60자 이하여야 합니다', '입력한 내용을 다시 확인해 주세요.'],
    ['자기 자신(400 self)', 400, 'self', null, '자기 자신에게는 보낼 수 없어요.'],
    ['가족에서 나옴(409 not-in-family)', 409, 'not-in-family', null, '가족에서 나온 상태예요. 가족 탭에서 다시 묶어 주세요.'],
    ['요청 수 초과(429 too-many-requests)', 429, 'too-many-requests', null, '보낼 수 있는 요청 수를 넘었어요. 끝난 요청이 지워진 뒤에 다시 해 주세요.'],
  ] as const)('%s는 이유를 알려 주고 화면에 남는다', async (_name, status, reason, serverMessage, expected) => {
    const { api } = await setup(makeFamilyApi({ createRequest: reject(status, reason, serverMessage) }));
    await fillCare();
    await press('보내기');
    expect(await screen.findByText(expected)).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(api.createRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled();
  });

  it("고른 '우리 차'가 사라졌으면(400 unknown-car) 받는 사람을 비우고 가족을 다시 읽는다", async () => {
    const fetchFamily = jest.fn().mockResolvedValueOnce(FAMILY).mockResolvedValue(withFamily({ cars: [] }));
    await setup(makeFamilyApi({ fetchFamily, createRequest: reject(400, 'unknown-car') }));
    await ready();
    await choose('채비');
    await choose('우리 차 · 엄마 연결');
    await type('물건', '우산');
    await choose('가져갈 때');
    await press('보내기');
    expect(await screen.findByText('그 차는 지금 고를 수 없어요. 받는 사람을 다시 골라 주세요.')).toBeOnTheScreen();
    await waitFor(() => expect(fetchFamily).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('radio', { name: '우리 차 · 엄마 연결' })).toBeNull());
    expect(screen.getByRole('radio', { name: '엄마' })).not.toBeSelected();
  });

  describe('결과를 알 수 없는 실패(시간 초과·네트워크·5xx)는 보낸 목록을 읽어 중복을 막는다', () => {
    const offline = () => jest.fn().mockRejectedValue(new Error('offline'));
    const mine = (change: Partial<ReturnType<typeof sentCare>> = {}) => sentCare({ id: 'already-1', createdAt: NOW.toISOString(), ...change });

    it('이미 보내졌으면(같은 내용이 방금 보낸 목록에 있으면) 다시 보내지 않고 그 요청으로 이동한다', async () => {
      const api = makeFamilyApi({ createRequest: offline(), fetchRequests: jest.fn().mockResolvedValue({ sent: [mine({ item: '우산', timing: 'take-along' })], received: [] }) });
      await setup(api);
      await fillCare();
      await press('보내기');
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/family', params: { request: 'already-1' } }));
      expect(api.createRequest).toHaveBeenCalledTimes(1);
      expect(api.fetchRequests).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/보내지 못했어요/)).toBeNull();
    });

    it('5xx도 같다', async () => {
      const api = makeFamilyApi({
        createRequest: jest.fn().mockRejectedValue(new FamilyHttpError(503, 'POST /requests', { reason: null, retryAfterSeconds: null, message: null })),
        fetchRequests: jest.fn().mockResolvedValue({ sent: [mine({ item: '우산', timing: 'take-along' })], received: [] }),
      });
      await setup(api);
      await fillCare();
      await press('보내기');
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/family', params: { request: 'already-1' } }));
    });

    it('목록에 같은 요청이 없을 때만 다시 보내기를 허용한다(없다고 안내하고 버튼은 다시 눌린다)', async () => {
      const createRequest = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(sentCare({ id: 'second' }));
      const api = makeFamilyApi({ createRequest });
      await setup(api);
      await fillCare();
      await press('보내기');
      expect(await screen.findByText('보내지 못했어요. 보낸 요청 목록을 확인했는데 이 요청은 없어요. 다시 보내 주세요.')).toBeOnTheScreen();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled();
      await press('보내기');
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/family', params: { request: 'second' } }));
      expect(createRequest).toHaveBeenCalledTimes(2);
    });

    it('보내기 전부터 있던 같은 내용의 요청은 방금 보낸 것으로 보지 않는다', async () => {
      const api = makeFamilyApi({ createRequest: offline(), fetchRequests: jest.fn().mockResolvedValue({ sent: [mine({ item: '우산', timing: 'take-along', createdAt: '2026-11-06T00:00:00.000Z' })], received: [] }) });
      await setup(api);
      await fillCare();
      await press('보내기');
      expect(await screen.findByText('보내지 못했어요. 보낸 요청 목록을 확인했는데 이 요청은 없어요. 다시 보내 주세요.')).toBeOnTheScreen();
    });

    it('목록도 읽지 못하면 이미 보내졌을 수 있다고만 안내한다', async () => {
      const api = makeFamilyApi({ createRequest: offline(), fetchRequests: jest.fn().mockRejectedValue(new Error('offline')) });
      await setup(api);
      await fillCare();
      await press('보내기');
      expect(await screen.findByText('보내지 못했어요. 이미 보내졌을 수 있으니 가족 탭의 보낸 요청을 확인한 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('확인하는 동안에는 보내기를 다시 누를 수 없다', async () => {
      let resolve: (value: { sent: never[]; received: never[] }) => void = () => {};
      const fetchRequests = jest.fn(() => new Promise<{ sent: never[]; received: never[] }>((r) => { resolve = r; }));
      const api = makeFamilyApi({ createRequest: offline(), fetchRequests });
      await setup(api);
      await fillCare();
      await press('보내기');
      expect(await screen.findByLabelText('보냈는지 확인하는 중')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
      await press('보내기');
      expect(api.createRequest).toHaveBeenCalledTimes(1);
      await act(async () => resolve({ sent: [], received: [] }));
    });

    it('4xx 거절에는 목록을 읽지 않는다', async () => {
      const api = makeFamilyApi({ createRequest: reject(400, 'bad-request') });
      await setup(api);
      await fillCare();
      await press('보내기');
      await screen.findByText('입력한 내용을 다시 확인해 주세요.');
      expect(api.fetchRequests).not.toHaveBeenCalled();
    });
  });

  it('[취소]는 이전 화면으로 돌아가고, 돌아갈 곳이 없으면 가족 탭으로 간다', async () => {
    await setup();
    await ready();
    await press('취소');
    expect(mockBack).toHaveBeenCalled();
    mockCanGoBack.mockReturnValue(false);
    await press('취소');
    expect(mockReplace).toHaveBeenCalledWith('/family');
  });
});

describe('자정 경계', () => {
  it('폼을 연 뒤 서울 날짜가 바뀌었으면 보내지 않고 다시 확인하게 한다. 다시 누르면 새 기준 날짜로 보낸다', async () => {
    let clock = NOW;
    const { api } = await setup(makeFamilyApi(), () => clock);
    await ready();
    await choose('채비');
    await choose('엄마');
    await type('물건', '우산');
    await choose('가져갈 때');
    clock = new Date('2026-11-06T15:30:00Z'); // 서울 11-07 00:30
    await press('보내기');
    expect(await screen.findByText('날짜가 바뀌었어요. 오늘·내일을 다시 확인한 뒤 보내 주세요.')).toBeOnTheScreen();
    expect(api.createRequest).not.toHaveBeenCalled();
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api)).toMatchObject({ date: '2026-11-07' });
  });

  it('날짜가 안 바뀌었으면 연 때 기준으로 오늘·내일을 고정한다', async () => {
    let clock = NOW;
    const { api } = await setup(makeFamilyApi(), () => clock);
    await ready();
    await choose('채비');
    await choose('엄마');
    await type('물건', '우산');
    await choose('가져갈 때');
    await choose('내일');
    clock = new Date('2026-11-06T14:00:00Z'); // 같은 서울 날짜(11-06 23:00)
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api)).toMatchObject({ date: '2026-11-07' });
  });
});

describe('들르기 기한·장소 길이', () => {
  it('들르기 기한이 오늘의 이미 지난 시각이면 폰에서 막는다', async () => {
    const { api } = await setup();
    await ready();
    await choose('들르기');
    await choose('엄마');
    await type('들를 곳', '다이소');
    await type('살 것·찾을 것', '건전지');
    await choose('시각까지');
    await type('몇 시까지', '0900');
    await press('보내기');
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(screen.getByText('이미 지난 시각이에요. 지금 이후의 시각으로 적어 주세요.')).toBeOnTheScreen();
  });

  it('고른 장소 이름이 서버 길이 제한(100자)을 넘으면 잘라 넣고 좌표는 그대로 둔다', async () => {
    const { api } = await setup();
    await ready();
    await choose('들르기');
    await choose('엄마');
    await act(async () => { deliverPlace('request-place', { text: '가'.repeat(150), lat: 35.1, lng: 126.8 }); });
    expect(screen.getByLabelText('들를 곳').props.value).toHaveLength(100);
    expect(screen.getByText('좌표를 함께 보내요')).toBeOnTheScreen();
    await type('살 것·찾을 것', '건전지');
    await press('보내기');
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(lastBody(api).place).toEqual({ text: '가'.repeat(100), lat: 35.1, lng: 126.8 });
  });
});

describe('서버 오류 문구 정하기', () => {
  const err = (status: number, reason: string | null, message: string | null = null) => new FamilyHttpError(status, 'x', { reason, retryAfterSeconds: null, message });

  it('이유 코드와 상태로 문구를 가르고, 가족이 달라졌을 수 있는 거절은 가족을 다시 읽게 한다', () => {
    expect(sendIssueMessage(err(400, 'unknown-recipient'))).toMatchObject({ message: '우리 가족이 아닌 사람이에요. 받는 사람을 다시 골라 주세요.', reloadFamily: true });
    expect(sendIssueMessage(err(401, null))).toMatchObject({ message: '가족에서 나온 상태예요. 가족 탭에서 다시 묶어 주세요.', reloadFamily: true });
    expect(sendIssueMessage(err(413, null))).toMatchObject({ message: '입력한 내용을 다시 확인해 주세요.', reloadFamily: false });
    expect(sendIssueMessage(err(500, null))).toMatchObject({ indeterminate: true });
    expect(sendIssueMessage(err(500, null)).message).toContain('이미 보내졌을 수 있으니');
    expect(sendIssueMessage(new Error('timeout'))).toMatchObject({ indeterminate: true });
    expect(sendIssueMessage(err(400, 'bad-request', '이미 지난 시각입니다'))).toMatchObject({ message: '입력한 내용을 다시 확인해 주세요.', indeterminate: false });
    expect(sendIssueMessage(err(429, 'too-many-requests')).indeterminate).toBe(false);
  });
});
