import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo, AppState, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FontsLoadedContext } from '../../../ui/theme';
import { CalendarSelectScreen } from '../CalendarSelectScreen';
import { CalendarPermissionError, MOCK_CALENDARS, type CalendarSource } from '../calendarSource';
import { REQUEST_TIMEOUT_MS } from '../../../api/request';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
const mockPut = jest.fn();
jest.mock('../../../api/client', () => ({ api: { calendars: { selection: { $put: (...a: unknown[]) => mockPut(...a) } } } }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

const renderScreen = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={insets}>{ui}</SafeAreaProvider>);

const base = { kind: 'mock' as const, listEvents: async () => [] };
const source: CalendarSource = { ...base, list: async () => MOCK_CALENDARS.map((c) => ({ ...c })) };
const noSaved = jest.fn().mockResolvedValue(null);

const row = (name: string, account: string) => screen.getByRole('checkbox', { name: `${name}, ${account}` });

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack = true;
  mockPut.mockReset();
  noSaved.mockClear();
});

describe('CalendarSelectScreen 렌더', () => {
  it('시안의 문구와 6개 캘린더, 기본 선택 3개를 보여 준다', async () => {
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={noSaved} />);

    expect(await screen.findByText('캘린더를 골라 주세요')).toBeOnTheScreen();
    expect(screen.getByText('고른 캘린더의 일정만 차에 보내요.')).toBeOnTheScreen();
    expect(screen.getByText('1 / 5')).toBeOnTheScreen();
    expect(screen.getByText('일정은 읽기만 해요. 온라인 회의나 회의실 일정은 걸러서 차에 보내지 않아요.')).toBeOnTheScreen();
    expect(screen.getByText('나중에 할게요')).toBeOnTheScreen();
    expect(screen.getByText('캘린더 3개 연결하기')).toBeOnTheScreen();

    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    expect(screen.getAllByTestId('progress-bar-filled')).toHaveLength(1);
    expect(screen.getAllByTestId('progress-bar-empty')).toHaveLength(4);
  });

  it('각 줄이 checkbox 역할과 checked 상태를 노출한다', async () => {
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={noSaved} />);
    await screen.findByText('캘린더를 골라 주세요');

    expect(row('내 캘린더', '삼성 계정')).toBeChecked();
    expect(row('회사', '구글 · 회사 계정')).toBeChecked();
    expect(row('우리 가족', '공유 캘린더')).toBeChecked();
    expect(row('대한민국 공휴일', '구독')).not.toBeChecked();
    expect(row('생일', '연락처')).not.toBeChecked();
    expect(row('KIA 타이거즈 경기', '구독')).not.toBeChecked();
  });

  it('로딩 중에는 목록 대신 접근 가능한 로딩 표시를 보여 준다', async () => {
    const pending: CalendarSource = { ...base, list: () => new Promise(() => {}) };
    await renderScreen(<CalendarSelectScreen source={pending} save={jest.fn()} restore={noSaved} />);

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('progressbar', { name: '캘린더를 불러오는 중' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '캘린더 0개 연결하기' })).toBeDisabled();
  });

  it('캘린더를 못 읽으면 오류 안내를 알리고 다시 시도로 복구한다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const list = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue(MOCK_CALENDARS);
    await renderScreen(<CalendarSelectScreen source={{ ...base, list }} save={jest.fn()} restore={noSaved} />);

    expect(await screen.findByText('캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText('캘린더 3개 연결하기')).toBeOnTheScreen();
    announce.mockRestore();
  });

  it('캘린더가 0개여도 화면이 깨지지 않고 주 버튼만 비활성이다', async () => {
    await renderScreen(<CalendarSelectScreen source={{ ...base, list: async () => [] }} save={jest.fn()} restore={noSaved} />);
    expect(await screen.findByText(/연결할 캘린더가 없어요/)).toBeOnTheScreen();

    expect(await screen.findByRole('button', { name: '캘린더 0개 연결하기' })).toBeDisabled();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('나중에 할게요')).toBeOnTheScreen();
  });
});

