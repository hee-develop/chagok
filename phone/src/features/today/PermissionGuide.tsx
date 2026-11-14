import { StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { OutlineButton } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import type { PermissionMap, PermissionName } from './permissions';

type Props = {
  map: PermissionMap;
  /** 보여 줄 권한. 줄 순서도 이 순서다. */
  names: readonly PermissionName[];
  /** true면 켜진 권한도 '켜져 있어요'로 보인다(설정 탭). false면 꺼진 것만 보인다(오늘 탭). */
  showGranted?: boolean;
  onRequest: (name: PermissionName) => void;
  onOpenSettings: () => void;
};

const NAME: Record<PermissionName, string> = { calendar: strings.permissions.calendarName, camera: strings.permissions.cameraName, notifications: strings.permissions.notificationsName };
const HINT: Record<PermissionName, string> = { calendar: strings.permissions.calendar, camera: strings.permissions.camera, notifications: strings.permissions.notifications };

/** 권한 하나당 한 줄: 켜면 되는 일을 말하고, 아직 물을 수 있으면 [켜기], 아니면 [설정 열기]. */
export function PermissionGuide({ map, names, showGranted = false, onRequest, onOpenSettings }: Props) {
  const font = useFont();
  const t = strings.permissions;
  const rows = names.filter((name) => showGranted || map[name] !== 'granted');
  return (
    <>
      {rows.map((name) => (
        <View key={name} testID={`permission-${name}`} style={styles.row}>
          <View style={styles.text}>
            {showGranted ? <Text style={[styles.name, font(600)]}>{NAME[name]}</Text> : null}
            <Text style={[styles.hint, font(400)]}>{map[name] === 'granted' ? `✓ ${t.granted}` : HINT[name]}</Text>
          </View>
          {map[name] === 'ask' ? (
            <OutlineButton label={t.on} accessibilityLabel={t.turnOnLabel(NAME[name])} onPress={() => onRequest(name)} />
          ) : map[name] === 'denied' ? (
            <OutlineButton label={t.openSettings} accessibilityLabel={t.openSettingsLabel(NAME[name])} onPress={onOpenSettings} />
          ) : null}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10 },
  text: { gap: 2 },
  name: { fontSize: 16, color: colors.text },
  hint: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
});
