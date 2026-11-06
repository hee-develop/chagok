import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { FontsLoadedContext } from '../../../ui/theme';
import { PlacesScreen } from '../PlacesScreen';
import { APT, EMPTY, FIELD, GYM, makeApi, SUGGESTIONS, TOWER } from '../testSupport';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderScreen = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);

const LOAD_FAILED = '장소를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
const SAVE_FAILED = '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
const homeLine = `${APT.name} · ${APT.address}`;
const addButton = (name: string) => screen.getByRole('button', { name: `${name} 추가` });
const noAddButton = (name: string) => screen.queryByRole('button', { name: `${name} 추가` });

beforeEach(() => {
  mockPush.mockReset();
});

describe('PlacesScreen 렌더', () => {
  it('시안의 문구와 구성을 보여 준다', async () => {
    await renderScreen(<PlacesScreen api={makeApi()} />);

    expect(await screen.findByText('자주 가는 곳을 알려주세요')).toBeOnTheScreen();
    expect(screen.getByText('일정이 없는 날 "어디로 갈까요?"라고 물을 때 바로 후보로 보여드려요.')).toBeOnTheScreen();
    expect(screen.getByText('2 / 4')).toBeOnTheScreen();
    expect(screen.getAllByTestId('progress-bar-filled')).toHaveLength(2);
    expect(screen.getAllByTestId('progress-bar-empty')).toHaveLength(2);

    expect(screen.getByText('집')).toBeOnTheScreen();
    expect(screen.getByText('[집 주소]')).toBeOnTheScreen();
    expect(screen.getByText('회사')).toBeOnTheScreen();
    expect(screen.getByText('[회사 주소]')).toBeOnTheScreen();

    expect(screen.getByText('캘린더에서 자주 나온 곳')).toBeOnTheScreen();
    expect(screen.getByText('체육관')).toBeOnTheScreen();
    expect(screen.getByText('화요일 저녁마다')).toBeOnTheScreen();
    expect(screen.getByText('광주-기아 챔피언스필드')).toBeOnTheScreen();
    expect(screen.getByText('직관 일정에 자주 나와요')).toBeOnTheScreen();
    expect(screen.getAllByText('추가')).toHaveLength(2);

    expect(screen.getByText('+ 장소 직접 추가')).toBeOnTheScreen();
    expect(screen.getByText('다음')).toBeOnTheScreen();
    expect(screen.getByText('건너뛰기')).toBeOnTheScreen();
  });

  it('줄은 button 역할과 라벨(빈 줄은 대괄호 없이 "주소 미설정")·이동 hint를 가지고, 추천 추가는 "{장소} 추가" 라벨이다', async () => {
    await renderScreen(<PlacesScreen api={makeApi()} />);
    await screen.findByText('자주 가는 곳을 알려주세요');

    const home = screen.getByRole('button', { name: '집, 주소 미설정' });
    expect(home.props.accessibilityHint).toBe('장소 검색 화면으로 이동');
    expect(screen.getByRole('button', { name: '회사, 주소 미설정' }).props.accessibilityHint).toBe('장소 검색 화면으로 이동');
    expect(addButton('체육관')).toBeOnTheScreen();
    expect(addButton('광주-기아 챔피언스필드')).toBeOnTheScreen();
    const manual = screen.getByRole('button', { name: '장소 직접 추가' });
    expect(manual.props.accessibilityHint).toBe('장소 검색 화면으로 이동');
  });

  it('로딩 중에는 접근 가능한 로딩 표시를 보여 주고 다음은 비활성이며 건너뛰기는 누를 수 있다', async () => {
    const api = makeApi({ fetchFavorites: jest.fn().mockReturnValue(new Promise(() => {})) });
    await renderScreen(<PlacesScreen api={api} />);

    expect(screen.getByRole('progressbar', { name: '장소를 불러오는 중' })).toBeOnTheScreen();
    expect(screen.queryByText('집')).toBeNull();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();

    await fireEvent.press(screen.getByText('건너뛰기'));
    expect(mockPush).toHaveBeenCalledWith('/setup/fill-places');
  });

  it('저장된 장소가 없고 추천도 없으면 추천 영역 없이 빈 집·회사 줄만 보인다', async () => {
    await renderScreen(<PlacesScreen api={makeApi({ fetchSuggestions: jest.fn().mockResolvedValue([]) })} />);

    expect(await screen.findByText('[집 주소]')).toBeOnTheScreen();
    expect(screen.queryByText('캘린더에서 자주 나온 곳')).toBeNull();
    expect(screen.getByText('+ 장소 직접 추가')).toBeOnTheScreen();
  });
});

