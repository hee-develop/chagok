import { Pressable, StyleSheet, Text } from 'react-native';

import { strings } from '../../i18n/ko';
import { Section } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { appInbox, useInbox, type Inbox } from '../notifications/inbox';
import { handleNotificationTap } from '../notifications/taps';

/**
 * 오늘 탭 맨 위의 폰 알림함: **읽지 않은** 알림 줄(정책서 10.4 '거부하면 알림은 홈에만 보인다'). 줄을 누르면 종류별 처리(`handleNotificationTap`)를 하고 읽음이 되어 줄이 사라진다.
 * 읽지 않은 알림이 없으면(알림함이 비었거나 모두 읽음) 아무것도 그리지 않는다.
 */
export function InboxSection({ inbox = appInbox }: { inbox?: Inbox }) {
  const font = useFont();
  const t = strings.inbox;
  const { loaded, items, markAllRead } = useInbox(inbox);
  const unread = items.filter((item) => !item.read);
  if (!loaded || unread.length === 0) return null;
  return (
    <Section heading={t.heading} testID="inbox">
      {unread.map((item) => (
        <Pressable key={item.id} testID={`inbox-${item.id}`} accessibilityRole="button" accessibilityLabel={`${item.title} ${item.body}`}
          accessibilityHint={t.hint} onPress={() => void handleNotificationTap({ id: item.id, kind: item.kind, data: item.data }, inbox)} style={styles.row}>
          <Text style={[styles.title, font(600)]}>{item.title}</Text>
          <Text style={[styles.body, font(400)]}>{item.body}</Text>
        </Pressable>
      ))}
      {unread.length > 1 ? (
        <Pressable accessibilityRole="button" onPress={markAllRead} style={styles.all}>
          <Text style={[styles.allText, font(600)]}>{t.markAllRead}</Text>
        </Pressable>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.text, gap: 4 },
  title: { fontSize: 16, lineHeight: 22, color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  all: { minHeight: 44, paddingHorizontal: 12, alignSelf: 'flex-end', alignItems: 'center', justifyContent: 'center' },
  allText: { fontSize: 15, color: colors.textMuted },
});
