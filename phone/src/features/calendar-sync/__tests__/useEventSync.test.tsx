import { render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import type { EventSync } from '../eventSync';
import { useEventSync } from '../useEventSync';

function Probe({ sync }: { sync: EventSync }) {
  useEventSync(sync);
  return null;
}

describe('useEventSync', () => {
  let handler: ((state: string) => void) | undefined;
  const remove = jest.fn();
  beforeEach(() => {
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
});
