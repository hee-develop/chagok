import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HttpError, isClientError, REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { colors, useFont } from '../../ui/theme';
import { codeFromScan, digitsOnly } from './pairCode';
import { pairingApi, type PairingApi } from './pairingApi';

type Props = {
  api?: PairingApi;
  timeoutMs?: number;
  /** 주면 연결하기 전에도 누를 수 있는 [건너뛰기]를 보이고 누르면 부른다(없으면 버튼이 없다). */
  onSkip?: () => void;
  /** 주면 연결된 뒤 [완료]가 기본 이동(3단계 일정 목록) 대신 이것을 부른다. */
  onDone?: () => void;
  /** 첫 설정 밖(오늘·설정 탭의 [차 연결하기])에서 열렸다: 단계 표시('4 / 4')를 빼고, [완료]는 되돌아간다(`onDone`이 있으면 그것). */
  standalone?: boolean;
  /** 연결에 성공한 순간 한 번 부른다(알림 권한을 묻는 자리 등). */
  onPaired?: () => void;
};

type Issue = 'invalidCode' | 'failed' | 'cameraDenied' | 'notChagokQr' | 'seatLimit' | 'locked';

/** 서버 응답 상태로 안내 문구를 고른다. 409(차에 폰이 가득)·429(코드를 너무 많이 틀림)는 번호를 다시 넣는 문제가 아니라 따로 안내한다. */
const issueOf = (error: unknown): Issue => {
  if (error instanceof HttpError && error.status === 409) return 'seatLimit';
  if (error instanceof HttpError && error.status === 429) return 'locked';
  return isClientError(error) ? 'invalidCode' : 'failed';
};

/**
 * 첫 설정 4단계: 차 화면의 QR을 찍거나 숫자 6자리를 넣어 차와 연결한다. 서버가 그 코드의 차를 이 사용자에게 묶으면
 * 차가 2초 안에 알아채 연결 카드를 접고, 방금 넣은 일정·장소·채비로 탑승 브리핑을 한다(계약: docs/pairing.md).
 */
export function PairCarScreen({ api = pairingApi, timeoutMs = REQUEST_TIMEOUT_MS, onSkip, onDone, standalone = false, onPaired }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const t = strings.pairCar;

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [paired, setPaired] = useState(false);
  const [issue, setIssue] = useState<Issue | null>(null);
  const request = useRef<AbortController | null>(null);
  /** 마지막으로 보낸 번호. [다시 시도]가 같은 번호를 다시 보낸다. */
  const lastCode = useRef<string | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (issue) AccessibilityInfo.announceForAccessibility(t[issue]);
  }, [issue, t]);

  const claim = async (value: string) => {
    if (request.current || paired) return;
    const controller = new AbortController();
    request.current = controller;
    lastCode.current = value;
    setClaiming(true);
    setIssue(null);
    try {
      await requestWithTimeout((signal) => api.claim(value, signal), timeoutMs, controller);
      if (request.current !== controller) return;
      setPaired(true);
      onPaired?.();
      AccessibilityInfo.announceForAccessibility(t.paired);
    } catch (error) {
      // 404 같은 4xx는 없거나 만료된 번호라 같은 번호로 다시 보내도 같다. 차 화면의 새 번호를 받게 한다.
      if (request.current === controller) setIssue(issueOf(error));
    } finally {
      if (request.current === controller) request.current = null;
      setClaiming(false);
    }
  };

  const openCamera = async () => {
    setIssue(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (granted) setScanning(true);
    else setIssue('cameraDenied');
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (!scanning || request.current) return;
    const scanned = codeFromScan(data);
    if (!scanned) {
      setIssue('notChagokQr');
      return;
    }
    setScanning(false);
    void claim(scanned);
  };

  const ready = code.length === 6 && !claiming;
  const done = () => {
    if (onDone) onDone();
    else if (!standalone) router.replace('/setup/fill-places');
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SetupHeader step={standalone ? undefined : 4} />
        {paired ? (
          <View style={styles.titles} accessibilityLiveRegion="polite">
            <Text accessibilityRole="header" style={[styles.title, font(600)]}>{`✓ ${t.paired}`}</Text>
            <Text style={[styles.description, font(400)]}>{t.pairedDescription}</Text>
          </View>
        ) : (
          <>
            <View style={styles.titles}>
              <Text accessibilityRole="header" style={[styles.title, font(600)]}>{t.title}</Text>
              <Text style={[styles.description, font(400)]}>{t.description}</Text>
            </View>

            {scanning ? (
              <View style={styles.cameraWrap}>
                <CameraView
                  testID="pair-camera"
                  accessibilityLabel={t.cameraLabel}
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={onScanned}
                />
                <Pressable accessibilityRole="button" onPress={() => setScanning(false)} style={styles.textButton}>
                  <Text style={[styles.textButtonLabel, font(600)]}>{t.closeCamera}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: claiming }} disabled={claiming}
                onPress={() => void openCamera()} style={[styles.outline, claiming && styles.disabled]}>
                <Text style={[styles.outlineText, font(600)]}>{t.scan}</Text>
              </Pressable>
            )}

            <View style={styles.codeBlock}>
              <Text style={[styles.label, font(500)]}>{t.codeLabel}</Text>
              <TextInput
                testID="pair-code-input"
                accessibilityLabel={t.codeLabel}
                // 입력값을 다시 넣지 않는다(비제어). 숫자만 걸러 value로 되돌리면 빠르게 칠 때 커서가 튀어 숫자 순서가 바뀐다.
                onChangeText={(text) => {
                  setCode(digitsOnly(text));
                  if (issue === 'invalidCode') setIssue(null);
                }}
                editable={!claiming}
                keyboardType="number-pad"
                placeholder={t.codePlaceholder}
                placeholderTextColor={colors.unchecked}
                style={[styles.input, font(600)]}
              />
            </View>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        {claiming ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t.connecting}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}
        {issue ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Text style={[styles.error, font(500)]}>{t[issue]}</Text>
            {issue === 'failed' ? (
              <Pressable accessibilityRole="button" onPress={() => lastCode.current && void claim(lastCode.current)} style={styles.textButton}>
                <Text style={[styles.textButtonLabel, font(600)]}>{t.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {paired ? (
          <Pressable accessibilityRole="button" onPress={done} style={styles.primary}>
            <Text style={[styles.primaryText, font(600)]}>{t.done}</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready}
            onPress={() => void claim(code)} style={[styles.primary, !ready && styles.disabled]}>
            <Text style={[styles.primaryText, font(600)]}>{t.connect}</Text>
          </Pressable>
        )}
        {onSkip && !paired ? (
          <Pressable accessibilityRole="button" onPress={onSkip} style={styles.textButton}>
            <Text style={[styles.textButtonLabel, font(600)]}>{t.skip}</Text>
          </Pressable>
        ) : null}
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
  cameraWrap: { gap: 8 },
  camera: { height: 280, borderRadius: 16, overflow: 'hidden' },
  outline: { minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  outlineText: { fontSize: 17, color: colors.text },
  codeBlock: { gap: 8 },
  label: { fontSize: 15, color: colors.textStrong },
  input: {
    height: 64, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    paddingHorizontal: 16, paddingVertical: 0, fontSize: 28, letterSpacing: 6, color: colors.text, textAlign: 'center', textAlignVertical: 'center',
  },
  status: { minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4 },
  error: { fontSize: 14, lineHeight: 21, color: colors.error, textAlign: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { fontSize: 15, color: colors.textMuted },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  primary: { height: 56, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, color: colors.onPrimary },
  disabled: { opacity: 0.4 },
});
