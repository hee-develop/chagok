import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { useSetupGate } from '../../features/entry/setupGate';
import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';

/** 선택된 탭만 점으로 표시한다. 아이콘 에셋 없이도 글자와 함께 현재 탭을 알 수 있다. */
const tabDot = ({ focused }: { focused: boolean }) => (
  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: focused ? colors.text : 'transparent' }} />
);

const TABS = [
  { name: 'index', title: strings.tabs.today, testID: 'tabbar-today' },
  { name: 'family', title: strings.tabs.family, testID: 'tabbar-family' },
  { name: 'places', title: strings.tabs.places, testID: 'tabbar-places' },
  { name: 'settings', title: strings.tabs.settings, testID: 'tabbar-settings' },
] as const;

/**
 * 아래 탭 네 개(오늘·가족·장소·설정). 앱을 열면 여기서 갈린다:
 * 첫 설정을 끝냈거나 건너뛴 기기는 탭으로, 처음이면 기존 첫 설정 흐름(/setup/calendar)으로 보낸다.
 */
export default function TabsLayout() {
  const gate = useSetupGate();
  const font = useFont();

  // 저장소를 읽는 동안은 아무것도 그리지 않는다(스플래시가 이미 내려갔으므로 배경색만 보인다).
  if (gate === 'loading') return <View testID="entry-loading" style={{ flex: 1, backgroundColor: colors.background }} />;
  if (gate === 'needed') return <Redirect href="/setup/calendar" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 13, ...font(600) },
        tabBarIcon: tabDot,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TABS.map(({ name, title, testID }) => (
        <Tabs.Screen key={name} name={name} options={{ title, tabBarButtonTestID: testID, tabBarAccessibilityLabel: title }} />
      ))}
    </Tabs>
  );
}
