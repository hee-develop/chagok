import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { HttpError } from '../../../api/request';
import type { PlaceMemory, PlaceMemoryApi } from '../memoryApi';
import { RememberedPlaces } from '../RememberedPlaces';

// 화면 포커스를 테스트가 켜고 끈다(탭을 바꿨다 돌아오는 상황).
const mockFocus = { focused: true, listeners: new Set<(focused: boolean) => void>() };
jest.mock('expo-router', () => {
  const { useEffect, useState } = jest.requireActual('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      const [focused, setFocused] = useState(mockFocus.focused);
      useEffect(() => {
        mockFocus.listeners.add(setFocused);
        return () => { mockFocus.listeners.delete(setFocused); };
      }, []);
      useEffect(() => (focused ? callback() : undefined), [focused, callback]);
    },
  };
});
const setFocus = async (focused: boolean) => {
  mockFocus.focused = focused;
  await act(async () => { mockFocus.listeners.forEach((listener) => listener(focused)); });
};

const memory = (name: string, extra: Partial<PlaceMemory> = {}): PlaceMemory => ({
  name, place: { name: `${name} 본점`, address: '광주 서구 상무로 1', lat: 35.15, lng: 126.85 }, ambiguous: false, updatedAt: '2026-11-15T00:00:00.000Z', ...extra,
});
const STARBUCKS = memory('스타벅스', { ambiguous: true });
const GYM = memory('헬스장/수영장', { place: { name: '상무 헬스', address: null, lat: 35.1, lng: 126.8 } });

const makeApi = (memories: PlaceMemory[] = [STARBUCKS, GYM], overrides: Partial<PlaceMemoryApi> = {}) => ({
  fetchMemories: jest.fn().mockResolvedValue(memories),
  deleteMemory: jest.fn().mockResolvedValue(true),
  ...overrides,
}) satisfies PlaceMemoryApi;

beforeEach(() => { mockFocus.focused = true; });

describe('RememberedPlaces: 정상', () => {
  it('최근에 쓴 순서(서버 순서) 그대로 이름 → 장소를 보이고, 애매한 기억에는 안내를 붙인다', async () => {
    await render(<RememberedPlaces api={makeApi()} />);
    const first = within(await screen.findByTestId('remembered-스타벅스'));
    expect(first.getByText('스타벅스 본점 · 광주 서구 상무로 1')).toBeOnTheScreen();
    expect(first.getByText('이름이 겹쳐서 갈 때마다 한 번 더 물어봐요.')).toBeOnTheScreen();
    const second = within(screen.getByTestId('remembered-헬스장/수영장'));
    expect(second.getByText('상무 헬스')).toBeOnTheScreen();
    expect(second.queryByText(/한 번 더 물어봐요/)).toBeNull();
    expect(screen.getByText('기억한 장소')).toBeOnTheScreen();
  });

  it('지우기를 누르면 확인이 나오고 취소하면 지우지 않는다', async () => {
    const api = makeApi();
    await render(<RememberedPlaces api={api} />);
    await fireEvent.press(await screen.findByRole('button', { name: '스타벅스 기억 지우기' }));
    expect(screen.getByText('‘스타벅스’ 기억을 지울까요?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText('‘스타벅스’ 기억을 지울까요?')).toBeNull();
    expect(api.deleteMemory).not.toHaveBeenCalled();
  });

  it('확인하면 서버에 지우고 그 줄만 목록에서 빠진다(이름에 슬래시가 있어도 그대로 보낸다)', async () => {
    const api = makeApi();
    await render(<RememberedPlaces api={api} />);
    await fireEvent.press(await screen.findByRole('button', { name: '헬스장/수영장 기억 지우기' }));
    await fireEvent.press(screen.getByRole('button', { name: '헬스장/수영장 기억 지우기 확인' }));
    await waitFor(() => expect(api.deleteMemory).toHaveBeenCalledWith('헬스장/수영장', expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryByTestId('remembered-헬스장/수영장')).toBeNull());
    expect(screen.getByTestId('remembered-스타벅스')).toBeOnTheScreen();
  });

  it('이미 없는 기억(서버 404 = false)도 지운 것과 같아 목록에서 뺀다', async () => {
    const api = makeApi([STARBUCKS], { deleteMemory: jest.fn().mockResolvedValue(false) });
    await render(<RememberedPlaces api={api} />);
    await fireEvent.press(await screen.findByRole('button', { name: '스타벅스 기억 지우기' }));
    await fireEvent.press(screen.getByRole('button', { name: '스타벅스 기억 지우기 확인' }));
    expect(await screen.findByText('일정 제목으로 기억한 장소가 생기면 여기에 모여요.')).toBeOnTheScreen();
  });

  it('지우는 동안에는 다른 지우기를 막고 한 번에 하나만 보낸다', async () => {
    let finish: (v: boolean) => void = () => {};
    const api = makeApi(undefined, { deleteMemory: jest.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })) });
    await render(<RememberedPlaces api={api} />);
    await fireEvent.press(await screen.findByRole('button', { name: '스타벅스 기억 지우기' }));
    await fireEvent.press(screen.getByRole('button', { name: '스타벅스 기억 지우기 확인' }));
    expect(await screen.findByText('지우는 중')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '헬스장/수영장 기억 지우기' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: '스타벅스 기억 지우기 확인' }));
    expect(api.deleteMemory).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    await waitFor(() => expect(screen.queryByTestId('remembered-스타벅스')).toBeNull());
  });
});

