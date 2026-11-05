import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';

export function PlacesPlaceholderScreen() {
  const insets = useSafeAreaInsets();
  const font = useFont();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <SetupHeader step={2} />
      <Text accessibilityRole="header" style={[styles.title, font(600)]}>
        {strings.places.title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20, gap: 22 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
});
