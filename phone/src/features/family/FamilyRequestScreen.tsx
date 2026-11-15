import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { SetupHeader } from '../../ui/SetupHeader';
import { ErrorBlock, LoadingBlock, OutlineButton } from '../../ui/blocks';
import { colors, useFont } from '../../ui/theme';
import { listenForPlace } from '../places/placePicker';
import { FamilyHttpError, familyGroupApi, type FamilyGroupApi, type FamilyView } from './familyGroupApi';
import { Choice, Field, Input, PrimaryButton } from './formBlocks';
import { seoulDay } from '../calendar-sync/seoulTime';
import { buildRequest, emptyForm, matchesSent, MAX_ITEM_LENGTH, MAX_MEMO_LENGTH, MAX_PERSON_LENGTH, MAX_PLACE_LENGTH, MEMO_READ_LIMIT, normalizeTime, type CreateRequestBody, type FormErrors, type RequestForm } from './requestForm';
import { CATEGORIES, type PlaceInput, type RequestCategory } from './requestModel';
import { useFamilyGroup } from './useFamilyGroup';

const t = strings.familyRequest;

/** 장소 칸이 고른 장소를 돌려받는 키(`PlaceSearchScreen`의 `pickerKey`). 화면이 하나씩만 열리므로 칸마다 하나면 된다. */
const PICKER = { place: 'request-place', pickup: 'request-pickup', dropoff: 'request-dropoff' } as const;
type PlaceKey = keyof typeof PICKER;

type Props = { api?: FamilyGroupApi; timeoutMs?: number; now?: () => Date };

/**
 * 서버 거절을 사용자 문구로. 서버가 준 문장에는 기대지 않고 이유 코드(`reason`)와 상태만 본다(지난 시각 같은 입력 오류는 폰이 먼저 걸러 서버까지 오지 않는다).
 * `indeterminate`는 서버가 받았는지 알 수 없는 실패(네트워크·시간 초과·5xx)다: 이미 보내졌을 수 있어 화면이 보낸 목록을 다시 읽어 확인한다.
 */
export function sendIssueMessage(error: unknown): { message: string; reloadFamily: boolean; indeterminate: boolean } {
  const known = (message: string, reloadFamily = false) => ({ message, reloadFamily, indeterminate: false });
  if (error instanceof FamilyHttpError) {
    switch (error.reason) {
      case 'self':
        return known(t.selfRecipient);
      case 'unknown-car':
        return known(t.unknownCar, true);
      case 'unknown-recipient':
        return known(t.unknownRecipient, true);
      case 'not-in-family':
      case 'unknown-member':
        return known(t.notInFamily, true);
      case 'too-many-requests':
        return known(t.tooMany);
      case 'bad-request':
        return known(t.badRequest);
    }
    if (error.status === 401) return known(t.notInFamily, true);
    if (error.status >= 400 && error.status < 500) return known(t.badRequest);
  }
  return { message: t.sendFailed, reloadFamily: false, indeterminate: true };
}

/** 장소 칸: 글자를 직접 적거나 [장소 찾기]로 고른다. 고르면 글자와 좌표가 함께 들어가고, 글자를 고치면 좌표는 버린다(글자만 보낸다). */
function PlaceInputField({ label, inputTestID, value, error, onChange, onSearch, disabled }: { label: string; inputTestID: string; value: PlaceInput; error?: string; onChange: (value: PlaceInput) => void; onSearch: () => void; disabled: boolean }) {
  const hasCoords = value.lat !== undefined && value.lng !== undefined;
  return (
    <Field label={label} error={error} hint={hasCoords ? t.placeWithCoords : value.text.trim() !== '' ? t.placeTextOnly : undefined}>
      <Input testID={inputTestID} accessibilityLabel={label} value={value.text} onChangeText={(text) => onChange({ text })} maxLength={MAX_PLACE_LENGTH} placeholder={t.placeText} editable={!disabled} invalid={!!error} returnKeyType="done" />
      <OutlineButton label={t.placeSearch} accessibilityLabel={t.placeSearchLabel(label)} onPress={onSearch} disabled={disabled} />
    </Field>
  );
}