describe('RememberedPlaces: 상태 5종', () => {
  it('로딩: 기다리는 동안 진행 표시를 보인다', async () => {
    await render(<RememberedPlaces api={makeApi(undefined, { fetchMemories: jest.fn(() => new Promise(() => {})) })} />);
    expect(await screen.findByLabelText('기억한 장소를 불러오는 중')).toBeOnTheScreen();
  });

  it('빈 상태: 기억이 없으면 안내한다', async () => {
    await render(<RememberedPlaces api={makeApi([])} />);
    expect(await screen.findByTestId('remembered-empty')).toHaveTextContent('일정 제목으로 기억한 장소가 생기면 여기에 모여요.');
  });

  it.each([[500], [401]])('오류: 불러오지 못하면(HTTP %i) 다시 시도로 복구한다', async (status) => {
    const fetchMemories = jest.fn().mockRejectedValueOnce(new HttpError(status, 'x')).mockResolvedValueOnce([STARBUCKS]);
    await render(<RememberedPlaces api={makeApi(undefined, { fetchMemories })} />);
    expect(await screen.findByText('기억한 장소를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByTestId('remembered-스타벅스')).toBeOnTheScreen();
  });

  it('오류: 지우지 못하면 그 줄에서 안내하고 줄은 그대로 남아 다시 지울 수 있다', async () => {
    const deleteMemory = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
    await render(<RememberedPlaces api={makeApi([STARBUCKS], { deleteMemory })} />);
    await fireEvent.press(await screen.findByRole('button', { name: '스타벅스 기억 지우기' }));
    await fireEvent.press(screen.getByRole('button', { name: '스타벅스 기억 지우기 확인' }));
    expect(await screen.findByText('‘스타벅스’ 기억을 지우지 못했어요. 잠시 뒤 다시 해 주세요.')).toBeOnTheScreen();
    expect(screen.getByTestId('remembered-스타벅스')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '스타벅스 기억 지우기 확인' }));
    await waitFor(() => expect(screen.queryByTestId('remembered-스타벅스')).toBeNull());
  });
});

describe('RememberedPlaces: 포커스', () => {
  it('탭에 돌아오면 다시 읽고, 다시 읽는 동안 이미 읽은 목록은 그대로 둔다', async () => {
    let resolveSecond: (value: PlaceMemory[]) => void = () => {};
    const fetchMemories = jest.fn()
      .mockResolvedValueOnce([STARBUCKS])
      .mockImplementationOnce(() => new Promise<PlaceMemory[]>((resolve) => { resolveSecond = resolve; }));
    await render(<RememberedPlaces api={makeApi(undefined, { fetchMemories })} />);
    expect(await screen.findByTestId('remembered-스타벅스')).toBeOnTheScreen();
    await setFocus(false);
    await setFocus(true);
    await waitFor(() => expect(fetchMemories).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('remembered-스타벅스')).toBeOnTheScreen();
    expect(screen.queryByLabelText('기억한 장소를 불러오는 중')).toBeNull();
    await act(async () => { resolveSecond([GYM]); });
    expect(await screen.findByTestId('remembered-헬스장/수영장')).toBeOnTheScreen();
    expect(screen.queryByTestId('remembered-스타벅스')).toBeNull();
  });

  it('늦게 온 이전 조회 응답은 버린다', async () => {
    const resolvers: ((value: PlaceMemory[]) => void)[] = [];
    const signals: AbortSignal[] = [];
    const fetchMemories = jest.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<PlaceMemory[]>((resolve) => { resolvers.push(resolve); }); });
    await render(<RememberedPlaces api={makeApi(undefined, { fetchMemories })} />);
    await waitFor(() => expect(fetchMemories).toHaveBeenCalledTimes(1));
    await setFocus(false);
    expect(signals[0]!.aborted).toBe(true);
    await setFocus(true);
    await waitFor(() => expect(fetchMemories).toHaveBeenCalledTimes(2));
    await act(async () => { resolvers[1]!([GYM]); });
    expect(await screen.findByTestId('remembered-헬스장/수영장')).toBeOnTheScreen();
    await act(async () => { resolvers[0]!([STARBUCKS]); });
    expect(screen.queryByTestId('remembered-스타벅스')).toBeNull();
  });

  it('지우는 중에 탭을 바꿔도 지우기 요청은 취소되지 않는다', async () => {
    const signals: AbortSignal[] = [];
    let finish: (v: boolean) => void = () => {};
    const deleteMemory = jest.fn((_name: string, signal: AbortSignal) => { signals.push(signal); return new Promise<boolean>((resolve) => { finish = resolve; }); });
    await render(<RememberedPlaces api={makeApi(undefined, { deleteMemory })} />);
    await fireEvent.press(await screen.findByRole('button', { name: '스타벅스 기억 지우기' }));
    await fireEvent.press(screen.getByRole('button', { name: '스타벅스 기억 지우기 확인' }));
    await waitFor(() => expect(deleteMemory).toHaveBeenCalledTimes(1));
    await setFocus(false);
    expect(signals[0]!.aborted).toBe(false);
    await act(async () => { finish(true); });
    await setFocus(true);
    expect(signals[0]!.aborted).toBe(false);
  });
});
