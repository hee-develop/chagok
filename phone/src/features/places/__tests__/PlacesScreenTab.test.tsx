import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlacesScreen } from '../PlacesScreen';
import { APT, EMPTY, makeApi } from '../testSupport';

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
    expect(screen.queryByText('2 / 4')).toBeNull();
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
    await screen.findByText('2 / 4');
    expect(screen.queryByText('기억한 장소')).toBeNull();
  });
});
