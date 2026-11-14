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
import { useNotifications } from '../features/notifications/useNotifications';
import { colors, FontsLoadedContext } from '../ui/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEventSync();
  useNotifications();
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
