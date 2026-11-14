import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { strings } from '../../i18n/ko';
import { Card, ErrorBlock, LoadingBlock, OutlineButton, Section } from '../../ui/blocks';
import { TabScreen } from '../../ui/TabScreen';
import { colors, useFont } from '../../ui/theme';
import { defaultContactsSource, type ContactsSource } from '../contacts/contactsSource';
import { useContactsPermission } from '../contacts/useContactsPermission';
import type { PairingApi } from '../pair-car/pairingApi';
import { carConnectionSource, useCarConnection, type CarConnectionSource } from '../today/carConnection';
import { ConnectionCard } from '../today/ConnectionCard';
import { devicePermissions, usePermissions, type PermissionsSource } from '../today/permissions';
import { PermissionGuide } from '../today/PermissionGuide';
import { DisconnectSection } from './DisconnectSection';
import { SettingSwitches } from './SettingSwitches';
import { settingsApi, type SettingsApi } from './settingsApi';
import { useSettings } from './useSettings';

type Props = {
  connectionSource?: CarConnectionSource;
  permissionsSource?: PermissionsSource;
  settingsApi?: SettingsApi;
  /** 차 연결 끊기에 쓰는 API(`pairingApi.disconnect`). */
  pairing?: Pick<PairingApi, 'disconnect'>;
  contactsSource?: ContactsSource;
  timeoutMs?: number;
  /** 늦을 때 연락을 켜거나 끄고 연락처 권한 결정까지 끝난 뒤 부른다(일정을 다시 읽어 상대를 찾게 한다). */
  onLateContactChanged?: () => void;
};

/**
 * 설정 탭(정책서 10.8): 기본 말 걸기(끌 수 없는 고정 안내), 플러스 모드·늦을 때 연락·화면 없이 음성만 스위치, 차 연결(상태·끊기), 캘린더 고르기,
 * 장소 탭으로 가는 입구(자주 가는 곳·기억한 장소·이동 없음 목록), 권한 상태. '캘린더에 장소 적기'는 만들지 않기로 했다.
 * 상태: 스위치·연결·권한 구역이 각각 로딩·오류(다시 시도·다시 확인)·정상이고, 꺼진 권한은 켜기·설정 열기로 이어진다. 연락처 권한을 거부하면 '늦을 때 연락'은 켜 둔 채
 * 안내만 보인다. 빈 상태는 해당 없음.
 */
export function SettingsScreen({
  connectionSource = carConnectionSource,
  permissionsSource = devicePermissions,
  settingsApi: settingsClient = settingsApi,
  pairing,
  contactsSource = defaultContactsSource,
  timeoutMs = REQUEST_TIMEOUT_MS,
  onLateContactChanged,
}: Props) {
  const router = useRouter();
  const font = useFont();
  const t = strings.settings;
  const connection = useCarConnection({ source: connectionSource, timeoutMs });
  const permissions = usePermissions(permissionsSource);
  const contacts = useContactsPermission(contactsSource);
  const settings = useSettings({
    api: settingsClient,
    timeoutMs,
    onSaved: (key, value) => {
      if (key !== 'lateContact') return;
      // 켜면 연락처 권한을 묻는다(처음 한 번만 창이 뜬다). 끝나면 일정을 다시 읽어 상대를 찾거나(켠 경우) 지우게(끈 경우) 알린다.
      void (value ? contacts.request() : Promise.resolve()).finally(() => onLateContactChanged?.());
    },
  });
  const openPlaces = () => router.navigate('/places');
  const entrances = [
    { key: 'frequent', ...t.frequent },
    { key: 'remembered', ...t.remembered },
    { key: 'noTravel', ...t.noTravel },
  ] as const;

  return (
    <TabScreen title={t.title} testID="tab-settings">
      <Card testID="driving-notice">
        <Text style={[styles.label, font(600)]}>{`${t.drivingHeading} · ${t.drivingOn}`}</Text>
        <Text style={[styles.notice, font(600)]}>{t.drivingNotice}</Text>
      </Card>

      <Section heading={t.talkHeading}>
        <SettingSwitches keys={['plusMode', 'lateContact', 'voiceOnly']} settings={settings} contacts={contacts} />
      </Section>

      <Section heading={t.carHeading}>
        <ConnectionCard state={connection.state} onRecheck={connection.recheck} />
        {connection.state.status === 'connected' ? (
          <Card>
            <DisconnectSection api={pairing} timeoutMs={timeoutMs} onDisconnected={() => { connection.recheck(); settings.reload(); }} />
          </Card>
        ) : null}
      </Section>

      <Section heading={t.calendarHeading}>
        <Card>
          <Text style={[styles.hint, font(400)]}>{t.calendarHint}</Text>
          <OutlineButton label={t.pickCalendar} onPress={() => router.push({ pathname: '/setup/calendar', params: { from: 'tab' } })} />
        </Card>
      </Section>

      <Section heading={t.placesHeading} testID="settings-places">
        <Card>
          {entrances.map((entrance, index) => (
            <View key={entrance.key} testID={`settings-places-${entrance.key}`} style={[styles.entrance, index > 0 && styles.entranceBorder]}>
              <View style={styles.entranceText}>
                <Text style={[styles.label, font(600)]}>{entrance.label}</Text>
                <Text style={[styles.hint, font(400)]}>{entrance.hint}</Text>
              </View>
              <OutlineButton label={t.openPlacesTab} accessibilityLabel={entrance.open} onPress={openPlaces} />
            </View>
          ))}
        </Card>
      </Section>

      <Section heading={t.permissionHeading} testID="settings-permissions">
        <Card>
          {permissions.state.status === 'loading' ? (
            <LoadingBlock label={t.permissionLoading} />
          ) : permissions.state.status === 'error' ? (
            <ErrorBlock message={strings.permissions.checkFailed} retryLabel={strings.permissions.retry} onRetry={() => void permissions.refresh()} />
          ) : (
            <PermissionGuide map={permissions.state.map} names={['calendar', 'camera', 'notifications']} showGranted
              onRequest={(name) => void permissions.request(name)} onOpenSettings={permissions.openSettings} />
          )}
        </Card>
      </Section>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 17, lineHeight: 24, color: colors.text },
  notice: { fontSize: 16, lineHeight: 24, color: colors.text },
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  entrance: { gap: 8 },
  entranceBorder: { paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  entranceText: { gap: 2 },
});
