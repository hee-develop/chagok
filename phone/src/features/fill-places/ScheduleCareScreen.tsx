import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { schedulePlacesApi, type SchedulePlacesApi } from './schedulePlacesApi';

/** 서버 채비 길이 상한과 같다(server/src/limits.ts MAX_CARE_LENGTH). */
const MAX_CARE_LENGTH = 100;

type Props = {
  scheduleId: string;
  /** 화면 제목에 쓰는 일정 제목 */
  title: string;
  /** 이미 적어 둔 채비. 없으면 빈 글 */
  initialCare: string;
  api?: SchedulePlacesApi;
  timeoutMs?: number;
};

/**
 * 일정 하나에 채비 한 줄을 적는다. 차곡 서버에만 저장하고 캘린더는 건드리지 않는다.
 * 저장하면 일정 목록으로 돌아가고, 목록은 다시 열릴 때 서버에서 새로 읽는다.
 */
export function ScheduleCareScreen({ scheduleId, title, initialCare, api = schedulePlacesApi, timeoutMs = REQUEST_TIMEOUT_MS }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.scheduleCare;

  const [text, setText] = useState(initialCare);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<'retry' | 'reload' | null>(null);
  const request = useRef<AbortController | null>(null);
  const retryLast = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (issue) AccessibilityInfo.announceForAccessibility(issue === 'reload' ? t.scheduleChanged : t.saveFailed);
  }, [issue, t.saveFailed, t.scheduleChanged]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/setup/fill-places');
  }, [router]);

  const save = async (care: string | null) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    retryLast.current = () => void save(care);
    setSaving(true);
    setIssue(null);
    try {
      await requestWithTimeout((signal) => api.saveCare(scheduleId, care, signal), timeoutMs, controller);
      if (request.current === controller) {
        request.current = null;
        goBack();
      }
    } catch (error) {
      // 4xx는 일정이 사라졌거나 선택이 바뀐 것이라 다시 시도해도 같다. 목록으로 돌려보낸다.
      if (request.current === controller) setIssue(isClientError(error) ? 'reload' : 'retry');
    } finally {
      if (request.current === controller) request.current = null;
      setSaving(false);
    }
  };

  const trimmed = text.trim();
  const unchanged = trimmed === initialCare.trim();
  const hadCare = initialCare.trim() !== '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SetupHeader step={3} />
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.title, font(600)]}>{t.title(title)}</Text>
          <Text style={[styles.description, font(400)]}>{t.description}</Text>
        </View>
        <TextInput
          accessibilityLabel={t.inputLabel}
          autoFocus
          editable={!saving}
          maxLength={MAX_CARE_LENGTH}
          onChangeText={(value) => {
            setIssue(null);
            setText(value);
          }}
          onSubmitEditing={() => { if (!unchanged) void save(trimmed === '' ? null : trimmed); }}
          placeholder={t.placeholder}
          placeholderTextColor={colors.unchecked}
          returnKeyType="done"
          style={[styles.input, font(400)]}
          value={text}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {saving ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t.saving} style={styles.status}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}
        {issue ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Text style={[styles.error, font(500)]}>{issue === 'reload' ? t.scheduleChanged : t.saveFailed}</Text>
            <Pressable accessibilityRole="button" onPress={() => (issue === 'reload' ? goBack() : retryLast.current?.())} style={styles.textButton}>
              <Text style={[styles.textButtonLabel, font(600)]}>{issue === 'reload' ? t.backToSchedules : t.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || unchanged }}
          disabled={saving || unchanged}
          onPress={() => void save(trimmed === '' ? null : trimmed)}
          style={[styles.primary, (saving || unchanged) && styles.disabled]}
        >
          <Text style={[styles.primaryText, font(600)]}>{t.save}</Text>
        </Pressable>
        {hadCare ? (
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save(null)} style={styles.textButton}>
            <Text style={[styles.textButtonLabel, font(400)]}>{t.clear}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={goBack} style={styles.cancel}>
          <Text style={[styles.cancelText, font(400)]}>{t.cancel}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 16, gap: 22 },
  titles: { gap: 10 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
  description: { fontSize: 16, lineHeight: 24, color: colors.textStrong },
  input: { height: 50, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, fontSize: 16, color: colors.text },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  status: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  error: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted },
  primary: { height: 56, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  disabled: { opacity: 0.4 },
  cancel: { height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, color: colors.textMuted },
});
