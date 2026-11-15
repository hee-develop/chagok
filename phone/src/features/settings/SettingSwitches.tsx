import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { Card, ErrorBlock, LoadingBlock, OutlineButton } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import type { useContactsPermission } from '../contacts/useContactsPermission';
import { SettingSwitchRow } from './SettingSwitchRow';
import type { SettingKey } from './settingsApi';
import type { useSettings } from './useSettings';

type Props = {
  /** 보일 스위치와 순서. */
  keys: readonly SettingKey[];
  settings: ReturnType<typeof useSettings>;
  contacts: ReturnType<typeof useContactsPermission>;
};

/**
 * 설정 스위치 묶음(플러스 모드·늦을 때 연락·화면 없이 음성만). 설정 탭과 첫 설정 '말 거는 방법' 단계가 같이 쓴다.
 * 상태: 로딩·오류([다시 시도], 오프라인도 여기)·정상. 저장 실패는 스위치를 되돌리고 문구를 보인다. 권한 거부는 '늦을 때 연락'이 켜져 있을 때의 연락처 안내다.
 */
export function SettingSwitches({ keys, settings, contacts }: Props) {
  const font = useFont();
  const t = strings.settings;
  const { state, savingKey, issue, toggle } = settings;

  if (state.status === 'loading') return <Card testID="settings-switches"><LoadingBlock label={t.loading} /></Card>;
  if (state.status === 'error') {
    return <Card testID="settings-switches"><ErrorBlock message={t.loadFailed} retryLabel={t.retry} onRetry={settings.reload} /></Card>;
  }
  const { values } = state;
  const busy = savingKey !== null;
  // 연락처 권한이 없을 때만 안내한다. 아직 모르면(null) 보이지 않는다.
  const contactsNotice = values.lateContact && (contacts.permission === 'ask' || contacts.permission === 'denied');

  const rows: Record<SettingKey, { label: string; hintOn: string; hintOff: string; extra?: ReactNode }> = {
    plusMode: { label: t.plus.label, hintOn: t.plus.hintOn, hintOff: t.plus.hintOff },
    lateContact: {
      label: t.late.label,
      hintOn: t.late.hintOn,
      hintOff: t.late.hintOff,
      extra: (
        <View style={styles.extra}>
          <Text testID="late-contact-sms-note" style={[styles.note, font(400)]}>{t.late.smsNote}</Text>
          {contactsNotice ? (
            <View testID="late-contact-permission-notice" accessibilityLiveRegion="polite" style={styles.notice}>
              <Text style={[styles.noticeText, font(500)]}>{t.late.contactsOff}</Text>
              {contacts.permission === 'ask'
                ? <OutlineButton label={t.late.turnOnContacts} onPress={() => void contacts.request()} />
                : <OutlineButton label={t.late.openSettings} onPress={contacts.openSettings} />}
            </View>
          ) : null}
        </View>
      ),
    },
    voiceOnly: { label: t.voiceOnly.label, hintOn: t.voiceOnly.hintOn, hintOff: t.voiceOnly.hintOff },
  };

  return (
    <Card testID="settings-switches">
      {keys.map((key) => {
        const row = rows[key];
        return (
          <SettingSwitchRow key={key} testID={`switch-${key}`} label={row.label} hint={values[key] ? row.hintOn : row.hintOff}
            value={values[key]} disabled={busy} onChange={(next) => void toggle(key, next)}>
            {row.extra}
            {issue?.key === key ? <Text testID={`switch-${key}-issue`} accessibilityLiveRegion="polite" style={[styles.error, font(500)]}>{t.saveFailed}</Text> : null}
          </SettingSwitchRow>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  extra: { gap: 8 },
  note: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  notice: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.notice },
  noticeText: { fontSize: 14, lineHeight: 21, color: colors.text },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
});