/**
 * 요청 만들기(정책서 10.10 '카테고리 → 받는 사람 → 장소·시간 → 한 줄 메모'). 카테고리 4종(채비·들르기·약속 가기·데려다주기·픽업), 받는 사람은 가족 한 사람 또는 '우리 차'
 * (`GET /family`의 `cars`, 차가 없으면 선택지에 안 보임). 장소 칸은 장소 검색 화면(`PlaceSearchScreen`)을 열어 글자 + 좌표로 채우거나 글자만 넣는다.
 * 메모는 한 줄 30자 안내(넘으면 차가 '메모가 있어요'만 말한다). 날짜는 오늘·내일만. 보내면 가족 탭의 그 요청으로 간다.
 * 상태: 가족 로딩·오류(다시 시도)·가족 없음(가족 탭으로)·정상, 보내는 중, 입력 오류(칸별)·서버 오류.
 */
export function FamilyRequestScreen({ api = familyGroupApi, timeoutMs = REQUEST_TIMEOUT_MS, now = () => new Date() }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useFont();
  const group = useFamilyGroup({ api, timeoutMs });
  const [form, setForm] = useState<RequestForm>(emptyForm);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  /** 폼을 연 때(자정 경계: 고른 '오늘·내일'은 이 날짜 기준으로 고정하고, 보낼 때 날짜가 바뀌었으면 다시 확인하게 한다). */
  const [openedAt, setOpenedAt] = useState(() => now());
  const [issue, setIssue] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const checkRequest = useRef<AbortController | null>(null);

  const patch = (change: Partial<RequestForm>) => setForm((prev) => ({ ...prev, ...change }));

  // 장소 검색 화면이 고른 장소를 해당 칸에 채운다.
  useEffect(() => {
    const offs = (Object.keys(PICKER) as PlaceKey[]).map((key) => listenForPlace(PICKER[key], (picked) => setForm((prev) => ({ ...prev, [key]: { ...picked, text: picked.text.slice(0, MAX_PLACE_LENGTH) } }))));
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
    checkRequest.current?.abort();
    checkRequest.current = null;
  }, []);

  const result = buildRequest(form, now(), openedAt);
  const errors: FormErrors = submitted && !result.ok ? result.errors : {};

  useEffect(() => {
    if (issue) AccessibilityInfo.announceForAccessibility(issue);
  }, [issue]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/family');
  }, [router]);

  const search = (key: PlaceKey) => router.push({ pathname: '/setup/place-search', params: { picker: PICKER[key] } });

  /** 결과를 알 수 없이 실패한 뒤 보낸 목록을 다시 읽어 같은 요청이 이미 있는지 본다. 있으면 그 요청, 없으면 null, 읽지 못하면 undefined. */
  const findAlreadySent = async (body: CreateRequestBody, sinceMs: number) => {
    const controller = new AbortController();
    checkRequest.current = controller;
    try {
      const lists = await requestWithTimeout((signal) => api.fetchRequests(signal), timeoutMs, controller);
      return lists.sent.find((r) => matchesSent(body, r, sinceMs)) ?? null;
    } catch {
      return undefined;
    } finally {
      if (checkRequest.current === controller) checkRequest.current = null;
    }
  };

  const send = async () => {
    if (request.current || checkRequest.current) return;
    setSubmitted(true);
    setIssue(null);
    // 자정을 넘겨 폼이 열려 있었으면 '오늘·내일'이 달라졌으므로 보내지 않고 다시 확인하게 한다.
    if (seoulDay(now().getTime()) !== seoulDay(openedAt.getTime())) {
      setOpenedAt(now());
      setIssue(t.dateChanged);
      return;
    }
    const built = buildRequest(form, now(), openedAt);
    if (!built.ok) {
      AccessibilityInfo.announceForAccessibility(t.errors.fixBelow);
      return;
    }
    const controller = new AbortController();
    const startedAt = now().getTime();
    request.current = controller;
    setSending(true);
    const goToRequest = (id: string) => router.navigate({ pathname: '/family', params: { request: id } });
    try {
      const created = await requestWithTimeout((signal) => api.createRequest(built.body, signal), timeoutMs, controller);
      if (request.current !== controller) return;
      // 보낸 요청의 상태를 가족 탭에서 바로 본다(그 요청을 맨 위에 표시).
      goToRequest(created.id);
    } catch (error) {
      if (request.current !== controller) return;
      const { message, reloadFamily, indeterminate } = sendIssueMessage(error);
      if (indeterminate) {
        // 서버가 받았는지 모른다: 다시 보내면 중복될 수 있으니 목록을 읽어 먼저 확인한다(서버에 중복 방지 키가 없다).
        setChecking(true);
        const found = await findAlreadySent(built.body, startedAt);
        setChecking(false);
        if (request.current !== controller) return;
        if (found) {
          goToRequest(found.id);
          return;
        }
        setIssue(found === null ? t.sendNotFound : message);
      } else {
        setIssue(message);
        if (reloadFamily) {
          patch({ recipient: null });
          group.retry();
        }
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setSending(false);
      }
    }
  };

  const { state } = group;
  const family: FamilyView | null = state.status === 'ready' ? state.family : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SetupHeader />
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={[styles.title, font(600)]}>{t.title}</Text>
          <Text style={[styles.description, font(400)]}>{t.description}</Text>
        </View>

        {state.status === 'loading' ? (
          <LoadingBlock label={t.loading} />
        ) : state.status === 'error' ? (
          <ErrorBlock message={t.loadFailed} retryLabel={t.retry} onRetry={group.retry} />
        ) : family === null ? (
          <View testID="request-need-family" style={styles.block}>
            <Text style={[styles.text, font(400)]}>{t.needFamily}</Text>
            <OutlineButton label={t.openFamily} onPress={() => router.navigate('/family')} />
          </View>
        ) : (
          <>
            <View style={styles.block} testID="request-category">
              <Text accessibilityRole="header" style={[styles.heading, font(600)]}>{t.categoryHeading}</Text>
              <View style={styles.choices} accessibilityRole="radiogroup">
                {CATEGORIES.map((category) => (
                  <Choice key={category} testID={`request-category-${category}`} label={strings.family.category[category]} detail={t.categoryHint[category]}
                    selected={form.category === category} onPress={() => patch({ category })} />
                ))}
              </View>
              {errors.category ? <Text accessibilityLiveRegion="polite" style={[styles.error, font(500)]}>{errors.category}</Text> : null}
            </View>

            {form.category !== null ? (
              <>
                <RecipientBlock family={family} value={form.recipient} error={errors.recipient} onChange={(recipient) => patch({ recipient })} />
                <DetailsBlock category={form.category} form={form} errors={errors} disabled={sending} patch={patch} search={search} />
                <MemoBlock value={form.memo} error={errors.memo} disabled={sending} onChange={(memo) => patch({ memo })} />

                {issue ? <Text testID="request-issue" accessibilityLiveRegion="polite" style={[styles.error, font(500)]}>{issue}</Text> : null}
                {submitted && !result.ok ? <Text accessibilityLiveRegion="polite" style={[styles.error, font(500)]}>{t.errors.fixBelow}</Text> : null}
                {sending ? <LoadingBlock label={checking ? t.checking : t.sending} /> : null}
                <PrimaryButton label={t.send} onPress={() => void send()} disabled={sending} testID="request-send" />
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable accessibilityRole="button" onPress={close} style={styles.cancel}>
          <Text style={[styles.cancelText, font(400)]}>{strings.family.cancel}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** 받는 사람: 가족 한 사람 또는 '우리 차'(가족 폰이 연결된 차, 없으면 선택지에 안 보인다). */
function RecipientBlock({ family, value, error, onChange }: { family: FamilyView; value: RequestForm['recipient']; error?: string; onChange: (value: NonNullable<RequestForm['recipient']>) => void }) {
  const font = useFont();
  const others = family.members.filter((m) => !m.isMe);
  const nameOf = (memberId: string) => family.members.find((m) => m.memberId === memberId)?.name ?? '';
  return (
    <View style={styles.block} testID="request-recipient">
      <Text accessibilityRole="header" style={[styles.heading, font(600)]}>{t.recipientHeading}</Text>
      {others.length === 0 && family.cars.length === 0 ? <Text style={[styles.text, font(400)]}>{t.recipientNone}</Text> : null}
      <View style={styles.choices} accessibilityRole="radiogroup">
        {others.map((member) => (
          <Choice key={member.memberId} testID={`request-recipient-${member.memberId}`} label={member.name} detail={member.connected ? strings.family.memberCarConnected : strings.family.memberCarNotConnected}
            selected={value?.kind === 'member' && value.memberId === member.memberId} onPress={() => onChange({ kind: 'member', memberId: member.memberId })} />
        ))}
        {family.cars.map((car, index) => {
          const names = car.memberIds.map(nameOf).filter((n) => n !== '').join(', ');
          const label = family.cars.length === 1 ? t.recipientCar : `${t.recipientCar} ${index + 1}`;
          return (
            <Choice key={car.carRef} testID={`request-recipient-${car.carRef}`} label={label} accessibilityLabel={family.cars.length === 1 ? t.recipientCarWith(names) : t.recipientCarN(index + 1, names)}
              detail={names !== '' ? t.recipientCarDetail(names) : undefined} selected={value?.kind === 'car' && value.carRef === car.carRef} onPress={() => onChange({ kind: 'car', carRef: car.carRef })} />
          );
        })}
      </View>
      {family.cars.length === 0 && others.length > 0 ? <Text style={[styles.hint, font(400)]}>{t.recipientCarNone}</Text> : null}
      {others.length > 0 ? <Text style={[styles.hint, font(400)]}>{t.recipientMemberHint}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, font(500)]}>{error}</Text> : null}
    </View>
  );
}

/** 날짜(오늘·내일)와 시각, 카테고리별 항목. */
function DetailsBlock({ category, form, errors, disabled, patch, search }: {
  category: RequestCategory;
  form: RequestForm;
  errors: FormErrors;
  disabled: boolean;
  patch: (change: Partial<RequestForm>) => void;
  search: (key: PlaceKey) => void;
}) {
  const font = useFont();
  const f = strings.family;
  const dayChoice = (
    <Field label={t.day} hint={t.dayHint}>
      <View style={styles.choicesRow} accessibilityRole="radiogroup">
        <Choice testID="request-day-today" label={f.day.today} selected={form.day === 'today'} onPress={() => patch({ day: 'today' })} />
        <Choice testID="request-day-tomorrow" label={f.day.tomorrow} selected={form.day === 'tomorrow'} onPress={() => patch({ day: 'tomorrow' })} />
      </View>
    </Field>
  );
  const timeInput = (label: string, error?: string) => (
    <Field label={label} hint={t.timeHint} error={error}>
      <Input testID="request-time-input" accessibilityLabel={label} value={form.time} onChangeText={(time) => patch({ time: time.replace(/[^\d:]/g, '') })} onEndEditing={() => { const n = normalizeTime(form.time); if (n !== null) patch({ time: n }); }}
        keyboardType="number-pad" maxLength={5} placeholder={t.timePlaceholder} editable={!disabled} invalid={!!error} returnKeyType="done" />
    </Field>
  );

  return (
    <View style={styles.block} testID="request-details">
      <Text accessibilityRole="header" style={[styles.heading, font(600)]}>{t.detailsHeading}</Text>
      {category === 'care' ? (
        <>
          <Field label={t.item} error={errors.item}>
            <Input testID="request-item-input" accessibilityLabel={t.item} value={form.item} onChangeText={(item) => patch({ item })} maxLength={MAX_ITEM_LENGTH} placeholder={t.itemPlaceholder} editable={!disabled} invalid={!!errors.item} returnKeyType="done" />
          </Field>
          <Field label={t.timing} error={errors.timing}>
            <View style={styles.choicesRow} accessibilityRole="radiogroup">
              <Choice testID="request-timing-take-along" label={f.timing['take-along']} selected={form.timing === 'take-along'} onPress={() => patch({ timing: 'take-along' })} />
              <Choice testID="request-timing-bring-back" label={f.timing['bring-back']} selected={form.timing === 'bring-back'} onPress={() => patch({ timing: 'bring-back' })} />
            </View>
          </Field>
          {dayChoice}
        </>
      ) : null}

      {category === 'stop' ? (
        <>
          <PlaceInputField label={t.stopPlace} inputTestID="request-place-input" value={form.place} error={errors.place} onChange={(place) => patch({ place })} onSearch={() => search('place')} disabled={disabled} />
          <Field label={t.stopItem} error={errors.item}>
            <Input testID="request-item-input" accessibilityLabel={t.stopItem} value={form.item} onChangeText={(item) => patch({ item })} maxLength={MAX_ITEM_LENGTH} placeholder={t.stopItemPlaceholder} editable={!disabled} invalid={!!errors.item} returnKeyType="done" />
          </Field>
          <Field label={t.deadline}>
            <View style={styles.choicesRow} accessibilityRole="radiogroup">
              <Choice testID="request-deadline-today" label={f.deadline.today} selected={form.deadlineType === 'today'} onPress={() => patch({ deadlineType: 'today' })} />
              <Choice testID="request-deadline-by" label={t.deadlineByChoice} selected={form.deadlineType === 'by'} onPress={() => patch({ deadlineType: 'by' })} />
            </View>
          </Field>
          {form.deadlineType === 'by' ? timeInput(t.deadlineTime, errors.time) : null}
          {dayChoice}
        </>
      ) : null}

      {category === 'appointment' ? (
        <>
          {dayChoice}
          {timeInput(t.time, errors.time)}
          <PlaceInputField label={t.appointmentPlace} inputTestID="request-place-input" value={form.place} error={errors.place} onChange={(place) => patch({ place })} onSearch={() => search('place')} disabled={disabled} />
          <Field label={t.companions} hint={t.companionsHint} error={errors.companions}>
            <Input testID="request-companions-input" accessibilityLabel={t.companions} value={form.companions} onChangeText={(companions) => patch({ companions })} placeholder={t.companionsPlaceholder} editable={!disabled} invalid={!!errors.companions} returnKeyType="done" />
          </Field>
        </>
      ) : null}

      {category === 'ride' ? (
        <>
          <Field label={t.who} error={errors.who}>
            <Input testID="request-who-input" accessibilityLabel={t.who} value={form.who} onChangeText={(who) => patch({ who })} maxLength={MAX_PERSON_LENGTH} placeholder={t.whoPlaceholder} editable={!disabled} invalid={!!errors.who} returnKeyType="done" />
          </Field>
          <PlaceInputField label={t.pickup} inputTestID="request-pickup-input" value={form.pickup} error={errors.pickup} onChange={(pickup) => patch({ pickup })} onSearch={() => search('pickup')} disabled={disabled} />
          <PlaceInputField label={t.dropoff} inputTestID="request-dropoff-input" value={form.dropoff} error={errors.dropoff} onChange={(dropoff) => patch({ dropoff })} onSearch={() => search('dropoff')} disabled={disabled} />
          {dayChoice}
          {timeInput(t.ridePickupTime, errors.time)}
        </>
      ) : null}
    </View>
  );
}

/** 한 줄 메모. 30자 안쪽이면 차가 읽고, 넘으면 '메모가 있어요'만 말한다(막지는 않는다). */
function MemoBlock({ value, error, disabled, onChange }: { value: string; error?: string; disabled: boolean; onChange: (value: string) => void }) {
  const font = useFont();
  const length = value.trim().replace(/\s+/g, ' ').length;
  return (
    <View style={styles.block} testID="request-memo">
      <Field label={t.memoHeading} hint={length > MEMO_READ_LIMIT ? undefined : t.memoHint} error={error}>
        <Input testID="request-memo-input" accessibilityLabel={t.memoHeading} value={value} onChangeText={(text) => onChange(text.replace(/[\r\n]+/g, ' '))} maxLength={MAX_MEMO_LENGTH} placeholder={t.memoPlaceholder} editable={!disabled} invalid={!!error} returnKeyType="done" />
      </Field>
      <Text accessibilityLiveRegion="polite" style={[styles.hint, font(400)]}>{length > MEMO_READ_LIMIT ? `${t.memoCount(length)} · ${t.memoLongInfo}` : t.memoCount(length)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 22 },
  titles: { gap: 10 },
  title: { fontSize: 28, lineHeight: 36, color: colors.text },
  description: { fontSize: 16, lineHeight: 24, color: colors.textStrong },
  block: { gap: 12 },
  heading: { fontSize: 18, lineHeight: 26, color: colors.text },
  choices: { gap: 8 },
  choicesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { fontSize: 15, lineHeight: 22, color: colors.textStrong },
  hint: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  error: { fontSize: 14, lineHeight: 21, color: colors.error },
  footer: { paddingHorizontal: 20, paddingTop: 4 },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, color: colors.textMuted },
});
