import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TalkScreen } from '../TalkScreen';

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

it('4단계 진행 표시와 제목을 보여 준다', async () => {
  await render(<SafeAreaProvider initialMetrics={insets}><TalkScreen /></SafeAreaProvider>);
  expect(screen.getByRole('header', { name: '말 거는 방법' })).toBeOnTheScreen();
  expect(screen.getByText('4 / 4')).toBeOnTheScreen();
  expect(screen.getAllByTestId('progress-bar-filled')).toHaveLength(4);
});