describe('복원', () => {
  it('서버에 저장된 집·회사·추가 장소를 같은 줄 모양으로 보여 주고 추천에서는 뺀다', async () => {
    const api = makeApi({}, { home: APT, work: TOWER, others: [GYM], revision: 7 });
    await renderScreen(<PlacesScreen api={api} />);

    expect(await screen.findByText(homeLine)).toBeOnTheScreen();
    expect(screen.getByText(`${TOWER.name} · ${TOWER.address}`)).toBeOnTheScreen();
    expect(screen.queryByText('[집 주소]')).toBeNull();
    expect(screen.queryByText('[회사 주소]')).toBeNull();

    expect(screen.getByText(GYM.address)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `집, ${homeLine}` })).toBeOnTheScreen();
    expect(noAddButton('체육관')).toBeNull();
    expect(addButton('광주-기아 챔피언스필드')).toBeOnTheScreen();
    expect(screen.queryByText('화요일 저녁마다')).toBeNull();
  });

  it('추천이 모두 추가돼 있으면 추천 제목도 사라진다', async () => {
    await renderScreen(<PlacesScreen api={makeApi({}, { ...EMPTY, others: [GYM, FIELD] })} />);

    expect(await screen.findByText(GYM.address)).toBeOnTheScreen();
    expect(screen.queryByText('캘린더에서 자주 나온 곳')).toBeNull();
  });

  it('조회에 실패하면 오류 안내를 알리고 다시 시도로 복구한다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const fetchFavorites = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...EMPTY, home: APT });
    await renderScreen(<PlacesScreen api={makeApi({ fetchFavorites })} />);

    expect(await screen.findByText(LOAD_FAILED)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(LOAD_FAILED);
    expect(screen.queryByText('[집 주소]')).toBeNull();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();

    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText(homeLine)).toBeOnTheScreen();
    announce.mockRestore();
  });

  it('추천 조회가 실패해도 오류 상태가 된다', async () => {
    const api = makeApi({ fetchSuggestions: jest.fn().mockRejectedValue(new Error('500')) });
    await renderScreen(<PlacesScreen api={api} />);
    expect(await screen.findByText(LOAD_FAILED)).toBeOnTheScreen();
  });

  it('조회가 시간 제한을 넘기면 요청을 취소하고 오류 상태가 된다', async () => {
    let signal: AbortSignal | undefined;
    const fetchFavorites = jest.fn().mockImplementation((s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    await renderScreen(<PlacesScreen api={makeApi({ fetchFavorites })} timeoutMs={80} />);

    expect(await screen.findByText(LOAD_FAILED)).toBeOnTheScreen();
    expect(signal?.aborted).toBe(true);
  });
});