describe('저장된 선택 복원', () => {
  it('서버에 저장된 선택이 있으면 그것으로 시작한다', async () => {
    const restore = jest.fn().mockResolvedValue(['mock-work', 'mock-kia']);
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={restore} />);

    expect(await screen.findByText('캘린더 2개 연결하기')).toBeOnTheScreen();
    expect(row('KIA 타이거즈 경기', '구독')).toBeChecked();
    expect(row('회사', '구글 · 회사 계정')).toBeChecked();
    expect(row('내 캘린더', '삼성 계정')).not.toBeChecked();
  });

  it('목록에 없는 저장 id는 무시한다', async () => {
    const restore = jest.fn().mockResolvedValue(['mock-work', 'gone']);
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={restore} />);
    expect(await screen.findByText('캘린더 1개 연결하기')).toBeOnTheScreen();
  });

  it('저장된 id가 이 기기에 하나도 없으면(목 id만 저장된 경우 등) 기본 선택으로 시작한다', async () => {
    const restore = jest.fn().mockResolvedValue(['mock-a', 'mock-b']);
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={restore} />);
    expect(await screen.findByText('캘린더 3개 연결하기')).toBeOnTheScreen();
  });

  it('저장된 게 없으면(null) 기본 선택으로 시작한다', async () => {
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={noSaved} />);
    expect(await screen.findByText('캘린더 3개 연결하기')).toBeOnTheScreen();
  });

  it('조회에 실패하면 기본 선택으로 시작하지 않고 오류 상태와 다시 시도를 보인다', async () => {
    const restore = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(['mock-kia']);
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={restore} />);

    expect(await screen.findByText('캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '캘린더 0개 연결하기' })).toBeDisabled();

    await fireEvent.press(screen.getByText('다시 시도'));
    expect(await screen.findByText('캘린더 1개 연결하기')).toBeOnTheScreen();
    expect(row('KIA 타이거즈 경기', '구독')).toBeChecked();
  });

  it('조회가 시간 제한을 넘기면 오류 상태가 된다', async () => {
    const restore = jest.fn().mockReturnValue(new Promise(() => {}));
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={restore} timeoutMs={80} />);
    expect(await screen.findByText('캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('시간 제한은 기기 캘린더 목록을 읽은 뒤 조회를 시작할 때부터 센다', async () => {
    const slowSource: CalendarSource = {
      ...base,
      list: () => new Promise((resolve) => setTimeout(() => resolve(MOCK_CALENDARS.map((c) => ({ ...c }))), 150)),
    };
    const restore = jest.fn().mockResolvedValue(null);
    await renderScreen(<CalendarSelectScreen source={slowSource} save={jest.fn()} restore={restore} timeoutMs={100} />);
    expect(await screen.findByText('캘린더 3개 연결하기')).toBeOnTheScreen();
    expect(screen.queryByText('캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeNull();
  });
});

describe('선택 토글과 버튼 문구', () => {
  it('체크를 켜고 끄면 선택 수와 주 버튼 문구가 바뀐다', async () => {
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    await fireEvent.press(row('KIA 타이거즈 경기', '구독'));
    expect(row('KIA 타이거즈 경기', '구독')).toBeChecked();
    expect(screen.getByText('캘린더 4개 연결하기')).toBeOnTheScreen();

    await fireEvent.press(row('회사', '구글 · 회사 계정'));
    expect(row('회사', '구글 · 회사 계정')).not.toBeChecked();
    expect(screen.getByText('캘린더 3개 연결하기')).toBeOnTheScreen();
  });

  it('0개가 되면 주 버튼이 비활성화되고 눌러도 저장하지 않는다', async () => {
    const save = jest.fn();
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    await fireEvent.press(row('내 캘린더', '삼성 계정'));
    await fireEvent.press(row('회사', '구글 · 회사 계정'));
    await fireEvent.press(row('우리 가족', '공유 캘린더'));

    const button = screen.getByRole('button', { name: '캘린더 0개 연결하기' });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('연결하기', () => {
  it('선택한 id만 저장하고 성공하면 2단계로 이동한다', async () => {
    const save = jest.fn().mockResolvedValue({ selectedIds: [], savedAt: '' });
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    await fireEvent.press(row('KIA 타이거즈 경기', '구독'));
    await fireEvent.press(screen.getByRole('button', { name: '캘린더 4개 연결하기' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/setup/places'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual(['mock-my', 'mock-work', 'mock-family', 'mock-kia']);
    expect(typeof save.mock.calls[0][1]).toBe('number');
    expect(save.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  });

  it('저장 중에는 버튼에 로딩을 보이고 중복 누름을 막는다', async () => {
    let resolve: (v: unknown) => void = () => {};
    const save = jest.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    // 핸들러가 끝나기를 기다리지 않는다.
    void fireEvent.press(screen.getByRole('button', { name: '캘린더 3개 연결하기' }));

    expect(await screen.findByTestId('connect-loading')).toBeOnTheScreen();
    expect(screen.queryByText('캘린더 3개 연결하기')).toBeNull();
    const busy = screen.getByRole('button', { name: '저장하는 중' });
    await fireEvent.press(busy);
    expect(save).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();

    resolve({});
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/setup/places'));
  });

  it('실패하면 오류 안내를 알리고 이동하지 않으며, 다시 시도로 성공하면 이동한다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const save = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({});
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    await fireEvent.press(screen.getByRole('button', { name: '캘린더 3개 연결하기' }));

    expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText('캘린더 3개 연결하기')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/setup/places'));
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeNull();
    announce.mockRestore();
  });

  it('시간 제한 안에 응답이 없으면 요청을 취소하고 실패 상태가 된다', async () => {
    let signal: AbortSignal | undefined;
    const save = jest.fn().mockImplementation((_ids: string[], _revision: number, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} timeoutMs={80} />);
    await screen.findByText('캘린더 3개 연결하기');

    void fireEvent.press(screen.getByRole('button', { name: '캘린더 3개 연결하기' }));
    expect(await screen.findByTestId('connect-loading')).toBeOnTheScreen();
    expect(signal?.aborted).toBe(false);

    expect(await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('connect-loading')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('시간 제한 기본값은 10초다', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  });
});

describe('나중에 할게요', () => {
  it('저장하지 않고 2단계로 이동한다', async () => {
    const save = jest.fn();
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    await fireEvent.press(screen.getByText('나중에 할게요'));

    expect(mockPush).toHaveBeenCalledWith('/setup/places');
    expect(save).not.toHaveBeenCalled();
  });

  it('저장 중에도 누를 수 있고, 진행 중인 요청을 취소한 뒤 이동한다', async () => {
    let signal: AbortSignal | undefined;
    let resolve: (v: unknown) => void = () => {};
    const save = jest.fn().mockImplementation((_ids: string[], _revision: number, s: AbortSignal) => {
      signal = s;
      return new Promise((r) => (resolve = r));
    });
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    // 핸들러가 끝나기를 기다리지 않는다.
    void fireEvent.press(screen.getByRole('button', { name: '캘린더 3개 연결하기' }));
    expect(await screen.findByTestId('connect-loading')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('나중에 할게요'));

    expect(signal?.aborted).toBe(true);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/setup/places');

    await act(async () => resolve({}));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeNull();
  });
});

describe('저장 revision', () => {
  it('저장할 때마다 이전보다 큰 revision을 보낸다', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({});
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');

    await fireEvent.press(screen.getByRole('button', { name: '캘린더 3개 연결하기' }));
    await fireEvent.press(await screen.findByText('다시 시도'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(save.mock.calls[1][1]).toBeGreaterThan(save.mock.calls[0][1]);
  });
});

describe('글꼴', () => {
  it('글꼴이 로드되면 굵기별 family를 쓴다', async () => {
    await renderScreen(
      <FontsLoadedContext.Provider value>
        <CalendarSelectScreen source={source} save={jest.fn()} restore={noSaved} />
      </FontsLoadedContext.Provider>,
    );
    const title = await screen.findByText('캘린더를 골라 주세요');
    expect(title).toHaveStyle({ fontFamily: 'IBMPlexSansKR_600SemiBold' });
    expect(title).not.toHaveStyle({ fontWeight: '600' });
  });

  it('글꼴이 로드되지 않으면 시스템 글꼴에 fontWeight로 굵기를 지정한다', async () => {
    await renderScreen(<CalendarSelectScreen source={source} save={jest.fn()} restore={noSaved} />);
    const title = await screen.findByText('캘린더를 골라 주세요');
    expect(title).toHaveStyle({ fontWeight: '600' });
    expect(title).not.toHaveStyle({ fontFamily: 'IBMPlexSansKR_600SemiBold' });
  });
});

describe('캘린더 권한 거부', () => {
  const deniedSource = (list: jest.Mock): CalendarSource => ({ ...base, kind: 'device', list });

  it('권한이 없으면 안내와 설정 열기·다시 시도만 보이고 목 캘린더는 보이지 않는다', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const list = jest.fn().mockRejectedValue(new CalendarPermissionError(false));
    await renderScreen(<CalendarSelectScreen source={deniedSource(list)} save={jest.fn()} restore={noSaved} />);

    const message = '캘린더 접근을 허용해 주세요. 허용해야 일정을 차에 보낼 수 있어요.';
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(message);
    expect(screen.getByRole('button', { name: '설정 열기' })).toBeOnTheScreen();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('내 캘린더')).toBeNull();
    expect(screen.getByRole('button', { name: '캘린더 0개 연결하기' })).toBeDisabled();
    expect(screen.getByText('나중에 할게요')).toBeOnTheScreen();
    announce.mockRestore();
  });

  it('설정 열기는 시스템 설정을 연다', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const list = jest.fn().mockRejectedValue(new CalendarPermissionError(false));
    await renderScreen(<CalendarSelectScreen source={deniedSource(list)} save={jest.fn()} restore={noSaved} />);
    await fireEvent.press(await screen.findByRole('button', { name: '설정 열기' }));
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it('다시 시도에서 허용하면 목록이 나온다', async () => {
    const list = jest.fn().mockRejectedValueOnce(new CalendarPermissionError(true)).mockResolvedValue(MOCK_CALENDARS);
    await renderScreen(<CalendarSelectScreen source={deniedSource(list)} save={jest.fn()} restore={noSaved} />);
    await fireEvent.press(await screen.findByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('캘린더 3개 연결하기')).toBeOnTheScreen();
  });

  it('권한이 아닌 오류는 기존 불러오기 실패 안내다', async () => {
    const list = jest.fn().mockRejectedValue(new Error('boom'));
    await renderScreen(<CalendarSelectScreen source={deniedSource(list)} save={jest.fn()} restore={noSaved} />);
    expect(await screen.findByText('캘린더를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  });
});

describe('권한 설정 복귀', () => {
  it('설정에서 허용하고 앱으로 돌아오면(active) 자동으로 다시 읽는다', async () => {
    let handler: ((state: string) => void) | undefined;
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      handler = h;
      return { remove };
    }) as never);
    const list = jest.fn().mockRejectedValueOnce(new CalendarPermissionError(false)).mockResolvedValue(MOCK_CALENDARS);
    await renderScreen(<CalendarSelectScreen source={{ ...base, kind: 'device', list }} save={jest.fn()} restore={noSaved} />);
    await screen.findByRole('button', { name: '설정 열기' });
    await act(async () => handler?.('background'));
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => handler?.('active'));
    expect(await screen.findByText('캘린더 3개 연결하기')).toBeOnTheScreen();
    expect(list).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('기본 저장 함수', () => {
  it("device 출처 화면이 save를 주지 않으면 source: 'device'로 저장한다", async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => ({}) });
    const list = async () => MOCK_CALENDARS.map((c) => ({ ...c }));
    await renderScreen(<CalendarSelectScreen source={{ ...base, kind: 'device', list }} restore={noSaved} />);
    await fireEvent.press(await screen.findByRole('button', { name: '캘린더 3개 연결하기' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/setup/places'));
    expect(mockPut.mock.calls[0][0].json).toMatchObject({ source: 'device', selectedIds: ['mock-my', 'mock-work', 'mock-family'] });
  });

  it("목 출처 화면은 source: 'mock'으로 저장한다", async () => {
    mockPut.mockResolvedValue({ ok: true, json: async () => ({}) });
    await renderScreen(<CalendarSelectScreen source={source} restore={noSaved} />);
    await fireEvent.press(await screen.findByRole('button', { name: '캘린더 3개 연결하기' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    expect(mockPut.mock.calls[0][0].json.source).toBe('mock');
  });
});

describe('저장 뒤 일정 보내기', () => {
  it('저장에 성공하면 onSaved를 부르고, 저장에 실패하면 부르지 않는다', async () => {
    const onSaved = jest.fn();
    const save = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({});
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} onSaved={onSaved} />);
    await screen.findByText('캘린더 3개 연결하기');
    await fireEvent.press(screen.getByText('캘린더 3개 연결하기'));
    await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(onSaved).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('다시 시도'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(['mock-my', 'mock-work', 'mock-family']);
    expect(mockPush).toHaveBeenCalledWith('/setup/places');
  });

  it("'나중에 할게요'는 저장도 일정 보내기도 하지 않는다", async () => {
    const onSaved = jest.fn();
    const save = jest.fn();
    await renderScreen(<CalendarSelectScreen source={source} save={save} restore={noSaved} onSaved={onSaved} />);
    await screen.findByText('캘린더 3개 연결하기');
    await fireEvent.press(screen.getByText('나중에 할게요'));
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('standalone(설정 탭의 [캘린더 고르기])', () => {
  it('단계 표시(1 / 5)가 없고 [나중에 할게요] 대신 [닫기]가 있다', async () => {
    await renderScreen(<CalendarSelectScreen standalone source={source} save={jest.fn()} restore={noSaved} />);
    expect(await screen.findByText('캘린더를 골라 주세요')).toBeOnTheScreen();
    expect(screen.queryByText('1 / 5')).toBeNull();
    expect(screen.queryAllByTestId('progress-bar-filled')).toHaveLength(0);
    expect(screen.getByText('닫기')).toBeOnTheScreen();
    expect(screen.queryByText('나중에 할게요')).toBeNull();
  });

  it('저장하면 일정을 보내기 시작하고 2단계가 아니라 왔던 화면으로 돌아간다', async () => {
    const save = jest.fn().mockResolvedValue({});
    const onSaved = jest.fn();
    await renderScreen(<CalendarSelectScreen standalone source={source} save={save} restore={noSaved} onSaved={onSaved} />);
    await fireEvent.press(await screen.findByRole('button', { name: '캘린더 3개 연결하기' }));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('[닫기]는 저장하지 않고 돌아가고, 돌아갈 곳이 없으면 오늘 탭으로 간다', async () => {
    const save = jest.fn();
    mockCanGoBack = false;
    await renderScreen(<CalendarSelectScreen standalone source={source} save={save} restore={noSaved} />);
    await screen.findByText('캘린더 3개 연결하기');
    await fireEvent.press(screen.getByText('닫기'));
    expect(save).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
