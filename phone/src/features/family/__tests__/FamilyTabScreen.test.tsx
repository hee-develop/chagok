import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GAME, LUNCH, makePermissions, makeScheduleApi } from '../../../__tests__/support/todaySupport';
import { FAMILY, KID, MOM, NOW, makeFamilyApi, receivedAppointment, receivedCare, sentAppointment, sentCare, sentRide, sentStop, withFamily } from '../../../__tests__/support/familySupport';
import { FamilyHttpError } from '../familyGroupApi';
import { FamilyTabScreen } from '../FamilyTabScreen';
import { memberSession } from '../memberSecret';

const mockNavigate = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string | string[] | undefined> = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ navigate: mockNavigate, push: mockPush }),
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderWith = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);
const setup = (props: Partial<React.ComponentProps<typeof FamilyTabScreen>> = {}) =>
  renderWith(<FamilyTabScreen scheduleApi={makeScheduleApi()} permissionsSource={makePermissions()} familyApi={makeFamilyApi()} now={() => NOW} shareText={jest.fn().mockResolvedValue(undefined)} {...props} />);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const none = () => makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null) });

beforeEach(async () => {
  mockNavigate.mockReset();
  mockPush.mockReset();
  mockParams = {};
  await memberSession.clear('left');
});

describe('가족 탭: 가족이 없을 때(가족 묶기)', () => {
  it('[가족 만들기]와 [초대 코드 넣기]를 보이고 요청·공유는 아직 없다', async () => {
    await setup({ familyApi: none() });
    const group = within(await screen.findByTestId('family-group'));
    expect(group.getByRole('button', { name: '가족 만들기' })).toBeOnTheScreen();
    expect(group.getByRole('button', { name: '초대 코드 넣기' })).toBeOnTheScreen();
    expect(group.getByLabelText('부르는 이름')).toBeOnTheScreen();
    expect(screen.queryByTestId('family-sent-requests')).toBeNull();
    expect(screen.queryByTestId('family-share')).toBeNull();
    expect(screen.queryByText('요청 만들기')).toBeNull();
  });

  it('로딩: 가족을 읽는 동안 진행 표시를 보인다', async () => {
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn(() => new Promise(() => {})) }) });
    expect(await screen.findByLabelText('가족 정보를 불러오는 중')).toBeOnTheScreen();
  });

  it('오류: 불러오지 못하면 [다시 시도]로 복구한다', async () => {
    const fetchFamily = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(FAMILY);
    await setup({ familyApi: makeFamilyApi({ fetchFamily }) });
    const group = within(await screen.findByTestId('family-group'));
    expect(await group.findByText('가족 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(group.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
  });

  it('부르는 이름을 적어 가족을 만들면 가족 화면(구성원·초대 코드)으로 바뀐다', async () => {
    const invite = jest.fn().mockResolvedValue(FAMILY);
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite }) });
    await fireEvent.changeText(await screen.findByLabelText('부르는 이름'), '아빠');
    await press('가족 만들기');
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
    expect(invite).toHaveBeenCalledWith('아빠', expect.anything());
    expect(screen.getByTestId('family-invite-code')).toHaveTextContent('ABCD-EFGH');
    expect(screen.queryByTestId('family-create')).toBeNull();
  });

  it('만들 수 없으면(너무 자주·서버 가득) 이유를 알려 주고 입력은 그대로 둔다', async () => {
    const invite = jest.fn().mockRejectedValue(new FamilyHttpError(429, 'POST /family/invite', { reason: 'rate-limited', retryAfterSeconds: null, message: null }));
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite }) });
    await fireEvent.changeText(await screen.findByLabelText('부르는 이름'), '아빠');
    await press('가족 만들기');
    expect(await screen.findByText('가족을 너무 자주 만들었어요. 잠시 뒤 다시 해 주세요.')).toBeOnTheScreen();
    expect(screen.getByLabelText('부르는 이름').props.value).toBe('아빠');
    expect(screen.getByRole('button', { name: '가족 만들기' })).toBeEnabled();
  });

  it('만드는 중에는 버튼을 막아 요청을 하나만 보낸다', async () => {
    let resolve: (value: typeof FAMILY) => void = () => {};
    const invite = jest.fn(() => new Promise<typeof FAMILY>((r) => { resolve = r; }));
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite }) });
    await press('가족 만들기');
    await press('가족 만들기');
    expect(invite).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('가족을 만드는 중')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '가족 만들기' })).toBeDisabled();
    await act(async () => resolve(FAMILY));
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
  });

  it('초대 코드로 참여한다: 코드가 비면 요청하지 않고, 넣으면 이름과 함께 보낸다', async () => {
    const join = jest.fn().mockResolvedValue(FAMILY);
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), join }) });
    await press('초대 코드 넣기');
    await press('참여하기');
    expect(await screen.findByText('초대 코드를 넣어 주세요.')).toBeOnTheScreen();
    expect(join).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('부르는 이름'), '엄마');
    await fireEvent.changeText(screen.getByLabelText('초대 코드'), 'abcd-efgh');
    await press('참여하기');
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
    expect(join).toHaveBeenCalledWith('abcd-efgh', '엄마', expect.anything());
  });

  it.each([
    ['invalid', 404, undefined, '없거나 만료된 초대 코드예요. 새 코드를 받아 다시 해 주세요.'],
    ['family-full', 409, undefined, '가족 인원이 가득 찼어요.'],
    ['locked', 429, 42, '초대 코드를 너무 많이 틀렸어요. 42초 뒤에 다시 해 주세요.'],
  ] as const)('참여 실패 %s는 이유를 알려 준다', async (reason, status, retryAfterSeconds, message) => {
    const join = jest.fn().mockRejectedValue(new FamilyHttpError(status, 'POST /family/join', { reason, retryAfterSeconds: retryAfterSeconds ?? null, message: null }));
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), join }) });
    await press('초대 코드 넣기');
    await fireEvent.changeText(screen.getByLabelText('초대 코드'), 'ZZZZ-ZZZZ');
    await press('참여하기');
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByTestId('family-join')).toBeOnTheScreen();
  });

  it('이미 가족인 폰이 참여하려 하면(409 already-in-family) 안내하고 가족을 다시 읽는다', async () => {
    const fetchFamily = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(FAMILY);
    const join = jest.fn().mockRejectedValue(new FamilyHttpError(409, 'POST /family/join', { reason: 'already-in-family', retryAfterSeconds: null, message: null }));
    await setup({ familyApi: makeFamilyApi({ fetchFamily, join }) });
    await press('초대 코드 넣기');
    await fireEvent.changeText(screen.getByLabelText('초대 코드'), 'ZZZZ-ZZZZ');
    await press('참여하기');
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
    expect(fetchFamily).toHaveBeenCalledTimes(2);
  });

  it("비밀값이 지워지면(서버가 모르는 구성원) '가족에서 나왔어요' 상태로 돌아간다", async () => {
    await memberSession.set('s'.repeat(64));
    await setup();
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
    await act(async () => { await memberSession.clear('gone'); });
    expect(await screen.findByTestId('family-left-notice')).toHaveTextContent('가족에서 나왔어요. 새로 만들거나 초대 코드로 다시 들어올 수 있어요.');
    expect(screen.queryByTestId('family-members')).toBeNull();
    expect(screen.getByRole('button', { name: '가족 만들기' })).toBeOnTheScreen();
  });

  it('일정으로 보내기 입구와 일정으로 보낸 것은 가족이 없어도 그대로 있다', async () => {
    await setup({ familyApi: none() });
    expect(await screen.findByText('일정 고르러 가기')).toBeOnTheScreen();
    expect(await screen.findByText('엄마에게 전달됨')).toBeOnTheScreen();
  });
});

