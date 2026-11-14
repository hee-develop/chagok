import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { strings } from '../../i18n/ko';
import { Card, ErrorBlock, LoadingBlock, OutlineButton } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import type { ConnectionState } from './carConnection';

/** 차 연결 상태와 연결 화면으로 가는 버튼. 오늘 탭과 설정 탭이 같이 쓴다. */
export function ConnectionCard({ state, onRecheck }: { state: ConnectionState; onRecheck: () => void }) {
  const router = useRouter();
  const font = useFont();
  const t = strings.carConnection;
  return (
    <Card testID="car-connection">
      {state.status === 'checking' ? (
        <LoadingBlock label={t.checking} />
      ) : state.status === 'error' ? (
        <ErrorBlock message={t.checkFailed} retryLabel={t.retry} onRetry={onRecheck} />
      ) : (
        <>
          <Text style={[styles.title, font(600)]}>{state.status === 'connected' ? `✓ ${t.connected}` : t.notConnected}</Text>
          <Text style={[styles.hint, font(400)]}>{state.status === 'connected' ? t.connectedHint : t.notConnectedHint}</Text>
          <OutlineButton label={state.status === 'connected' ? t.openConnect : t.connect} onPress={() => router.push('/setup/pair-car')} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, color: colors.text },
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
});
