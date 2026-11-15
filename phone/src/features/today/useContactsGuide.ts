import { REQUEST_TIMEOUT_MS } from '../../api/request';
import { defaultContactsSource, type ContactsSource } from '../contacts/contactsSource';
import { useContactsPermission } from '../contacts/useContactsPermission';
import { settingsApi as defaultSettingsApi, type SettingsApi } from '../settings/settingsApi';
import { useSettings } from '../settings/useSettings';

/**
 * 홈 맨 위의 연락처 안내(정책서 10.4 '거부한 권한은 홈 맨 위에 켜면 이게 돼요 한 줄로 남긴다').
 * **'늦을 때 연락'이 켜져 있고 연락처 권한을 거부했을 때만** 보인다(꺼 두면 연락처가 필요 없으니 안내하지 않는다).
 * 아직 한 번도 묻지 않았거나(`ask`) 설정을 읽는 중·못 읽은 동안에는 보이지 않는다(카메라 안내와 같은 규칙). 설정 탭의 같은 줄은 권한 요청 버튼까지 둔다.
 */
export function useContactsGuide({
  settingsApi = defaultSettingsApi,
  contactsSource = defaultContactsSource,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: { settingsApi?: SettingsApi; contactsSource?: ContactsSource; timeoutMs?: number } = {}) {
  const settings = useSettings({ api: settingsApi, timeoutMs });
  const contacts = useContactsPermission(contactsSource);
  const show = settings.state.status === 'ready' && settings.state.values.lateContact && contacts.permission === 'denied';
  return { show, openSettings: contacts.openSettings };
}