describe('가족 탭: 가족이 있을 때', () => {
  it('구성원 목록(나·부르는 이름·차 연결 여부)과 요청 보내기 입구를 보인다', async () => {
    await setup();
    const members = within(await screen.findByTestId('family-members'));
    expect(members.getByLabelText('아빠 (나), 차 연결 안 됨')).toBeOnTheScreen();
    expect(members.getByLabelText('엄마, 차 연결됨')).toBeOnTheScreen();
    expect(members.getByLabelText('지우, 차 연결 안 됨')).toBeOnTheScreen();
    expect(members.getByText('3명 / 최대 6명')).toBeOnTheScreen();
    await press('요청 만들기');
    expect(mockPush).toHaveBeenCalledWith('/setup/family-request');
  });

  it('초대 코드와 남은 시간을 보이고 공유 시트로 보낸다', async () => {
    const shareText = jest.fn().mockResolvedValue(undefined);
    await setup({ shareText });
    const invite = within(await screen.findByTestId('family-invite'));
    expect(invite.getByTestId('family-invite-code')).toHaveTextContent('ABCD-EFGH');
    expect(invite.getByTestId('family-invite-remaining')).toHaveTextContent('23시간 30분 남았어요');
    await fireEvent.press(invite.getByRole('button', { name: '공유하기' }));
    expect(shareText).toHaveBeenCalledWith(expect.stringContaining('ABCD-EFGH'));
    // 안내는 고정된 '24시간'이 아니라 서버가 준 만료 시각 기준 남은 시간이다.
    expect(shareText).toHaveBeenCalledWith(expect.stringContaining('23시간 30분 남았어요'));
    expect(shareText.mock.calls[0]![0]).not.toContain('24시간');
  });

  it('초대 코드가 없거나 만료됐으면 [초대 코드 만들기]를 보이고, 만들면 새 코드가 보인다', async () => {
    const invite = jest.fn().mockResolvedValue(withFamily({ invite: { code: 'WXYZ-2345', expiresAt: '2026-11-07T00:00:00.000Z' } }));
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ invite: null })), invite }) });
    const card = within(await screen.findByTestId('family-invite'));
    await fireEvent.press(card.getByRole('button', { name: '초대 코드 만들기' }));
    expect(await screen.findByText('WXYZ-2345')).toBeOnTheScreen();
    expect(invite).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it('만료된 코드는 만료됐다고 알리고 새 코드를 권한다', async () => {
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ invite: { code: 'OLDD-CODE', expiresAt: '2026-11-05T00:00:00.000Z' } })) }) });
    const card = within(await screen.findByTestId('family-invite'));
    expect(card.getByText('코드가 만료됐어요. 새 코드를 만들어 주세요.')).toBeOnTheScreen();
    expect(card.queryByTestId('family-invite-code')).toBeNull();
  });

  it('인원이 가득 차면 새 코드 만들기를 막고 안내한다', async () => {
    const members = Array.from({ length: 6 }, (_, i) => (i === 0 ? FAMILY.members[0]! : { ...MOM, memberId: `m${i}`, name: `가족${i}` }));
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ members })) }) });
    const card = within(await screen.findByTestId('family-invite'));
    expect(card.getByText('가족 인원이 가득 차서 더 초대할 수 없어요.')).toBeOnTheScreen();
    expect(card.getByRole('button', { name: '새 코드로 바꾸기' })).toBeDisabled();
  });

  it('내 이름을 바꾸면 서버가 정한 최종 이름을 다시 읽어 보인다', async () => {
    const renamed = withFamily({ me: { memberId: 'me1', name: '아빠 2' }, members: [{ ...FAMILY.members[0]!, name: '아빠 2' }, MOM, KID] });
    const rename = jest.fn().mockResolvedValue(undefined);
    const fetchFamily = jest.fn().mockResolvedValueOnce(FAMILY).mockResolvedValue(renamed);
    await setup({ familyApi: makeFamilyApi({ fetchFamily, rename }) });
    const card = within(await screen.findByTestId('family-rename'));
    expect(card.getByRole('button', { name: '이름 바꾸기' })).toBeDisabled();
    await fireEvent.changeText(card.getByLabelText('내 부르는 이름'), '아빠 2');
    await fireEvent.press(card.getByRole('button', { name: '이름 바꾸기' }));
    expect(rename).toHaveBeenCalledWith('아빠 2', expect.anything());
    expect(await screen.findByLabelText('아빠 2 (나), 차 연결 안 됨')).toBeOnTheScreen();
  });

  it('이름을 비우면 요청하지 않고 안내한다', async () => {
    const rename = jest.fn();
    await setup({ familyApi: makeFamilyApi({ rename }) });
    const card = within(await screen.findByTestId('family-rename'));
    await fireEvent.changeText(card.getByLabelText('내 부르는 이름'), '  ');
    await fireEvent.press(card.getByRole('button', { name: '이름 바꾸기' }));
    expect(card.getByText('이름을 한 글자 이상 적어 주세요.')).toBeOnTheScreen();
    expect(rename).not.toHaveBeenCalled();
  });

  it('가족에서 나가기: 보낸·받은 요청과 공유 설정이 지워진다는 확인을 거친 뒤에만 나간다', async () => {
    const leave = jest.fn().mockResolvedValue(undefined);
    await setup({ familyApi: makeFamilyApi({ leave }) });
    const card = within(await screen.findByTestId('family-leave'));
    await fireEvent.press(card.getByRole('button', { name: '가족에서 나가기' }));
    expect(card.getByText('가족에서 나갈까요?')).toBeOnTheScreen();
    expect(card.getByText('내가 보낸 요청과 받은 요청, 도착 예정 공유 설정이 지워져요. 다시 들어오려면 초대 코드가 필요해요.')).toBeOnTheScreen();
    expect(leave).not.toHaveBeenCalled();
    await fireEvent.press(card.getByRole('button', { name: '취소' }));
    expect(card.queryByText('가족에서 나갈까요?')).toBeNull();
    await fireEvent.press(card.getByRole('button', { name: '가족에서 나가기' }));
    await fireEvent.press(card.getByRole('button', { name: '나가기' }));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('family-left-notice')).toHaveTextContent('가족에서 나갔어요. 새로 만들거나 초대 코드로 다시 들어올 수 있어요.');
    expect(screen.queryByTestId('family-members')).toBeNull();
  });

  it('나가기에 실패하면 가족 화면에 남아 안내한다', async () => {
    await setup({ familyApi: makeFamilyApi({ leave: jest.fn().mockRejectedValue(new Error('offline')) }) });
    const card = within(await screen.findByTestId('family-leave'));
    await fireEvent.press(card.getByRole('button', { name: '가족에서 나가기' }));
    await fireEvent.press(card.getByRole('button', { name: '나가기' }));
    expect(await card.findByText('나가지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByTestId('family-members')).toBeOnTheScreen();
  });
});

