import { render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import type { EventSync } from '../eventSync';
import { REREAD_INTERVAL_MS, useEventSync } from '../useEventSync';

function Probe({ sync, interval }: { sync: EventSync; interval?: number }) {
  useEventSync(sync, interval);
  return null;
}

// jest 환경의 AppState.currentState는 비어 있어(undefined) 테스트가 앱 상태를 직접 정한다.
const setAppState = (state: string) => {
  (AppState as unknown as { currentState: string }).currentState = state;
};

describe('useEventSync', () => {
  let handler: ((state: string) => void) | undefined;
  const remove = jest.fn();
  beforeEach(() => {
    setAppState('active');
    handler = undefined;
    remove.mockReset();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      handler = h;
      return { remove };
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const makeSync = (): EventSync => ({ run: jest.fn().mockResolvedValue('sent'), stop: jest.fn(), rememberSelection: jest.fn(), lastResult: () => null });

  it('앱을 열 때 한 번, 앞으로 올 때(active)마다 보낸다. 뒤로 갈 때는 보내지 않는다', async () => {
    const sync = makeSync();
    await render(<Probe sync={sync} />);
    expect(sync.run).toHaveBeenCalledTimes(1);
    handler?.('background');
    handler?.('inactive');
    expect(sync.run).toHaveBeenCalledTimes(1);
    handler?.('active');
    expect(sync.run).toHaveBeenCalledTimes(2);
  });

  it('내려가면 구독을 풀고 진행 중인 전송을 멈춘다', async () => {
    const sync = makeSync();
    const view = await render(<Probe sync={sync} />);
    await view.unmount();
    expect(remove).toHaveBeenCalled();
    expect(sync.stop).toHaveBeenCalled();
  });

  describe('앱이 앞에 있는 동안 주기적 재읽기', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('열 때 한 번 읽고 간격마다 다시 읽는다', async () => {
      const sync = makeSync();
      await render(<Probe sync={sync} interval={1000} />);
      expect(sync.run).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(999);
      expect(sync.run).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(sync.run).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(3000);
      expect(sync.run).toHaveBeenCalledTimes(5);
    });

    it('기본 간격은 3분이다', async () => {
      const sync = makeSync();
      await render(<Probe sync={sync} />);
      expect(REREAD_INTERVAL_MS).toBe(180_000);
      jest.advanceTimersByTime(REREAD_INTERVAL_MS - 1);
      expect(sync.run).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(sync.run).toHaveBeenCalledTimes(2);
    });

    it('뒤로 가면 멈추고 앞으로 오면 곧바로 읽은 뒤 다시 주기를 잇는다(타이머가 겹치지 않는다)', async () => {
      const sync = makeSync();
      await render(<Probe sync={sync} interval={1000} />);
      handler?.('background');
      jest.advanceTimersByTime(5000);
      expect(sync.run).toHaveBeenCalledTimes(1);
      handler?.('active');
      handler?.('active');
      expect(sync.run).toHaveBeenCalledTimes(3);
      jest.advanceTimersByTime(1000);
      expect(sync.run).toHaveBeenCalledTimes(4);
    });

    it('앱이 앞에 있지 않을 때 마운트되면 처음 한 번만 읽고 주기는 앞으로 올 때 시작한다', async () => {
      setAppState('background');
      const sync = makeSync();
      await render(<Probe sync={sync} interval={1000} />);
      expect(sync.run).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(5000);
      expect(sync.run).toHaveBeenCalledTimes(1);
      handler?.('active');
      expect(sync.run).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(1000);
      expect(sync.run).toHaveBeenCalledTimes(3);
    });

    it('앞(active)에서 마운트되면 주기를 바로 시작한다', async () => {
      setAppState('active');
      const sync = makeSync();
      await render(<Probe sync={sync} interval={1000} />);
      jest.advanceTimersByTime(1000);
      expect(sync.run).toHaveBeenCalledTimes(2);
    });

    it('내려가면 주기도 멈춘다', async () => {
      const sync = makeSync();
      const view = await render(<Probe sync={sync} interval={1000} />);
      await view.unmount();
      jest.advanceTimersByTime(5000);
      expect(sync.run).toHaveBeenCalledTimes(1);
    });
  });
});
