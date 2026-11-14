import { render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useNotifications } from '../useNotifications';
import { fakeNotifier } from '../testSupport';
import type { NotificationPoller } from '../poller';

function Probe(props: Parameters<typeof useNotifications>[0]) {
  useNotifications(props);
  return null;
}

describe('useNotifications(앱이 앞에 있을 때만 주기 폴링)', () => {
  let handler: ((state: string) => void) | undefined;
  const remove = jest.fn();
  const originalState: string = AppState.currentState ?? 'active';
  const setState = (state: string) => {
    (AppState as { currentState: string }).currentState = state;
  };
  beforeEach(() => {
    jest.useFakeTimers();
    handler = undefined;
    setState('active');
    remove.mockReset();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      handler = h;
      return { remove };
    }) as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    setState(originalState);
  });
  const makePoller = (): NotificationPoller => ({ poll: jest.fn().mockResolvedValue('ok'), stop: jest.fn() });

  it('앱을 열 때 한 번 보고, 앞에 있는 동안 주기마다 다시 본다', async () => {
    const poller = makePoller();
    await render(<Probe poller={poller} notifier={fakeNotifier().notifier} intervalMs={60_000} />);
    expect(poller.poll).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(59_999);
    expect(poller.poll).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(poller.poll).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(120_000);
    expect(poller.poll).toHaveBeenCalledTimes(4);
  });

  it('뒤로 가면 타이머를 멈추고, 앞으로 오면 곧바로 한 번 보고 타이머를 다시 켠다', async () => {
    const poller = makePoller();
    await render(<Probe poller={poller} notifier={fakeNotifier().notifier} intervalMs={60_000} />);
    handler?.('background');
    jest.advanceTimersByTime(600_000);
    expect(poller.poll).toHaveBeenCalledTimes(1);
    handler?.('inactive');
    jest.advanceTimersByTime(600_000);
    expect(poller.poll).toHaveBeenCalledTimes(1);
    handler?.('active');
    expect(poller.poll).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(60_000);
    expect(poller.poll).toHaveBeenCalledTimes(3);
  });

  it('active가 연달아 와도 타이머는 하나만 돈다', async () => {
    const poller = makePoller();
    await render(<Probe poller={poller} notifier={fakeNotifier().notifier} intervalMs={60_000} />);
    handler?.('active');
    handler?.('active');
    expect(poller.poll).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(60_000);
    expect(poller.poll).toHaveBeenCalledTimes(4);
  });

  it('백그라운드에서 시작했으면 앞으로 올 때까지 보지 않는다', async () => {
    setState('background');
    const poller = makePoller();
    await render(<Probe poller={poller} notifier={fakeNotifier().notifier} intervalMs={60_000} />);
    jest.advanceTimersByTime(300_000);
    expect(poller.poll).not.toHaveBeenCalled();
    handler?.('active');
    expect(poller.poll).toHaveBeenCalledTimes(1);
  });

  it('내려가면 구독·타이머·진행 중인 요청을 모두 멈춘다', async () => {
    const poller = makePoller();
    const { unsubscribe, notifier } = fakeNotifier();
    const view = await render(<Probe poller={poller} notifier={notifier} intervalMs={60_000} />);
    await view.unmount();
    expect(remove).toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
    expect(poller.stop).toHaveBeenCalled();
    jest.advanceTimersByTime(300_000);
    expect(poller.poll).toHaveBeenCalledTimes(1);
  });
});
