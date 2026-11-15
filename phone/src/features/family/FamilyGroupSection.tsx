import { useState } from 'react';
import { Share, StyleSheet, Switch, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { Card, EmptyText, ErrorBlock, LoadingBlock, OutlineButton, Section } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { Field, Input, PrimaryButton, TextButton } from './formBlocks';
import type { FamilyView } from './familyGroupApi';
import type { GroupKind, useFamilyGroup } from './useFamilyGroup';

export type FamilyGroup = ReturnType<typeof useFamilyGroup>;

const t = strings.family;

/** 초대 코드 남은 시간(서버가 준 만료 시각 기준). 지났으면 null. */
export function remainingOf(expiresAt: string, now: Date): { hours: number; minutes: number } | null {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!(ms > 0)) return null;
  const totalMinutes = Math.max(1, Math.floor(ms / 60_000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** 저장이 실패했을 때의 한 줄(스크린리더가 바로 읽는다). 해당 동작의 구역에서만 보인다. */
function Issue({ group, kinds }: { group: FamilyGroup; kinds: readonly GroupKind[] }) {
  const font = useFont();
  if (!group.issue || !kinds.includes(group.issue.action)) return null;
  return <Text testID="family-issue" accessibilityLiveRegion="polite" style={[styles.issue, font(500)]}>{group.issue.message}</Text>;
}

/** 만들기·참여·초대 코드 응답이 느릴 때 '확인 중' 한 줄(끊지 않고 기다리며 같은 버튼은 막혀 있다). */
function SlowNotice({ group, kinds }: { group: FamilyGroup; kinds: readonly GroupKind[] }) {
  const font = useFont();
  if (!group.slow || group.action === null || !kinds.includes(group.action.kind)) return null;
  return <Text testID="family-slow" accessibilityLiveRegion="polite" style={[styles.hint, font(500)]}>{t.slowWait}</Text>;
}

/**
 * 가족이 없을 때(정책서 10.10 '가족 묶기'): [가족 만들기](부르는 이름 입력) / [초대 코드 넣기]. 로딩·오류·가족에서 나온 안내까지 이 구역이 맡는다.
 * 가족은 차와 따로 묶이므로 차 연결 상태와 상관없이 쓸 수 있다.
 */
export function GroupStartSection({ group }: { group: FamilyGroup }) {
  const font = useFont();
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [codeEmpty, setCodeEmpty] = useState(false);
  const { state } = group;

  return (
    <Section heading={t.groupHeading} testID="family-group">
      {state.status === 'loading' ? (
        <LoadingBlock label={t.loading} />
      ) : state.status === 'error' ? (
        <ErrorBlock message={t.loadFailed} retryLabel={t.retry} onRetry={group.retry} />
      ) : state.status === 'none' ? (
        <Card>
          {state.notice !== null ? (
            <Text testID="family-left-notice" accessibilityLiveRegion="polite" style={[styles.notice, font(600)]}>{state.notice === 'left' ? t.leftByMeNotice : t.leftNotice}</Text>
          ) : null}
          <Text style={[styles.text, font(400)]}>{t.groupIntro}</Text>
          <Field label={t.nameLabel} hint={t.nameHint}>
            <Input testID="family-name-input" accessibilityLabel={t.nameLabel} value={name} onChangeText={setName} maxLength={20} placeholder={t.namePlaceholder} editable={!group.busy} returnKeyType="done" />
          </Field>
          <View style={styles.row}>
            <PrimaryButton label={t.create} onPress={() => void group.create(name)} disabled={group.busy} testID="family-create" />
            <OutlineButton label={t.openJoin} onPress={() => setJoining((open) => !open)} disabled={group.busy} />
          </View>
          <Issue group={group} kinds={['create']} />
          {group.action?.kind === 'create' ? <LoadingBlock label={t.creating} /> : null}
          <SlowNotice group={group} kinds={['create', 'join']} />

          {joining ? (
            <View style={styles.join} testID="family-join">
              <Field label={t.codeLabel} hint={t.codeHint} error={codeEmpty ? t.joinCodeEmpty : undefined}>
                <Input testID="family-code-input" accessibilityLabel={t.codeLabel} value={code} onChangeText={(value) => { setCode(value); setCodeEmpty(false); }} autoCapitalize="characters" autoCorrect={false}
                  maxLength={12} placeholder={t.codePlaceholder} editable={!group.busy} invalid={codeEmpty} returnKeyType="done" />
              </Field>
              <View style={styles.row}>
                <PrimaryButton label={t.join} onPress={() => { if (code.trim() === '') setCodeEmpty(true); else void group.join(code, name); }} disabled={group.busy} testID="family-join-submit" />
                <TextButton label={t.cancel} onPress={() => { setJoining(false); setCode(''); setCodeEmpty(false); }} />
              </View>
              <Issue group={group} kinds={['join']} />
              {group.action?.kind === 'join' ? <LoadingBlock label={t.joining} /> : null}
            </View>
          ) : null}
        </Card>
      ) : null}
    </Section>
  );
}

/** 가족이 있을 때: 구성원 목록(나·부르는 이름·차 연결 여부), 초대 코드, 내 이름 바꾸기, 가족에서 나가기. */
export function GroupMembersSection({ family, group, now = () => new Date(), shareText = (message: string) => Share.share({ message }) }: {
  family: FamilyView;
  group: FamilyGroup;
  now?: () => Date;
  shareText?: (message: string) => Promise<unknown>;
}) {
  const font = useFont();
  // 손대지 않은 동안(null)은 서버의 내 이름을 그대로 보인다(이름이 바뀌어 돌아오면 따라간다).
  const [draft, setDraft] = useState<string | null>(null);
  const nameDraft = draft ?? family.me.name;
  const [nameEmpty, setNameEmpty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const remaining = family.invite ? remainingOf(family.invite.expiresAt, now()) : null;
  const full = family.members.length >= family.maxMembers;
  const busyKind = group.action?.kind ?? null;

  return (
    <Section heading={t.membersHeading} testID="family-members">
      <Card>
        {family.members.map((member) => (
          <View key={member.memberId} testID={`family-member-${member.memberId}`} accessible accessibilityLabel={t.memberLabel(member.name, member.isMe, member.connected)} style={styles.memberRow}>
            <Text style={[styles.memberName, font(600)]}>{member.name}{member.isMe ? ` (${t.memberMe})` : ''}</Text>
            <Text style={[styles.memberState, font(400)]}>{member.connected ? t.memberCarConnected : t.memberCarNotConnected}</Text>
          </View>
        ))}
        <Text style={[styles.hint, font(400)]}>{t.membersCount(family.members.length, family.maxMembers)}</Text>
      </Card>

      <Card testID="family-invite">
        <Text accessibilityRole="header" style={[styles.cardHeading, font(600)]}>{t.inviteHeading}</Text>
        {family.invite && remaining ? (
          <>
            <Text testID="family-invite-code" accessibilityLabel={t.inviteCodeLabel(family.invite.code)} style={[styles.code, font(700)]}>{family.invite.code}</Text>
            <Text testID="family-invite-remaining" style={[styles.text, font(400)]}>{t.inviteRemaining(remaining.hours, remaining.minutes)}</Text>
            <View style={styles.row}>
              <PrimaryButton label={t.inviteShare} onPress={() => void shareText(t.inviteShareMessage(family.invite!.code, t.inviteRemaining(remaining.hours, remaining.minutes))).catch(() => undefined)} testID="family-invite-share" />
              <OutlineButton label={t.inviteRemake} onPress={() => void group.remakeInvite()} disabled={group.busy || full} />
            </View>
            <Text style={[styles.hint, font(400)]}>{t.inviteRemakeHint}</Text>
          </>
        ) : (
          <>
            <Text style={[styles.text, font(400)]}>{family.invite ? t.inviteExpired : t.inviteNone}</Text>
            <OutlineButton label={t.inviteMake} onPress={() => void group.remakeInvite()} disabled={group.busy || full} />
          </>
        )}
        {full ? <Text style={[styles.hint, font(400)]}>{t.inviteFull}</Text> : null}
        <Issue group={group} kinds={['invite']} />
        {busyKind === 'invite' ? <LoadingBlock label={t.inviteMaking} /> : null}
        <SlowNotice group={group} kinds={['invite']} />
      </Card>

      <Card testID="family-rename">
        <Field label={t.renameLabel} error={nameEmpty ? t.renameEmpty : undefined}>
          <Input testID="family-rename-input" accessibilityLabel={t.renameLabel} value={nameDraft} onChangeText={(value) => { setDraft(value); setNameEmpty(false); }} maxLength={20} editable={!group.busy} invalid={nameEmpty} returnKeyType="done" />
        </Field>
        <OutlineButton label={t.rename} disabled={group.busy || nameDraft.trim() === family.me.name} onPress={() => { if (nameDraft.trim() === '') setNameEmpty(true); else void group.rename(nameDraft.trim()).then((ok) => { if (ok) setDraft(null); }); }} />
        <Issue group={group} kinds={['rename']} />
        {busyKind === 'rename' ? <LoadingBlock label={t.renaming} /> : null}
      </Card>

      <Card testID="family-leave">
        {confirmLeave ? (
          <View testID="family-leave-confirm" style={styles.join}>
            <Text accessibilityLiveRegion="polite" style={[styles.cardHeading, font(600)]}>{t.leaveConfirmQuestion}</Text>
            <Text style={[styles.text, font(400)]}>{t.leaveConfirmHint}</Text>
            <View style={styles.row}>
              <PrimaryButton label={t.leaveConfirm} accessibilityLabel={t.leaveConfirm} onPress={() => { setConfirmLeave(false); void group.leave(); }} disabled={group.busy} testID="family-leave-yes" />
              <TextButton label={t.cancel} onPress={() => setConfirmLeave(false)} />
            </View>
          </View>
        ) : (
          <OutlineButton label={t.leave} onPress={() => setConfirmLeave(true)} disabled={group.busy} />
        )}
        <Issue group={group} kinds={['leave']} />
        {busyKind === 'leave' ? <LoadingBlock label={t.leaving} /> : null}
      </Card>
    </Section>
  );
}

/** 도착 예정 공유(정책서 10.10): 가족 한 사람마다 켜고 끈다(기본 꺼짐). 켜면 그 사람이 보낸 약속·픽업 요청의 도착 예정과 운전 중 여부만 보인다. */
export function ShareSection({ family, group }: { family: FamilyView; group: FamilyGroup }) {
  const font = useFont();
  const others = family.members.filter((m) => !m.isMe);
  return (
    <Section heading={t.shareHeading} testID="family-share">
      <Card>
        <Text style={[styles.text, font(400)]}>{t.shareHint}</Text>
        {others.length === 0 ? <EmptyText>{t.shareEmpty}</EmptyText> : others.map((member) => {
          const saving = group.action?.kind === 'share' && group.action.memberId === member.memberId;
          return (
            <View key={member.memberId} testID={`family-share-${member.memberId}`} style={styles.shareRow}>
              <View style={styles.shareText}>
                <Text style={[styles.memberName, font(600)]}>{member.name}</Text>
                <Text style={[styles.memberState, font(500)]}>{saving ? t.shareSaving : member.shareWithThem ? t.shareOn : t.shareOff}</Text>
                {member.sharesWithMe ? <Text style={[styles.hint, font(400)]}>{t.shareTheyShare(member.name)}</Text> : null}
              </View>
              <Switch accessibilityLabel={t.shareLabel(member.name)} value={member.shareWithThem} disabled={group.busy}
                onValueChange={(enabled) => void group.setShare(member.memberId, enabled)}
                trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.card} />
            </View>
          );
        })}
        <Issue group={group} kinds={['share']} />
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  hint: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  notice: { fontSize: 15, lineHeight: 22, color: colors.warning },
  issue: { fontSize: 14, lineHeight: 21, color: colors.error },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  join: { gap: 12 },
  cardHeading: { fontSize: 16, lineHeight: 24, color: colors.text },
  code: { fontSize: 28, lineHeight: 36, letterSpacing: 2, color: colors.text },
  memberRow: { gap: 2 },
  memberName: { fontSize: 16, lineHeight: 22, color: colors.text },
  memberState: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 56 },
  shareText: { flex: 1, gap: 2 },
});
