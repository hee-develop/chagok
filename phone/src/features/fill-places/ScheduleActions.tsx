import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../../i18n/ko';
import { colors, useFont } from '../../ui/theme';
import type { SchedulePlaceChange, SetupSchedule } from './schedulePlacesApi';

type Suggestion = NonNullable<SetupSchedule['suggestion']>;

/**
 * '여기 맞아요'로 저장할 내용. 목 장소 후보는 id로, 지난번 기억(애매해서 확인이 필요한 장소)은 서버가 내려준 장소 스냅숏으로 저장한다.
 */
export function confirmChange(suggestion: Suggestion): SchedulePlaceChange {
  if (suggestion.placeId !== null) return { placeId: suggestion.placeId };
  if ('place' in suggestion) {
    const { name, address, lat, lng } = suggestion.place;
    return { place: { name, address: address ?? undefined, lat, lng } };
  }
  return { placeId: null };
}

/** 일정 하나를 다루는 화면들(장소 검색·채비·가족 보내기). */
type ScheduleRoute = '/setup/schedule-place-search' | '/setup/schedule-care' | '/setup/family-send';

type Props = {
  schedule: SetupSchedule;
  /** 저장 중이면 모든 버튼을 막는다(저장은 한 번에 하나). */
  saving: boolean;
  onSave: (id: string, change: SchedulePlaceChange) => void;
  /** 장소·채비·가족 화면으로 가기 전에 부른다(이전 저장 오류 문구를 지우는 자리). */
  onNavigate?: () => void;
  /** 어디서 열었는가. 'today'면 열린 화면이 첫 설정 단계 표시 없이 열리고 닫으면 이 자리로 돌아온다. */
  origin?: 'setup' | 'today';
};

/**
 * 일정 하나의 장소 보정·채비·가족에게 보내기 줄. 첫 설정 3단계 카드와 오늘 탭의 펼친 일정이 같이 쓴다.
 * 온라인 회의·회의실이라 저절로 거른 일정도 장소를 넣으면 다시 차로 간다.
 */
export function ScheduleActions({ schedule, saving, onSave, onNavigate, origin = 'setup' }: Props) {
  const router = useRouter();
  const font = useFont();
  const t = strings.fillPlaces;
  const from = origin === 'today' ? { from: 'today' } : {};
  const go = (pathname: ScheduleRoute, params: Record<string, string>) => {
    onNavigate?.();
    router.push({ pathname, params: { ...params, ...from } });
  };

  return (
    <View style={styles.wrap}>
      {!schedule.place && !schedule.noTravel && schedule.suggestion ? (
        <View style={styles.remembered}>
          <View style={styles.rememberedText}>
            <Text style={[styles.rememberedHint, font(400)]}>{t.rememberedHint(schedule.title)}</Text>
            <Text style={[styles.rememberedName, font(600)]}>{schedule.suggestion.name}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.rememberedConfirm}`}
            accessibilityState={{ disabled: saving }} disabled={saving} style={styles.confirm}
            onPress={() => onSave(schedule.id, confirmChange(schedule.suggestion!))}>
            <Text style={[styles.confirmText, font(600)]}>{t.rememberedConfirm}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.actions}>
        {schedule.place || schedule.noTravel ? <>
          <Text style={[styles.place, font(500)]}>{schedule.noTravel
            ? `✓ ${t.noTravel}${schedule.noTravelReason ? ` · ${t.noTravelReason[schedule.noTravelReason]}` : ''}`
            : `✓ ${schedule.place!.name}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.change}`}
            accessibilityState={{ disabled: saving }} disabled={saving} style={styles.textButton}
            onPress={() => go('/setup/schedule-place-search', { scheduleId: schedule.id })}>
            <Text style={[styles.secondaryText, font(400)]}>{t.change}</Text>
          </Pressable>
        </> : <>
          <Text style={[styles.missing, font(400)]}>{t.missing}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.noTravel}`} accessibilityState={{ disabled: saving }}
            disabled={saving} onPress={() => onSave(schedule.id, { noTravel: true })} style={styles.textButton}>
            <Text style={[styles.secondaryText, font(400)]}>{t.noTravel}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.add}`}
            accessibilityState={{ disabled: saving }} disabled={saving} style={styles.outline}
            onPress={() => go('/setup/schedule-place-search', { scheduleId: schedule.id })}>
            <Text style={[styles.buttonText, font(600)]}>{t.add}</Text>
          </Pressable>
        </>}
      </View>
      {schedule.noTravel ? null : (
        // 채비는 차로 가는 일정에만 둔다. 차는 앱 채비를 메모보다 먼저 읽는다.
        <View style={styles.careRow}>
          <Text style={[styles.care, font(400)]} numberOfLines={2}>{schedule.care ? `${t.careLabel} · ${schedule.care}` : ''}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${schedule.care ? t.careEdit : t.careAdd}`}
            accessibilityState={{ disabled: saving }} disabled={saving} style={styles.textButton}
            onPress={() => go('/setup/schedule-care', { scheduleId: schedule.id, title: schedule.title, care: schedule.care ?? '' })}>
            <Text style={[styles.secondaryText, font(400)]}>{schedule.care ? t.careEdit : t.careAdd}</Text>
          </Pressable>
        </View>
      )}
      {schedule.noTravel ? null : (
        // 가족에게 보내기. 보낸 가족이 있으면 '엄마에게 전달됨'처럼 보인다(받는 쪽은 아직 프로토타입).
        <View style={styles.careRow}>
          <Text style={[styles.care, font(400)]} numberOfLines={2}>
            {schedule.familyRequests.length > 0 ? t.familyDelivered(schedule.familyRequests.map((r) => r.name).join(', ')) : ''}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${schedule.title} ${t.familySend}`}
            accessibilityState={{ disabled: saving }} disabled={saving} style={styles.textButton}
            onPress={() => go('/setup/family-send', { scheduleId: schedule.id, title: schedule.title })}>
            <Text style={[styles.secondaryText, font(400)]}>{t.familySend}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  place: { flex: 1, fontSize: 15, color: colors.textStrong },
  missing: { fontSize: 14, color: colors.warning, flexGrow: 1 },
  remembered: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.tint },
  rememberedText: { flex: 1, gap: 2 },
  rememberedHint: { fontSize: 13, color: colors.text },
  rememberedName: { fontSize: 15, color: colors.text },
  confirm: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 15, color: colors.onPrimary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  careRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  care: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.textStrong },
  textButton: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, color: colors.textMuted },
  outline: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, color: colors.text },
});
