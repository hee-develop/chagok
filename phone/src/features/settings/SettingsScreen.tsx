import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, ErrorBlock, LoadingBlock, OutlineButton, Section } from '../../ui/blocks';
import { TabScreen } from '../../ui/TabScreen';
import { colors, useFont } from '../../ui/theme';
import { carConnectionSource, useCarConnection, type CarConnectionSource } from '../today/carConnection';
import { ConnectionCard } from '../today/ConnectionCard';
import { devicePermissions, usePermissions, type PermissionsSource } from '../today/permissions';
import { PermissionGuide } from '../today/PermissionGuide';

type Props = { connectionSource?: CarConnectionSource; permissionsSource?: PermissionsSource; timeoutMs?: number };

/**
 * 설정 탭: 주행 중 고정 안내, 차 연결 입구, 캘린더 고르기 입구, 권한 상태.
 * 스위치(플러스 모드·늦을 때 연락·음성만)는 다음 묶음(J5b)이다. '캘린더에 장소 적기'는 만들지 않기로 했다.
 * 상태: 연결·권한 구역이 각각 로딩·오류(다시 시도)·정상이고, 꺼진 권한은 켜기·설정 열기로 이어진다. 빈 상태는 해당 없음.
 */
export function SettingsScreen({ connectionSource = carConnectionSource, permissionsSource = devicePermissions, timeoutMs = REQUEST_TIMEOUT_MS }: Props) {
  const router = useRouter();
  const font = useFont();
  const t = strings.settings;
  const connection = useCarConnection({ source: connectionSource, timeoutMs });
  const permissions = usePermissions(permissionsSource);

  return (
    <TabScreen title={t.title} testID="tab-settings">
      <Card testID="driving-notice">
        <Text style={[styles.notice, font(600)]}>{t.drivingNotice}</Text>
      </Card>

      <Section heading={t.carHeading}>
        <ConnectionCard state={connection.state} onRecheck={connection.recheck} />
      </Section>

      <Section heading={t.calendarHeading}>
        <Card>
          <Text style={[styles.hint, font(400)]}>{t.calendarHint}</Text>
          <OutlineButton label={t.pickCalendar} onPress={() => router.push('/setup/calendar')} />
        </Card>
      </Section>

      <Section heading={t.permissionHeading} testID="settings-permissions">
        <Card>
          {permissions.state.status === 'loading' ? (
            <LoadingBlock label={t.permissionLoading} />
          ) : permissions.state.status === 'error' ? (
            <ErrorBlock message={strings.permissions.checkFailed} retryLabel={strings.permissions.retry} onRetry={() => void permissions.refresh()} />
          ) : (
            <PermissionGuide map={permissions.state.map} names={['calendar', 'camera']} showGranted
              onRequest={(name) => void permissions.request(name)} onOpenSettings={permissions.openSettings} />
          )}
        </Card>
      </Section>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  notice: { fontSize: 16, lineHeight: 24, color: colors.text },
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
});
