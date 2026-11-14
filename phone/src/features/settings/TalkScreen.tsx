import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { defaultContactsSource, type ContactsSource } from '../contacts/contactsSource';
import { useContactsPermission } from '../contacts/useContactsPermission';
import { SettingSwitches } from './SettingSwitches';
import { settingsApi, type SettingsApi } from './settingsApi';
import { useSettings } from './useSettings';

type Props = {
  api?: SettingsApi;
  contactsSource?: ContactsSource;
  timeoutMs?: number;
  /** 늦을 때 연락을 켜고 연락처 권한 결정까지 끝난 뒤 부른다(일정을 다시 읽어 상대를 찾게 한다). */
  onLateContactChanged?: () => void;
};

const NEXT_ROUTE = '/setup/pair-car';

/**
 * 첫 설정 4단계 '말 거는 방법'(정책서 10.7): 플러스 모드와 늦을 때 연락. 스위치는 바꾸는 즉시 저장하고 [다음]·[건너뛰기]는 5단계(차 연결)로 간다.
 * 연결 전이면 서버가 이 기기의 연결 전 버킷에 저장했다가 차와 연결할 때 자리로 이어 준다. '늦을 때 연락'을 켜면 연락처 권한을 묻고(정책서 10.4),
 * 거부해도 기능은 켜 둔 채 '상대를 미리 찾지 않아요' 안내를 보인다. 설정을 읽지 못해도(오프라인) 건너뛰고 이어 갈 수 있다.
 */
export function TalkScreen({ api = settingsApi, contactsSource = defaultContactsSource, timeoutMs = REQUEST_TIMEOUT_MS, onLateContactChanged }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.talk;
  const contacts = useContactsPermission(contactsSource);
  const settings = useSettings({
    api,
    timeoutMs,
    onSaved: (key, value) => {
      if (key !== 'lateContact') return;
      // 켜면 연락처 권한을 묻는다(처음 한 번만 창이 뜬다). 묻는 동안 기다리지 않고, 끝나면 일정을 다시 읽게 알린다.
      void (value ? contacts.request() : Promise.resolve()).finally(() => onLateContactChanged?.());
    },
  });
  const busy = settings.savingKey !== null;

  return (
    <View testID="setup-talk" style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SetupHeader step={4} />
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.title, font(600)]}>{t.title}</Text>
          <Text style={[styles.description, font(400)]}>{t.description}</Text>
        </View>
        <SettingSwitches keys={['plusMode', 'lateContact']} settings={settings} contacts={contacts} />
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
          onPress={() => router.push(NEXT_ROUTE)} style={[styles.primary, busy && styles.disabled]}>
          <Text style={[styles.primaryText, font(600)]}>{t.next}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
          onPress={() => router.push(NEXT_ROUTE)} style={styles.later}>
          <Text style={[styles.secondaryText, font(400)]}>{t.skip}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 16, gap: 22 },
  titles: { gap: 10 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
  description: { fontSize: 16, lineHeight: 24, color: colors.textStrong },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  primary: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { backgroundColor: colors.primaryDisabled },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, color: colors.textMuted },
});
