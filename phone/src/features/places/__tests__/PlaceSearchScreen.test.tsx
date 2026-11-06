import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpError } from '../../../api/request';
import { PlaceSearchScreen } from '../PlaceSearchScreen';
import { APT, EMPTY, GYM, makeApi, TOWER } from '../testSupport';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
}));

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderScreen = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);

const SEARCH_FAILED = '장소를 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.';
const SAVE_FAILED = '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
const input = () => screen.getByLabelText('장소 검색');
const resultButton = (place: { name: string; address: string }) => screen.getByRole('button', { name: `${place.name}, ${place.address}` });

beforeEach(() => {
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack.mockReset().mockReturnValue(true);
});

describe('PlaceSearchScreen 렌더', () => {
  it.each([
    ['home', '집 주소 찾기'],
    ['work', '회사 주소 찾기'],
    ['other', '장소 찾기'],
  ] as const)('%s 대상은 제목 "%s"과 2 / 4 진행 표시, 입력칸, 취소를 보여 준다', async (target, title) => {
    await renderScreen(<PlaceSearchScreen target={target} api={makeApi()} debounceMs={0} />);

    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
    expect(screen.getByText('2 / 4')).toBeOnTheScreen();
    expect(input()).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('장소 이름이나 주소로 검색')).toBeOnTheScreen();
    expect(screen.getByText('취소')).toBeOnTheScreen();
  });

  it('검색어를 넣기 전에는 요청하지 않고 결과도 없다', async () => {
    const api = makeApi();
    await renderScreen(<PlaceSearchScreen target="home" api={api} debounceMs={0} />);
    await fireEvent.changeText(input(), '   ');
    expect(api.searchPlaces).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();
  });
});

