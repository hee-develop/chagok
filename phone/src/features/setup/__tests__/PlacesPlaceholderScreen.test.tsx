import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlacesPlaceholderScreen } from '../PlacesPlaceholderScreen';

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

describe('PlacesPlaceholderScreen', () => {
  it('2 / 4 진행 표시와 제목만 보여 준다', async () => {
    await render(
      <SafeAreaProvider initialMetrics={insets}>
        <PlacesPlaceholderScreen />
      </SafeAreaProvider>,
    );
    expect(screen.getByText('2 / 4')).toBeOnTheScreen();
    expect(screen.getByText('자주 가는 곳')).toBeOnTheScreen();
    expect(screen.getAllByTestId('progress-bar-filled')).toHaveLength(2);
  });
});