describe('이동', () => {
  it('집 줄을 누르면 집 대상으로 검색 화면에 간다', async () => {
    await renderScreen(<PlacesScreen api={makeApi()} />);
    await fireEvent.press(await screen.findByRole('button', { name: '집, 주소 미설정' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/place-search', params: { target: 'home' } });
  });

  it('회사 줄을 누르면 회사 대상으로 검색 화면에 간다', async () => {
    await renderScreen(<PlacesScreen api={makeApi()} />);
    await fireEvent.press(await screen.findByRole('button', { name: '회사, 주소 미설정' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/place-search', params: { target: 'work' } });
  });

  it('장소 직접 추가를 누르면 other 대상으로 검색 화면에 간다', async () => {
    await renderScreen(<PlacesScreen api={makeApi()} />);
    await fireEvent.press(await screen.findByRole('button', { name: '장소 직접 추가' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/setup/place-search', params: { target: 'other' } });
  });

  it('다음과 건너뛰기는 3단계로 간다', async () => {
    await renderScreen(<PlacesScreen api={makeApi()} />);
    await screen.findByText('[집 주소]');

    await fireEvent.press(screen.getByRole('button', { name: '다음' }));
    expect(mockPush).toHaveBeenLastCalledWith('/setup/fill-places');
    await fireEvent.press(screen.getByText('건너뛰기'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenLastCalledWith('/setup/fill-places');
  });

  it('다음은 저장하지 않는다(변경은 그때그때 저장한다)', async () => {
    const api = makeApi();
    await renderScreen(<PlacesScreen api={api} />);
    await fireEvent.press(await screen.findByRole('button', { name: '다음' }));
    expect(api.assignPlace).not.toHaveBeenCalled();
  });
});

describe('추천 추가', () => {
  it('추가하면 other 자리 하나만 서버에 보내고, 서버가 돌려준 전체 상태로 화면을 바꾼다', async () => {
    const api = makeApi({}, { home: APT, work: null, others: [], revision: 3 });
    await renderScreen(<PlacesScreen api={api} />);

    await fireEvent.press(await screen.findByRole('button', { name: '체육관 추가' }));

    await waitFor(() => expect(noAddButton('체육관')).toBeNull());
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
    expect(api.assignPlace).toHaveBeenCalledWith('other', GYM.id, expect.any(AbortSignal));
    expect(screen.getByText(homeLine)).toBeOnTheScreen();
    expect(screen.getByText(GYM.address)).toBeOnTheScreen();
    expect(addButton('광주-기아 챔피언스필드')).toBeOnTheScreen();
  });

  it('두 번째 추가는 첫 번째 위에 쌓인다', async () => {
    const api = makeApi();
    await renderScreen(<PlacesScreen api={api} />);

    await fireEvent.press(await screen.findByRole('button', { name: '체육관 추가' }));
    await fireEvent.press(await screen.findByRole('button', { name: '광주-기아 챔피언스필드 추가' }));
    await waitFor(() => expect(api.assignPlace).toHaveBeenCalledTimes(2));

    expect(api.server.get().others.map((p) => p.id)).toEqual([GYM.id, FIELD.id]);
    await waitFor(() => expect(screen.queryByText('캘린더에서 자주 나온 곳')).toBeNull());
  });

  it('저장 중에는 그 버튼에 로딩을 보이고 집·회사 줄·직접 추가·다른 추가·다음을 모두 막으며, 건너뛰기는 누를 수 있다', async () => {
    let resolve: (v: unknown) => void = () => {};
    const api = makeApi({ assignPlace: jest.fn().mockReturnValue(new Promise((r) => (resolve = r))) });
    await renderScreen(<PlacesScreen api={api} />);

    void fireEvent.press(await screen.findByRole('button', { name: '체육관 추가' }));

    await waitFor(() => expect(addButton('체육관')).toBeBusy());
    expect(addButton('광주-기아 챔피언스필드')).toBeDisabled();
    expect(screen.getByRole('button', { name: '집, 주소 미설정' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '회사, 주소 미설정' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '장소 직접 추가' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();

    await fireEvent.press(addButton('광주-기아 챔피언스필드'));
    await fireEvent.press(screen.getByRole('button', { name: '집, 주소 미설정' }));
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('건너뛰기'));
    expect(mockPush).toHaveBeenCalledWith('/setup/fill-places');

    await act(async () => resolve({ ...EMPTY, others: [GYM] }));
  });

  it('네트워크·5xx 실패는 오류 안내를 알리고 추천은 그대로이며, 다시 시도가 같은 요청을 다시 보낸다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const base = makeApi();
    const assignPlace = jest.fn().mockRejectedValueOnce(new HttpError(503, 'PUT 503')).mockImplementation(base.assignPlace);
    await renderScreen(<PlacesScreen api={{ ...base, assignPlace }} />);

    await fireEvent.press(await screen.findByRole('button', { name: '체육관 추가' }));

    expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(SAVE_FAILED);
    expect(addButton('체육관')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(noAddButton('체육관')).toBeNull());
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    expect(assignPlace).toHaveBeenCalledTimes(2);
    expect(assignPlace.mock.calls[1].slice(0, 2)).toEqual(assignPlace.mock.calls[0].slice(0, 2));
    announce.mockRestore();
  });

  it('서버가 거절(4xx)하면 같은 요청을 다시 보내지 않고 다시 시도 없이 최신 상태를 다시 불러온다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const api = makeApi();
    await renderScreen(<PlacesScreen api={api} />);
    await screen.findByText('[집 주소]');
    // 화면이 모르는 사이에 서버에 이미 추가돼 있다.
    api.server.set({ ...EMPTY, others: [GYM], revision: 5 });

    await fireEvent.press(addButton('체육관'));

    await waitFor(() => expect(noAddButton('체육관')).toBeNull());
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    expect(screen.queryByText('다시 시도')).toBeNull();
    expect(screen.getByText(GYM.address)).toBeOnTheScreen();
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
    expect(api.fetchFavorites).toHaveBeenCalledTimes(2);
    announce.mockRestore();
  });

  it('서버가 거절(4xx)한 뒤 최신 상태를 다시 불러오는 것도 실패하면 불러오기 실패 상태가 되고 저장 실패 문구는 지운다', async () => {
    const fetchFavorites = jest.fn();
    const api = makeApi({ fetchFavorites });
    fetchFavorites.mockResolvedValueOnce(api.server.get()).mockRejectedValue(new Error('offline'));
    await renderScreen(<PlacesScreen api={api} />);
    await screen.findByText('[집 주소]');
    api.server.set({ ...EMPTY, others: [GYM], revision: 5 });

    await fireEvent.press(addButton('체육관'));

    expect(await screen.findByText(LOAD_FAILED)).toBeOnTheScreen();
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
  });

  it('저장이 시간 제한을 넘기면 요청을 취소하고 다시 시도할 수 있는 실패 상태가 된다', async () => {
    let signal: AbortSignal | undefined;
    const assignPlace = jest.fn().mockImplementation((_t: string, _id: string, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    await renderScreen(<PlacesScreen api={makeApi({ assignPlace })} timeoutMs={80} />);

    void fireEvent.press(await screen.findByRole('button', { name: '체육관 추가' }));
    expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
    expect(signal?.aborted).toBe(true);
    expect(addButton('체육관')).not.toBeDisabled();
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
  });

  it('추천 두 곳이 서버 추천과 같은 문구로 보인다', async () => {
    await renderScreen(<PlacesScreen api={makeApi()} />);
    for (const s of SUGGESTIONS) expect(await screen.findByText(s.hint)).toBeOnTheScreen();
  });
});

describe('오래된 화면 상태가 서버의 다른 자리를 지우지 않는다', () => {
  it('집을 저장한 직후(화면은 아직 모름) 추천을 추가해도 집이 남는다', async () => {
    const api = makeApi();
    await renderScreen(<PlacesScreen api={api} />);
    await screen.findByText('[집 주소]');
    // 검색 화면이 집을 저장했지만 이 화면은 아직 갱신하지 못했다.
    api.server.set({ ...EMPTY, home: APT, revision: 1 });

    await fireEvent.press(addButton('체육관'));

    expect(await screen.findByText(homeLine)).toBeOnTheScreen();
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
    expect(api.assignPlace).toHaveBeenCalledWith('other', GYM.id, expect.any(AbortSignal));
    expect(api.server.get().home?.id).toBe(APT.id);
    expect(screen.queryByText('[집 주소]')).toBeNull();
  });

  it('조용한 갱신이 실패한 뒤 추천을 추가해도 서버의 집·회사가 남는다', async () => {
    const fetchFavorites = jest.fn();
    const api = makeApi({ fetchFavorites }, { home: APT, work: TOWER, others: [], revision: 2 });
    fetchFavorites.mockResolvedValueOnce(api.server.get()).mockRejectedValue(new Error('offline'));
    const view = await renderScreen(<PlacesScreen api={api} />);
    await screen.findByText(homeLine);
    // 화면에는 아직 비어 있다고 믿게 하는 대신, 갱신 실패 뒤의 오래된 값 위에서 추가한다.
    await view.rerender(
      <SafeAreaProvider initialMetrics={insets}>
        <PlacesScreen api={{ ...api }} />
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(fetchFavorites).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();

    await fireEvent.press(addButton('체육관'));

    await waitFor(() => expect(noAddButton('체육관')).toBeNull());
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
    expect(api.assignPlace.mock.calls[0].slice(0, 2)).toEqual(['other', GYM.id]);
    expect(screen.getByText(homeLine)).toBeOnTheScreen();
    expect(screen.getByText(`${TOWER.name} · ${TOWER.address}`)).toBeOnTheScreen();
    expect(api.server.get().home?.id).toBe(APT.id);
    expect(api.server.get().work?.id).toBe(TOWER.id);
  });

  it('화면에 보이는 값과 상관없이 서버로 가는 요청에는 전체 상태가 없다', async () => {
    const api = makeApi({}, { home: APT, work: TOWER, others: [], revision: 2 });
    await renderScreen(<PlacesScreen api={api} />);
    await fireEvent.press(await screen.findByRole('button', { name: '체육관 추가' }));
    await waitFor(() => expect(api.assignPlace).toHaveBeenCalledTimes(1));
    expect(api.assignPlace.mock.calls[0]).toHaveLength(3);
    expect(api.assignPlace.mock.calls[0][0]).toBe('other');
    expect(api.assignPlace.mock.calls[0][1]).toBe(GYM.id);
  });
});

describe('다시 열 때', () => {
  it('처음 이후 포커스를 되찾으면 화면을 바꾸지 않고 서버 값으로 조용히 갱신한다', async () => {
    const api = makeApi();
    const view = await renderScreen(<PlacesScreen api={api} />);
    await screen.findByText('[집 주소]');
    expect(api.fetchFavorites).toHaveBeenCalledTimes(1);

    api.server.set({ ...EMPTY, home: APT, revision: 1 });
    // useFocusEffect 목은 콜백이 바뀔 때 다시 실행한다. 같은 api로 다시 그려도 바뀌지 않으므로 새 api 객체로 포커스를 흉내 낸다.
    await view.rerender(
      <SafeAreaProvider initialMetrics={insets}>
        <PlacesScreen api={{ ...api }} />
      </SafeAreaProvider>,
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(await screen.findByText(homeLine)).toBeOnTheScreen();
  });

  it('조용한 갱신이 실패해도 보이던 화면을 유지한다', async () => {
    const fetchFavorites = jest.fn().mockResolvedValueOnce({ ...EMPTY, home: APT }).mockRejectedValue(new Error('offline'));
    const api = makeApi({ fetchFavorites });
    const view = await renderScreen(<PlacesScreen api={api} />);
    await screen.findByText(homeLine);

    await view.rerender(
      <SafeAreaProvider initialMetrics={insets}>
        <PlacesScreen api={{ ...api }} />
      </SafeAreaProvider>,
    );
    await waitFor(() => expect(fetchFavorites).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
    expect(screen.getByText(homeLine)).toBeOnTheScreen();
  });
});

describe('글꼴', () => {
  it('글꼴이 로드되면 굵기별 family를 쓴다', async () => {
    await renderScreen(
      <FontsLoadedContext.Provider value>
        <PlacesScreen api={makeApi()} />
      </FontsLoadedContext.Provider>,
    );
    const title = await screen.findByText('자주 가는 곳을 알려주세요');
    expect(title).toHaveStyle({ fontFamily: 'IBMPlexSansKR_600SemiBold' });
  });
});