describe('검색', () => {
  it('공백을 뺀 검색어와 signal로 서버에 묻고 결과를 줄로 보여 준다', async () => {
    const searchPlaces = jest.fn().mockResolvedValue([APT, TOWER]);
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={0} />);

    await fireEvent.changeText(input(), '  광주 ');

    expect(await screen.findByText(APT.name)).toBeOnTheScreen();
    expect(resultButton(TOWER)).toBeOnTheScreen();
    expect(searchPlaces).toHaveBeenCalledWith('광주', expect.any(AbortSignal));
  });

  it('검색 중에는 접근 가능한 로딩 표시를 보여 준다', async () => {
    const searchPlaces = jest.fn().mockReturnValue(new Promise(() => {}));
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={0} />);

    await fireEvent.changeText(input(), '광주');
    expect(await screen.findByRole('progressbar', { name: '장소를 찾는 중' })).toBeOnTheScreen();
  });

  it('결과가 없으면 안내를 보여 준다', async () => {
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi()} debounceMs={0} />);
    await fireEvent.changeText(input(), '없는곳');
    expect(await screen.findByText('검색 결과가 없어요')).toBeOnTheScreen();
  });

  it('입력을 멈추기 전까지는 묻지 않고(디바운스), 마지막 입력으로만 묻는다', async () => {
    const searchPlaces = jest.fn().mockResolvedValue([]);
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={60} />);

    await fireEvent.changeText(input(), '광');
    await fireEvent.changeText(input(), '광주');
    expect(searchPlaces).not.toHaveBeenCalled();

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledTimes(1));
    expect(searchPlaces).toHaveBeenCalledWith('광주', expect.any(AbortSignal));
  });

  it('앞뒤 공백만 달라진 입력은 다시 검색하지 않는다', async () => {
    const searchPlaces = jest.fn().mockResolvedValue([APT]);
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={0} />);

    await fireEvent.changeText(input(), '광주');
    expect(await screen.findByText(APT.name)).toBeOnTheScreen();
    await fireEvent.changeText(input(), '광주 ');
    await fireEvent.changeText(input(), ' 광주 ');

    expect(searchPlaces).toHaveBeenCalledTimes(1);
    expect(screen.getByText(APT.name)).toBeOnTheScreen();
  });

  it('입력을 멈추기 전에는 이전 결과를 지우지 않고, 검색을 시작할 때 로딩으로 바뀐다', async () => {
    const searchPlaces = jest.fn().mockResolvedValueOnce([APT]).mockReturnValue(new Promise(() => {}));
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={80} />);

    await fireEvent.changeText(input(), '아파트');
    expect(await screen.findByText(APT.name)).toBeOnTheScreen();
    await fireEvent.changeText(input(), '타워');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(APT.name)).toBeOnTheScreen();

    expect(await screen.findByRole('progressbar', { name: '장소를 찾는 중' })).toBeOnTheScreen();
    expect(screen.queryByText(APT.name)).toBeNull();
  });

  it('검색어를 모두 지웠다가 다시 입력하면 이전 결과를 다시 보이지 않는다', async () => {
    const searchPlaces = jest.fn().mockResolvedValueOnce([APT]).mockReturnValue(new Promise(() => {}));
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={80} />);

    await fireEvent.changeText(input(), '아파트');
    expect(await screen.findByText(APT.name)).toBeOnTheScreen();
    await fireEvent.changeText(input(), '');
    expect(screen.queryByText(APT.name)).toBeNull();
    await fireEvent.changeText(input(), '타');
    expect(screen.queryByText(APT.name)).toBeNull();
  });

  it('새 입력이 오면 이전 요청을 취소하고 이전 결과는 버린다', async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (v: unknown) => void = () => {};
    const searchPlaces = jest
      .fn()
      .mockImplementationOnce((_q: string, s: AbortSignal) => {
        signals.push(s);
        return new Promise((r) => (resolveFirst = r));
      })
      .mockResolvedValue([TOWER]);
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={0} />);

    await fireEvent.changeText(input(), '아파트');
    await waitFor(() => expect(searchPlaces).toHaveBeenCalledTimes(1));
    await fireEvent.changeText(input(), '타워');

    expect(await screen.findByText(TOWER.name)).toBeOnTheScreen();
    expect(signals[0].aborted).toBe(true);
    await act(async () => resolveFirst([APT]));
    expect(screen.queryByText(APT.name)).toBeNull();
  });

  it('입력칸 글자 수 상한은 서버와 같은 50자다', async () => {
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi()} debounceMs={0} />);
    expect(input().props.maxLength).toBe(50);
  });

  it('입력값이 바뀔 때마다 마지막 값으로 검색한다(글자를 하나씩 바꾸는 입력을 흉내 낸 것으로, 실제 IME 조합은 포함하지 않는다)', async () => {
    const searchPlaces = jest.fn().mockResolvedValue([]);
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={0} />);
    await fireEvent.changeText(input(), '육');
    await fireEvent.changeText(input(), '육저');
    await fireEvent.changeText(input(), '육전');
    await waitFor(() => expect(searchPlaces).toHaveBeenLastCalledWith('육전', expect.any(AbortSignal)));
  });

  it('검색이 실패하면 오류 안내를 알리고 다시 시도로 복구한다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const searchPlaces = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([APT]);
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} debounceMs={0} />);

    await fireEvent.changeText(input(), '광주');
    expect(await screen.findByText(SEARCH_FAILED)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(SEARCH_FAILED);

    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText(APT.name)).toBeOnTheScreen();
    expect(searchPlaces).toHaveBeenCalledTimes(2);
    announce.mockRestore();
  });

  it('검색이 시간 제한을 넘기면 요청을 취소하고 오류 상태가 된다', async () => {
    let signal: AbortSignal | undefined;
    const searchPlaces = jest.fn().mockImplementation((_q: string, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi({ searchPlaces })} timeoutMs={80} debounceMs={0} />);

    await fireEvent.changeText(input(), '광주');
    expect(await screen.findByText(SEARCH_FAILED)).toBeOnTheScreen();
    expect(signal?.aborted).toBe(true);
  });
});