describe('가족 탭: 만들기가 느릴 때(확인 중)', () => {
  it('시간 제한이 지나도 끊지 않고 확인 중을 알리며 버튼을 막고, 늦은 응답으로 가족 화면이 된다', async () => {
    let resolve: (value: typeof FAMILY) => void = () => {};
    const invite = jest.fn(() => new Promise<typeof FAMILY>((r) => { resolve = r; }));
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite }), timeoutMs: 20 });
    await fireEvent.changeText(await screen.findByLabelText('부르는 이름'), '아빠');
    await press('가족 만들기');
    expect(await screen.findByTestId('family-slow')).toHaveTextContent('서버 응답을 확인하는 중이에요. 끝날 때까지 같은 버튼을 다시 누르지 않아도 돼요.');
    expect(screen.getByRole('button', { name: '가족 만들기' })).toBeDisabled();
    await press('가족 만들기');
    expect(invite).toHaveBeenCalledTimes(1);
    await act(async () => resolve(FAMILY));
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
    expect(screen.queryByTestId('family-slow')).toBeNull();
  });
});

describe('가족 탭: request 파라미터와 저장 실패 안내', () => {
  const tree = (api: ReturnType<typeof makeFamilyApi>) => (
    <SafeAreaProvider initialMetrics={insets}>
      <FamilyTabScreen scheduleApi={makeScheduleApi()} permissionsSource={makePermissions()} familyApi={api} now={() => NOW} shareText={jest.fn()} />
    </SafeAreaProvider>
  );

  it('탭이 열린 채 request 파라미터만 바뀌면 바로 다시 읽고, 새로 읽은 목록에 그 요청이 있으면 맨 위에 표시한다', async () => {
    const fetchRequests = jest.fn().mockResolvedValueOnce({ sent: [sentCare()], received: [] }).mockResolvedValue({ sent: [sentCare(), sentStop()], received: [] });
    const api = makeFamilyApi({ fetchRequests });
    const view = await render(tree(api));
    await screen.findByText('엄마에게 · 채비');
    const reads = fetchRequests.mock.calls.length;
    mockParams = { request: 'r-stop' };
    await view.rerender(tree(api));
    await waitFor(() => expect(fetchRequests.mock.calls.length).toBeGreaterThan(reads));
    const sent = within(screen.getByTestId('family-sent-requests'));
    expect(await sent.findByText('선택한 요청')).toBeOnTheScreen();
    expect((await sent.findAllByTestId(/^family-request-r-/))[0]).toBe(sent.getByTestId('family-request-r-stop'));
    expect(screen.queryByTestId('family-request-missing')).toBeNull();
  });

  it("새로 읽은 목록에도 가리킨 요청이 없으면 '요청을 찾을 수 없어요' 한 줄을 보인다(읽기 전에는 보이지 않는다)", async () => {
    mockParams = { request: 'gone-1' };
    let resolve: (value: { sent: never[]; received: never[] }) => void = () => {};
    const fetchRequests = jest.fn(() => new Promise<{ sent: never[]; received: never[] }>((r) => { resolve = r; }));
    await setup({ familyApi: makeFamilyApi({ fetchRequests }) });
    await screen.findByTestId('family-members');
    expect(screen.queryByTestId('family-request-missing')).toBeNull();
    await act(async () => resolve({ sent: [], received: [] }));
    expect(await screen.findByTestId('family-request-missing')).toHaveTextContent('요청을 찾을 수 없어요. 이미 지워졌거나 날짜가 지났을 수 있어요.');
  });

  it('request 파라미터가 없으면 안내도 없다', async () => {
    await setup();
    await screen.findByText('아직 보낸 요청이 없어요.');
    expect(screen.queryByTestId('family-request-missing')).toBeNull();
  });

  it('구성원 비밀값을 폰 저장소에 쓰지 못하면 한 줄로 안내한다', async () => {
    const SecureStore = jest.requireActual('expo-secure-store') as { setItemAsync: (...a: unknown[]) => Promise<void> };
    const spy = jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValue(new Error('keystore'));
    const invite = jest.fn(async () => { await memberSession.set('s'.repeat(64)); return FAMILY; });
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(null), invite }) });
    await press('가족 만들기');
    expect(await screen.findByTestId('family-storage-notice')).toHaveTextContent('이 폰에 가족 정보를 저장하지 못했어요. 앱을 닫으면 가족에서 나온 것처럼 보일 수 있어요.');
    spy.mockRestore();
  });
});

