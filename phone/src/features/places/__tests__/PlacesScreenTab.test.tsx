import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { PlacesScreen } from '../PlacesScreen';
import { APT, EMPTY, FIELD, GYM, TOWER, makeApi } from '../testSupport';

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

beforeEach(() => mockPush.mockReset());

/** 이동 없음 목록(`SkipList`)이 읽는 기억의 가짜(서버에 가지 않는다). */
const skipMemory = (names: string[]) => {
  const items = names.map((name) => ({ name, addedAt: '2026-11-15T00:00:00.000Z' }));
  return { load: async () => undefined, list: () => items, subscribe: () => () => undefined, sync: async () => ({ refreshed: true, pendingFailed: false, full: false }), add: async () => undefined, remove: async () => undefined };
};

describe('PlacesScreen 장소 탭 모드', () => {
  it('첫 설정의 단계 표시와 다음·건너뛰기는 없고 자주 가는 곳은 그대로 보인다', async () => {
    await renderWith(<PlacesScreen mode="tab" skipList={{ memory: skipMemory([]), onChanged: jest.fn() }} api={makeApi({}, { ...EMPTY, home: APT })} memoryApi={{ fetchMemories: jest.fn().mockResolvedValue([]), deleteMemory: jest.fn() }} />);
    expect(await screen.findByText('자주 가는 곳을 알려주세요')).toBeOnTheScreen();
    expect(screen.getByText(`${APT.name} · ${APT.address}`)).toBeOnTheScreen();
    expect(screen.queryByText('2 / 5')).toBeNull();
    expect(screen.queryByTestId('progress-bar-filled')).toBeNull();
    expect(screen.queryByText('다음')).toBeNull();
    expect(screen.queryByText('건너뛰기')).toBeNull();
  });

  it('검색 화면을 단계 표시 없는 출처(from=tab)로 연다', async () => {
    await renderWith(<PlacesScreen mode="tab" skipList={{ memory: skipMemory([]), onChanged: jest.fn() }} api={makeApi()} memoryApi={{ fetchMemories: jest.fn().mockResolvedValue([]), deleteMemory: jest.fn() }} />);
    await fireEvent.press(await screen.findByRole('button', { name: '집, 주소 미설정' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/place-search', params: { target: 'home', from: 'tab' } });
  });

  it('기억한 장소와 이동 없음 목록(SkipList)이 실제 목록으로 보인다', async () => {
    const memoryApi = { fetchMemories: jest.fn().mockResolvedValue([{ name: '스타벅스', place: { name: '스타벅스 상무점', address: null, lat: 1, lng: 2 }, ambiguous: false, updatedAt: '2026-11-15T00:00:00.000Z' }]), deleteMemory: jest.fn() };
    await renderWith(<PlacesScreen mode="tab" api={makeApi()} memoryApi={memoryApi} skipList={{ memory: skipMemory(['KIA 직관']), onChanged: jest.fn() }} />);
    await screen.findByText('기억한 장소');
    expect(await screen.findByTestId('remembered-스타벅스')).toBeOnTheScreen();
    expect(screen.getByText('스타벅스 상무점')).toBeOnTheScreen();
    expect(await screen.findByText('이동 없음으로 기억한 일정')).toBeOnTheScreen();
    expect(screen.getByTestId('places-tab-noTravel')).toBeOnTheScreen();
    expect(await screen.findByTestId('skip-KIA 직관')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'KIA 직관 이동 없음 지우기' })).toBeOnTheScreen();
  });

  it('기억한 장소가 없으면 빈 상태 문구를 보인다', async () => {
    const memoryApi = { fetchMemories: jest.fn().mockResolvedValue([]), deleteMemory: jest.fn() };
    await renderWith(<PlacesScreen mode="tab" skipList={{ memory: skipMemory([]), onChanged: jest.fn() }} api={makeApi()} memoryApi={memoryApi} />);
    expect(await screen.findByText('일정 제목으로 기억한 장소가 생기면 여기에 모여요.')).toBeOnTheScreen();
  });

  it('첫 설정 모드(기본)에는 자리 구역이 없다', async () => {
    await renderWith(<PlacesScreen api={makeApi()} />);
    await screen.findByText('2 / 5');
    expect(screen.queryByText('기억한 장소')).toBeNull();
  });
});

describe('PlacesScreen 장소 탭 · 단골 삭제(정책서 10.8 자주 가는 곳: 추가·삭제)', () => {
  const memoryApi = { fetchMemories: jest.fn().mockResolvedValue([]), deleteMemory: jest.fn() };
  const initial = { ...EMPTY, home: APT, work: TOWER, others: [GYM, FIELD], revision: 3 };
  const setup = async (api = makeApi({}, initial)) => {
    await renderWith(<PlacesScreen mode="tab" skipList={{ memory: skipMemory([]), onChanged: jest.fn() }} api={api} memoryApi={memoryApi} />);
    return api;
  };

  it('단골마다 [삭제]가 있고 집·회사에는 없다', async () => {
    await setup();
    expect(await screen.findByRole('button', { name: `${GYM.name} 삭제` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${FIELD.name} 삭제` })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: `${APT.name} 삭제` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${TOWER.name} 삭제` })).toBeNull();
  });

  it('첫 설정 2단계(기본 모드)에는 [삭제]가 없다', async () => {
    await renderWith(<PlacesScreen api={makeApi({}, initial)} />);
    // 목록이 다 읽힌 뒤(집이 보인 뒤)에도 단골 줄에는 [삭제]가 없다.
    await screen.findByText(`${APT.name} · ${APT.address}`);
    expect(screen.getByText(FIELD.name)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: `${GYM.name} 삭제` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${FIELD.name} 삭제` })).toBeNull();
  });

  it('[삭제]를 누르면 확인을 먼저 보이고, 취소하면 아무것도 지우지 않는다', async () => {
    const api = await setup();
    await fireEvent.press(await screen.findByRole('button', { name: `${GYM.name} 삭제` }));
    expect(screen.getByText(`‘${GYM.name}’ 자주 가는 곳을 지울까요?`)).toBeOnTheScreen();
    expect(screen.getByText('일정이 없을 때 "어디로 갈까요?" 후보에서 빠져요.')).toBeOnTheScreen();
    expect(api.removeOther).not.toHaveBeenCalled();
    await fireEvent.press(within(screen.getByTestId('remove-other-confirm')).getByRole('button', { name: '취소' }));
    expect(screen.queryByTestId('remove-other-confirm')).toBeNull();
    expect(api.removeOther).not.toHaveBeenCalled();
    expect(screen.getByTestId(`favorite-other-${GYM.id}`)).toBeOnTheScreen();
  });

  it('확인하면 그 단골만 지우고 집·회사와 다른 단골은 그대로다', async () => {
    const api = await setup();
    await fireEvent.press(await screen.findByRole('button', { name: `${GYM.name} 삭제` }));
    await fireEvent.press(screen.getByRole('button', { name: `${GYM.name} 삭제 확인` }));
    await waitFor(() => expect(screen.queryByTestId(`favorite-other-${GYM.id}`)).toBeNull());
    expect(api.removeOther).toHaveBeenCalledWith(GYM.id, expect.any(AbortSignal));
    expect(screen.queryByTestId('remove-other-confirm')).toBeNull();
    expect(screen.getByTestId(`favorite-other-${FIELD.id}`)).toBeOnTheScreen();
    expect(screen.getByText(`${APT.name} · ${APT.address}`)).toBeOnTheScreen();
    expect(screen.getByText(`${TOWER.name} · ${TOWER.address}`)).toBeOnTheScreen();
    expect(api.server.get().others.map((p) => p.id)).toEqual([FIELD.id]);
  });

  it('지우는 동안 버튼을 막아 두 번 보내지 않는다', async () => {
    let finish!: (value: typeof initial) => void;
    const api = makeApi({ removeOther: jest.fn(() => new Promise((resolve) => { finish = resolve as typeof finish; })) }, initial);
    await setup(api);
    await fireEvent.press(await screen.findByRole('button', { name: `${GYM.name} 삭제` }));
    await fireEvent.press(screen.getByRole('button', { name: `${GYM.name} 삭제 확인` }));
    expect(await screen.findByText('지우는 중')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${GYM.name} 삭제 확인` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `${FIELD.name} 삭제` })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: `${GYM.name} 삭제 확인` }));
    expect(api.removeOther).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ...initial, others: [FIELD] }));
    await waitFor(() => expect(screen.queryByTestId(`favorite-other-${GYM.id}`)).toBeNull());
  });

  it('실패하면 안내와 [다시 시도]를 보이고 목록은 그대로다. 다시 시도하면 지운다', async () => {
    const api = makeApi({}, initial);
    api.removeOther.mockRejectedValueOnce(new HttpError(500, 'x'));
    await setup(api);
    await fireEvent.press(await screen.findByRole('button', { name: `${GYM.name} 삭제` }));
    await fireEvent.press(screen.getByRole('button', { name: `${GYM.name} 삭제 확인` }));
    expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.getByTestId(`favorite-other-${GYM.id}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(screen.queryByTestId(`favorite-other-${GYM.id}`)).toBeNull());
    expect(api.removeOther).toHaveBeenCalledTimes(2);
  });

  it('이미 없는 단골(404)은 지운 것과 같다: 최신 목록을 받아 보인다', async () => {
    const api = makeApi({}, initial);
    await setup(api);
    await fireEvent.press(await screen.findByRole('button', { name: `${GYM.name} 삭제` }));
    // 다른 폰·차에서 이미 지워졌다.
    api.server.set({ ...initial, others: [FIELD], revision: 4 });
    await fireEvent.press(screen.getByRole('button', { name: `${GYM.name} 삭제 확인` }));
    await waitFor(() => expect(screen.queryByTestId(`favorite-other-${GYM.id}`)).toBeNull());
    expect(screen.queryByTestId('remove-other-confirm')).toBeNull();
    expect(screen.queryByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeNull();
    expect(screen.getByTestId(`favorite-other-${FIELD.id}`)).toBeOnTheScreen();
  });
});
