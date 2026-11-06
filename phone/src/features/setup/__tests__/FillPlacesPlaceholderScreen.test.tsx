import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FillPlacesPlaceholderScreen } from '../FillPlacesPlaceholderScreen';

const insets = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

describe('FillPlacesPlaceholderScreen', () => {
  it('3 / 4 진행 표시와 제목만 보여 준다', async () => {
    await render(
      <SafeAreaProvider initialMetrics={insets}>
        <FillPlacesPlaceholderScreen />
      </SafeAreaProvider>,
    );
    expect(screen.getByText('3 / 4')).toBeOnTheScreen();
    expect(screen.getByText('장소가 빈 일정이 2개 있어요')).toBeOnTheScreen();
    expect(screen.getAllByTestId('progress-bar-filled')).toHaveLength(3);
  });
});