describe('가족 탭: 구역 순서', () => {
  /** 화면 트리에 나타나는 testID를 위에서 아래 순서로. */
  const order = () => {
    const ids: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return;
      const n = node as { props?: { testID?: string }; children?: unknown[] | null };
      if (n.props?.testID) ids.push(n.props.testID);
      n.children?.forEach(walk);
    };
    walk(screen.toJSON());
    return ids;
  };

  it('가족이 여럿이면 요청이 위, 구성원·초대 코드가 아래에 있다', async () => {
    await setup();
    await screen.findByTestId('family-members');
    const ids = order();
    expect(ids.indexOf('family-send')).toBeLessThan(ids.indexOf('family-members'));
    expect(ids.indexOf('family-sent-requests')).toBeLessThan(ids.indexOf('family-share'));
    expect(ids.indexOf('family-share')).toBeLessThan(ids.indexOf('family-members'));
    expect(ids.indexOf('family-members')).toBeLessThan(ids.indexOf('family-legacy-send'));
  });

  it('나 혼자뿐이면 보낼 사람이 없으므로 초대 코드가 먼저 보인다', async () => {
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ members: [FAMILY.members[0]!], cars: [] })) }) });
    await screen.findByTestId('family-members');
    const ids = order();
    expect(ids.indexOf('family-members')).toBeLessThan(ids.indexOf('family-send'));
    expect(ids.indexOf('family-invite')).toBeLessThan(ids.indexOf('family-sent-requests'));
  });
});

