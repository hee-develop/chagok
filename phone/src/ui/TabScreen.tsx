import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SetupHeader } from './SetupHeader';
import { colors, useFont } from './theme';

/** 아래 탭 화면의 공통 틀: 로고, 제목, 스크롤 내용. 아래 여백은 탭 막대가 맡는다. */
export function TabScreen({ title, description, children, testID }: { title: string; description?: string; children: ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const font = useFont();
  return (
    <View testID={testID} style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SetupHeader />
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.title, font(600)]}>{title}</Text>
          {description ? <Text style={[styles.description, font(400)]}>{description}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 22 },
  titles: { gap: 10 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
  description: { fontSize: 16, lineHeight: 24, color: colors.textStrong },
});
