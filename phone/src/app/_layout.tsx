import { IBMPlexSansKR_400Regular } from '@expo-google-fonts/ibm-plex-sans-kr/400Regular';
import { IBMPlexSansKR_500Medium } from '@expo-google-fonts/ibm-plex-sans-kr/500Medium';
import { IBMPlexSansKR_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-kr/600SemiBold';
import { IBMPlexSansKR_700Bold } from '@expo-google-fonts/ibm-plex-sans-kr/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useEventSync } from '../features/calendar-sync/useEventSync';
import { bindLocalCarStateToSession } from '../features/pair-car/localState';
// 가족 요청 상태 알림을 누르면 가족 탭의 그 요청을 연다(누름 처리기를 불러오는 것만으로 등록된다).
import '../features/family/familyTaps';
// 가족에서 나가면(구성원 비밀값이 지워지면) 알림함의 가족 요청 알림도 지운다.
import '../features/family/familyInboxCleanup';
import { useNotifications } from '../features/notifications/useNotifications';
import { colors, FontsLoadedContext } from '../ui/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEventSync();
  useNotifications();
  // 서버가 401로 폰 토큰을 거절해 버릴 때(폰 바뀜·30일 정리·차곡 초기화)도 직접 끊기와 같은 범위의 로컬 상태를 비운다.
  useEffect(() => bindLocalCarStateToSession(), []);
  const [loaded, error] = useFonts({
    IBMPlexSansKR_400Regular,
    IBMPlexSansKR_500Medium,
    IBMPlexSansKR_600SemiBold,
    IBMPlexSansKR_700Bold,
  });
  const ready = loaded || error !== null;

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;

  return (
    <FontsLoadedContext.Provider value={loaded}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      </SafeAreaProvider>
    </FontsLoadedContext.Provider>
  );
}