describe('가족 탭: 도착 예정 공유', () => {
  it('가족 한 사람마다 스위치를 보이고(나는 없음) 안내 문구가 위치·경로는 보내지 않는다고 말한다', async () => {
    await setup();
    const share = within(await screen.findByTestId('family-share'));
    expect(share.getByText('켜면 그 사람이 보낸 약속·픽업 요청의 도착 예정 시각과 운전 중인지를 보여 줘요. 위치와 경로는 보내지 않아요.')).toBeOnTheScreen();
    expect(share.getByLabelText('엄마에게 도착 예정 보여 주기')).toBeOnTheScreen();
    expect(share.getByLabelText('지우에게 도착 예정 보여 주기')).toBeOnTheScreen();
    expect(share.queryByLabelText('아빠에게 도착 예정 보여 주기')).toBeNull();
    // 기본은 꺼짐(엄마), 이미 켜 둔 사람은 켜짐(지우). 색만이 아니라 글자로도 알린다.
    expect(within(share.getByTestId('family-share-mom1')).getByText('꺼짐')).toBeOnTheScreen();
    expect(within(share.getByTestId('family-share-kid1')).getByText('켜짐')).toBeOnTheScreen();
    expect(share.getByText('엄마도 나에게 도착 예정을 보여 줘요')).toBeOnTheScreen();
  });

  it('스위치를 켜고 끄면 서버에 보내고 화면이 바뀐다', async () => {
    const setShare = jest.fn().mockResolvedValue(undefined);
    await setup({ familyApi: makeFamilyApi({ setShare }) });
    const switchOf = async (label: string) => (await screen.findByLabelText(label));
    await fireEvent(await switchOf('엄마에게 도착 예정 보여 주기'), 'valueChange', true);
    expect(setShare).toHaveBeenCalledWith('mom1', true, expect.anything());
    await waitFor(() => expect(within(screen.getByTestId('family-share-mom1')).getByText('켜짐')).toBeOnTheScreen());
    await fireEvent(await switchOf('지우에게 도착 예정 보여 주기'), 'valueChange', false);
    expect(setShare).toHaveBeenLastCalledWith('kid1', false, expect.anything());
    await waitFor(() => expect(within(screen.getByTestId('family-share-kid1')).getByText('꺼짐')).toBeOnTheScreen());
  });

  it('저장에 실패하면 이전 값 그대로 두고 안내한다', async () => {
    await setup({ familyApi: makeFamilyApi({ setShare: jest.fn().mockRejectedValue(new Error('offline')) }) });
    await fireEvent(await screen.findByLabelText('엄마에게 도착 예정 보여 주기'), 'valueChange', true);
    expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(within(screen.getByTestId('family-share-mom1')).getByText('꺼짐')).toBeOnTheScreen();
  });

  it('가족이 나 혼자면 공유할 사람이 없다고 안내한다', async () => {
    await setup({ familyApi: makeFamilyApi({ fetchFamily: jest.fn().mockResolvedValue(withFamily({ members: [FAMILY.members[0]!], cars: [] })) }) });
    expect(await screen.findByText('가족이 더 들어오면 여기에서 사람마다 켜고 끌 수 있어요.')).toBeOnTheScreen();
  });
});