describe('장소 고르기', () => {
  const pickApt = async (target: 'home' | 'work' | 'other', api: ReturnType<typeof makeApi>, place = APT) => {
    await renderScreen(<PlaceSearchScreen target={target} api={api} debounceMs={0} />);
    await fireEvent.changeText(input(), '검색어');
    await fireEvent.press(await screen.findByRole('button', { name: `${place.name}, ${place.address}` }));
  };

  it.each([
    ['home', APT],
    ['work', TOWER],
    ['other', GYM],
  ] as const)('%s 대상이면 그 자리 하나만 서버에 보내고(저장값을 먼저 읽지 않는다) 돌아간다', async (target, place) => {
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([place]) });
    await pickApt(target, api, place);

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
    expect(api.assignPlace).toHaveBeenCalledWith(target, place.id, expect.any(AbortSignal));
    expect(api.fetchFavorites).not.toHaveBeenCalled();
  });

  it('서버가 돌려준 결과로 다른 자리는 그대로이고, 다른 자리의 같은 장소는 옮겨진다', async () => {
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([GYM]) }, { home: APT, work: TOWER, others: [GYM], revision: 4 });
    await pickApt('work', api, GYM);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const saved = api.server.get();
    expect([saved.home?.id, saved.work?.id, saved.others.length]).toEqual([APT.id, GYM.id, 0]);
  });

  it('저장 중에는 로딩을 보이고 결과를 다시 눌러도 한 번만 저장하며, 끝나기 전에는 돌아가지 않는다', async () => {
    let resolve: (v: unknown) => void = () => {};
    const api = makeApi({
      searchPlaces: jest.fn().mockResolvedValue([APT]),
      assignPlace: jest.fn().mockReturnValue(new Promise((r) => (resolve = r))),
    });
    await renderScreen(<PlaceSearchScreen target="home" api={api} debounceMs={0} />);
    await fireEvent.changeText(input(), '아파트');

    void fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));

    expect(await screen.findByRole('progressbar', { name: '저장하는 중' })).toBeOnTheScreen();
    expect(input().props.editable).toBe(false);
    expect(resultButton(APT)).toBeDisabled();
    await fireEvent.press(resultButton(APT));
    await waitFor(() => expect(api.assignPlace).toHaveBeenCalledTimes(1));
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => resolve({ ...EMPTY, home: APT }));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it('네트워크·5xx 실패는 오류 안내를 알리고 결과를 유지하며, 다시 시도가 같은 요청을 다시 보낸다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const base = makeApi({ searchPlaces: jest.fn().mockResolvedValue([APT]) });
    const assignPlace = jest.fn().mockRejectedValueOnce(new HttpError(500, 'PUT 500')).mockImplementation(base.assignPlace);
    await renderScreen(<PlaceSearchScreen target="home" api={{ ...base, assignPlace }} debounceMs={0} />);
    await fireEvent.changeText(input(), '아파트');

    await fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(SAVE_FAILED);
    expect(resultButton(APT)).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(assignPlace).toHaveBeenCalledTimes(2);
    expect(assignPlace.mock.calls[1].slice(0, 2)).toEqual(['home', APT.id]);
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    announce.mockRestore();
  });

  it('서버가 거절(4xx)하면 같은 요청을 다시 보내지 않고 돌아가 2단계 화면이 최신 상태를 불러오게 한다', async () => {
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([GYM]) }, { ...EMPTY, others: [GYM], revision: 3 });
    await pickApt('other', api, GYM);

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(api.assignPlace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('다시 시도')).toBeNull();
  });

  it('저장이 시간 제한을 넘기면 요청을 취소하고 다시 시도할 수 있는 실패 상태가 된다', async () => {
    let signal: AbortSignal | undefined;
    const assignPlace = jest.fn().mockImplementation((_t: string, _id: string, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([APT]), assignPlace });
    await renderScreen(<PlaceSearchScreen target="home" api={api} timeoutMs={150} debounceMs={0} />);
    await fireEvent.changeText(input(), '아파트');

    void fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
    expect(signal?.aborted).toBe(true);
    expect(screen.getByText('다시 시도')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('저장 중에 취소하면 요청을 취소하고 돌아가며 다른 요청을 보내지 않는다', async () => {
    const assignPlace = jest.fn().mockImplementation((_t: string, _id: string, _s: AbortSignal) => {
      return new Promise(() => {});
    });
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([APT]), assignPlace }, { ...EMPTY, work: TOWER, revision: 2 });
    await renderScreen(<PlaceSearchScreen target="home" api={api} debounceMs={0} />);
    await fireEvent.changeText(input(), '아파트');
    void fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    await screen.findByRole('progressbar', { name: '저장하는 중' });

    await fireEvent.press(screen.getByText('취소'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(assignPlace).toHaveBeenCalledTimes(1);
    expect(assignPlace.mock.calls[0].slice(0, 2)).toEqual(['home', APT.id]);
    expect(api.fetchFavorites).not.toHaveBeenCalled();
    expect(api.server.get().work?.id).toBe(TOWER.id);
  });

  it('화면이 사라질 때 진행 중인 요청을 취소한다', async () => {
    let signal: AbortSignal | undefined;
    const assignPlace = jest.fn().mockImplementation((_t: string, _id: string, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([APT]), assignPlace });
    const view = await renderScreen(<PlaceSearchScreen target="home" api={api} debounceMs={0} />);
    await fireEvent.changeText(input(), '아파트');
    void fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    await screen.findByRole('progressbar', { name: '저장하는 중' });

    await view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('취소와 돌아가기', () => {
  it('취소는 저장하지 않고 돌아간다', async () => {
    const api = makeApi();
    await renderScreen(<PlaceSearchScreen target="home" api={api} debounceMs={0} />);
    await fireEvent.press(screen.getByText('취소'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(api.assignPlace).not.toHaveBeenCalled();
  });

  it('돌아갈 화면이 없으면(바로 열린 경우) 2단계 화면으로 바꿔 간다', async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderScreen(<PlaceSearchScreen target="home" api={makeApi()} debounceMs={0} />);
    await fireEvent.press(screen.getByText('취소'));
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/setup/places');
  });
});


describe('3단계 일정 장소 검색', () => {
  it('선택한 일정에만 장소를 저장하고 3단계로 돌아간다', async () => {
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([APT]) });
    const scheduleApi = { fetchSchedules: jest.fn(), savePlace: jest.fn().mockResolvedValue({ id: 'lunch', place: APT, locationText: APT.name, noTravel: false }) };
    await renderScreen(<PlaceSearchScreen scheduleId="lunch" api={api} scheduleApi={scheduleApi} debounceMs={0} />);
    expect(screen.getByText('3 / 4')).toBeOnTheScreen();
    await fireEvent.changeText(input(), '아파트');
    await fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(scheduleApi.savePlace).toHaveBeenCalledWith('lunch', { placeId: APT.id }, expect.any(AbortSignal));
    expect(api.assignPlace).not.toHaveBeenCalled();
  });

  it('저장 실패는 성공으로 이동하지 않고, 재시도가 같은 일정에만 적용된다', async () => {
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([APT]) });
    const savePlace = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    await renderScreen(<PlaceSearchScreen scheduleId="lunch" api={api} scheduleApi={{ fetchSchedules: jest.fn(), savePlace }} debounceMs={0} />);
    await fireEvent.changeText(input(), '아파트');
    await fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    await screen.findByText(SAVE_FAILED);
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(savePlace).toHaveBeenCalledTimes(2);
  });

  it('선택 해제된 일정은 실패를 안내하고 목록으로 돌아가게 한다', async () => {
    mockCanGoBack.mockReturnValue(false);
    const api = makeApi({ searchPlaces: jest.fn().mockResolvedValue([APT]) });
    const savePlace = jest.fn().mockRejectedValue(new HttpError(404, 'removed'));
    await renderScreen(<PlaceSearchScreen scheduleId="lunch" api={api} scheduleApi={{ fetchSchedules: jest.fn(), savePlace }} debounceMs={0} />);
    await fireEvent.changeText(input(), '아파트');
    await fireEvent.press(await screen.findByRole('button', { name: `${APT.name}, ${APT.address}` }));
    await screen.findByText('일정이 바뀌었어요. 목록에서 다시 확인해 주세요.');
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('일정 목록으로'));
    expect(mockReplace).toHaveBeenCalledWith('/setup/fill-places');
    expect(savePlace).toHaveBeenCalledTimes(1);
  });
});
