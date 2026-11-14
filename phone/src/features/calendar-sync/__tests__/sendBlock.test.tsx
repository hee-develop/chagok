import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { fakeSync } from '../../../__tests__/support/notifications';
import type { SyncResult } from '../eventSync';
import { nextSendBlock, useEventSendBlock } from '../sendBlock';

describe('nextSendBlock', () => {
  it('권한·선택 문제면 그 이유, 보냄·변화 없음·목이면 풀림, 실패·취소는 이전 값을 유지한다', () => {
    expect(nextSendBlock(null, 'permission-denied')).toBe('permission-denied');
    expect(nextSendBlock('permission-denied', 'no-selection')).toBe('no-selection');
    for (const r of ['sent', 'unchanged', 'mock'] as const) expect(nextSendBlock('no-selection', r)).toBeNull();
    for (const r of ['failed', 'cancelled', null] as const) {
      expect(nextSendBlock('no-selection', r)).toBe('no-selection');
      expect(nextSendBlock(null, r)).toBeNull();
    }
  });
});

describe('useEventSendBlock(홈이 쓰는 일정을 보낼 수 없는 이유)', () => {
  function Probe({ sync }: { sync: ReturnType<typeof fakeSync>['sync'] }) {
    return <Text testID="out">{String(useEventSendBlock(sync))}</Text>;
  }

  it('처음에는 마지막 결과에서 시작하고, 결과가 바뀔 때마다 따라간다(알림함과는 별개)', async () => {
    const fake = fakeSync('permission-denied');
    await render(<Probe sync={fake.sync} />);
    expect(screen.getByTestId('out')).toHaveTextContent('permission-denied');
    const emit = async (r: SyncResult) => act(async () => fake.emit(r));
    await emit('failed');
    expect(screen.getByTestId('out')).toHaveTextContent('permission-denied');
    await emit('no-selection');
    expect(screen.getByTestId('out')).toHaveTextContent('no-selection');
    await emit('sent');
    expect(screen.getByTestId('out')).toHaveTextContent('null');
  });

  it('동기화가 아직 끝난 적 없으면 null이고, 내려가면 구독을 푼다', async () => {
    const fake = fakeSync(null);
    const view = await render(<Probe sync={fake.sync} />);
    expect(screen.getByTestId('out')).toHaveTextContent('null');
    expect(fake.listenerCount()).toBe(1);
    await view.unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});