describe('가족 탭: 보낸·받은 요청 상태', () => {
  const lists = {
    sent: [sentStop({ status: 'accepted' }), sentCare({ memo: '현관 앞에 두기' }), sentAppointment({ drivingNow: true, status: 'sent' }), sentRide({ status: 'accepted', etaStage: 'soon' })],
    received: [receivedAppointment(), receivedCare({ status: 'completed' })],
  };

  it('보낸 요청은 받는 사람·카테고리·요약·상태 문구, 받은 요청은 보낸 사람과 상태를 보인다', async () => {
    await setup({ familyApi: makeFamilyApi({ fetchRequests: jest.fn().mockResolvedValue(lists) }) });
    const sent = within(await screen.findByTestId('family-sent-requests'));
    expect(await sent.findByText('엄마에게 · 들르기')).toBeOnTheScreen();
    expect(sent.getByText('다이소 상무점 · 건전지 · 오늘 중')).toBeOnTheScreen();
    expect(within(sent.getByTestId('family-request-r-stop')).getByText('수락했어요')).toBeOnTheScreen();
    expect(within(sent.getByTestId('family-request-r-care')).getByText('차에 타면 전해요')).toBeOnTheScreen();
    expect(sent.getByText('메모: 현관 앞에 두기')).toBeOnTheScreen();
    expect(within(sent.getByTestId('family-request-r-appt')).getByText('운전 중이라 다음 정차 때 전해요')).toBeOnTheScreen();
    expect(within(sent.getByTestId('family-request-r-ride')).getByText('곧 도착해요')).toBeOnTheScreen();
    const received = within(screen.getByTestId('family-received-requests'));
    expect(received.getByText('보낸 사람 엄마 · 약속 가기')).toBeOnTheScreen();
    expect(within(received.getByTestId('family-request-in-appt')).getByText('차에 연결하면 전해 드려요')).toBeOnTheScreen();
    expect(within(received.getByTestId('family-request-in-care')).getByText('끝났어요')).toBeOnTheScreen();
  });

  it('줄은 스크린리더에 제목·요약·상태를 한 번에 읽어 준다', async () => {
    await setup({ familyApi: makeFamilyApi({ fetchRequests: jest.fn().mockResolvedValue(lists) }) });
    expect(await screen.findByLabelText('엄마에게 · 들르기, 다이소 상무점 · 건전지 · 오늘 중, 수락했어요')).toBeOnTheScreen();
  });

  it("받는 사람 폰이 차에 연결되지 않았으면 '폰 앱에서만 볼 수 있어요'", async () => {
    await setup({ familyApi: makeFamilyApi({ fetchRequests: jest.fn().mockResolvedValue({ sent: [sentCare({ reachable: false })], received: [] }) }) });
    expect(await screen.findByText('폰 앱에서만 볼 수 있어요')).toBeOnTheScreen();
  });

  it("'우리 차'로 보낸 요청은 '우리 차에'로 보인다", async () => {
    await setup({ familyApi: makeFamilyApi({ fetchRequests: jest.fn().mockResolvedValue({ sent: [sentCare({ to: { kind: 'car', carRef: 'car-1' } })], received: [] }) }) });
    expect(await screen.findByText('우리 차에 · 채비')).toBeOnTheScreen();
  });

  it('빈 상태: 보낸·받은 요청이 없으면 각각 안내한다', async () => {
    await setup();
    expect(await screen.findByText('아직 보낸 요청이 없어요.')).toBeOnTheScreen();
    expect(screen.getByText('아직 받은 요청이 없어요.')).toBeOnTheScreen();
  });

  it('로딩: 요청을 읽는 동안 진행 표시를 보인다', async () => {
    await setup({ familyApi: makeFamilyApi({ fetchRequests: jest.fn(() => new Promise(() => {})) }) });
    await screen.findByTestId('family-members');
    expect(within(screen.getByTestId('family-sent-requests')).getByLabelText('요청을 불러오는 중')).toBeOnTheScreen();
  });

  it('오류: 요청을 읽지 못하면 [다시 시도]로 복구한다', async () => {
    const fetchRequests = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(lists);
    await setup({ familyApi: makeFamilyApi({ fetchRequests }) });
    const sent = within(await screen.findByTestId('family-sent-requests'));
    expect(await sent.findByText('요청을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(sent.getByRole('button', { name: '다시 시도' }));
    expect(await sent.findByText('엄마에게 · 들르기')).toBeOnTheScreen();
  });

  it('request 파라미터(알림 누름·오늘 탭)의 요청을 목록 맨 위에 표시한다', async () => {
    mockParams = { request: 'r-ride' };
    await setup({ familyApi: makeFamilyApi({ fetchRequests: jest.fn().mockResolvedValue(lists) }) });
    const sent = within(await screen.findByTestId('family-sent-requests'));
    const rows = await sent.findAllByTestId(/^family-request-r-/);
    expect(rows[0]).toBe(sent.getByTestId('family-request-r-ride'));
    expect(within(sent.getByTestId('family-request-r-ride')).getByText('선택한 요청')).toBeOnTheScreen();
    expect(sent.getAllByText('선택한 요청')).toHaveLength(1);
  });

  it('앱이 앞에 있는 동안 주기적으로 다시 읽는다', async () => {
    // jest 환경의 AppState.currentState는 비어 있어(undefined) 앞(active)에 있다고 정한다.
    (AppState as unknown as { currentState: string }).currentState = 'active';
    const fetchRequests = jest.fn().mockResolvedValueOnce({ sent: [sentCare()], received: [] }).mockResolvedValue({ sent: [sentCare({ status: 'delivered' })], received: [] });
    await setup({ familyApi: makeFamilyApi({ fetchRequests }), pollMs: 30 });
    expect(await screen.findByText('차에 타면 전해요')).toBeOnTheScreen();
    expect(await screen.findByText('전달했어요')).toBeOnTheScreen();
    expect(fetchRequests.mock.calls.length).toBeGreaterThanOrEqual(2);
    (AppState as unknown as { currentState: string | undefined }).currentState = undefined;
  });
});

describe('가족 탭: 일정으로 보내기(기존 입구)', () => {
  it('보내기 입구는 오늘 탭의 일정으로 보낸다', async () => {
    await setup();
    await fireEvent.press(await screen.findByRole('button', { name: '일정 고르러 가기' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
    expect(screen.getByText('일정의 주소·채비를 그대로 보내려면 오늘 탭의 일정에서 골라요. 이 입구는 미리 묶어 둔 가족에게만 보낼 수 있어요.')).toBeOnTheScreen();
  });

  it('정상: 일정으로 보낸 요청을 일정 제목과 함께 전달됨으로 보인다', async () => {
    await setup();
    const row = within(await screen.findByTestId('family-sent-game:mom'));
    expect(row.getByText('엄마에게 전달됨')).toBeOnTheScreen();
    expect(row.getByText('KIA 직관')).toBeOnTheScreen();
  });

  it('빈 상태·로딩·오류', async () => {
    await setup({ scheduleApi: makeScheduleApi([LUNCH]) });
    expect(await screen.findByText('일정으로 보낸 요청이 아직 없어요.')).toBeOnTheScreen();
  });

  it('로딩: 기다리는 동안 진행 표시를 보인다', async () => {
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules: jest.fn(() => new Promise(() => {})) }) });
    expect(await screen.findByLabelText('일정으로 보낸 요청을 불러오는 중')).toBeOnTheScreen();
  });

  it('오류: 다시 시도로 복구한다', async () => {
    const fetchSchedules = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ anchor: '2026-11-06T00:30:00Z', schedules: [GAME] });
    await setup({ scheduleApi: makeScheduleApi(undefined, { fetchSchedules }) });
    const section = within(await screen.findByTestId('family-sent'));
    expect(await section.findByText('일정으로 보낸 요청을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(section.getByText('다시 시도'));
    expect(await screen.findByText('엄마에게 전달됨')).toBeOnTheScreen();
  });

  it('권한 없음: 캘린더가 꺼져 있으면 이 구역만 켜기를 안내하고 가족 묶기는 막지 않는다', async () => {
    const api = makeScheduleApi();
    await setup({ scheduleApi: api, permissionsSource: makePermissions({ calendar: 'ask', camera: 'granted' }) });
    expect(await screen.findByText('캘린더를 켜면 일정으로 보낸 요청을 볼 수 있어요.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '캘린더 켜기' })).toBeOnTheScreen();
    expect(api.fetchSchedules).not.toHaveBeenCalled();
    expect(await screen.findByTestId('family-members')).toBeOnTheScreen();
  });
});
