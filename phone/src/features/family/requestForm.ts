import { strings } from '../../i18n/ko';
import { seoulDay } from '../calendar-sync/seoulTime';
import type { Deadline, PlaceInput, ReceivedRequest, RequestCategory } from './requestModel';

/** 서버 기준값(server/src/family/limits.ts)과 같다. 폰이 먼저 막아 서버 400을 줄이고, 서버가 마지막 방어선이다. */
export const MAX_ITEM_LENGTH = 60;
export const MAX_PERSON_LENGTH = 40;
export const MAX_PLACE_LENGTH = 100;
export const MAX_MEMO_LENGTH = 100;
export const MAX_COMPANIONS = 10;
/** 차가 메모를 읽는 길이(정책서 10.10 '한 줄 30자 이하면 읽고, 길면 메모가 있어요만'). 넘으면 안내만 하고 막지 않는다. */
export const MEMO_READ_LIMIT = 30;
const DAY_MS = 86_400_000;

export type DayChoice = 'today' | 'tomorrow';
export type RecipientChoice = { kind: 'member'; memberId: string } | { kind: 'car'; carRef: string };

export type RequestForm = {
  category: RequestCategory | null;
  recipient: RecipientChoice | null;
  day: DayChoice;
  /** 약속·데려다주기·픽업의 시각, 들르기 기한의 시각(`HH:MM`) */
  time: string;
  item: string;
  timing: 'take-along' | 'bring-back' | null;
  deadlineType: 'today' | 'by';
  place: PlaceInput;
  companions: string;
  who: string;
  pickup: PlaceInput;
  dropoff: PlaceInput;
  memo: string;
};

export const emptyForm = (): RequestForm => ({
  category: null,
  recipient: null,
  day: 'today',
  time: '',
  item: '',
  timing: null,
  deadlineType: 'today',
  place: { text: '' },
  companions: '',
  who: '',
  pickup: { text: '' },
  dropoff: { text: '' },
  memo: '',
});

/** 오류가 붙는 칸. */
export type FieldKey = 'category' | 'recipient' | 'item' | 'timing' | 'time' | 'place' | 'companions' | 'who' | 'pickup' | 'dropoff' | 'memo';
export type FormErrors = Partial<Record<FieldKey, string>>;

/** 서버가 받는 `POST /requests` 본문(항목이 카테고리마다 다른 평평한 모양). */
export type CreateRequestBody = {
  category: RequestCategory;
  recipient: { memberId: string } | { carRef: string };
  memo?: string;
} & Record<string, unknown>;

const oneLine = (v: string) => v.trim().replace(/\s+/g, ' ');

/** `1830`·`930`·`18:30`·`9:30`을 `HH:MM`으로. 시각이 아니면 null(숫자 키패드에는 콜론이 없어 콜론 없이도 받는다). */
export function normalizeTime(raw: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

/** 서울 날짜 번호를 `YYYY-MM-DD`로. */
const formatDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** 오늘·내일(서울)의 날짜 문자열. */
export const dateOf = (choice: DayChoice, now: Date): string => formatDay(seoulDay(now.getTime()) + (choice === 'tomorrow' ? 1 : 0));

const placeError = (place: PlaceInput, errors: FormErrors, key: 'place' | 'pickup' | 'dropoff') => {
  if (oneLine(place.text) === '') errors[key] = strings.familyRequest.errors.placeEmpty;
};

const placeBody = (place: PlaceInput) => {
  const text = oneLine(place.text);
  return place.lat !== undefined && place.lng !== undefined ? { text, lat: place.lat, lng: place.lng } : { text };
};

/** 쉼표·가운뎃점·슬래시로 나눈 이름들(빈 이름은 버린다). */
export const parseCompanions = (raw: string): string[] => raw.split(/[,，、·/]/).map(oneLine).filter((name) => name !== '');

/**
 * 폼 값을 서버 본문으로 바꾼다. 틀린 칸이 있으면 칸별 오류 문구를 돌려준다.
 * - 약속·데려다주기·픽업의 시각은 오늘·내일(서울) + `HH:MM`이고 지금보다 앞선 시각은 거절한다(서버는 10분 여유를 두지만 폰은 더 엄격하다).
 * - 들르기 기한은 '오늘 중' 또는 `HH:MM`까지. 채비·들르기의 날짜는 오늘·내일이다.
 * - 들르기 기한이 오늘의 이미 지난 시각이면 막는다.
 * - 메모는 한 줄로 정리해 100자까지(차가 읽는 30자는 안내만).
 * - 오늘·내일은 폼을 연 때(`openedAt`)의 서울 날짜를 기준으로 고정한다(자정을 넘겨 열려 있어도 '오늘'이 몰래 바뀌지 않게. 보낼 때 날짜가 바뀌었는지는 화면이 `seoulDay`로 확인한다).
 *   지난 시각 판정은 지금(`now`) 기준이다.
 */
export function buildRequest(form: RequestForm, now: Date = new Date(), openedAt: Date = now): { ok: true; body: CreateRequestBody } | { ok: false; errors: FormErrors } {
  const e = strings.familyRequest.errors;
  const errors: FormErrors = {};
  if (form.category === null) return { ok: false, errors: { category: e.category } };
  if (form.recipient === null) errors.recipient = e.recipient;

  const memo = oneLine(form.memo);
  if (memo.length > MAX_MEMO_LENGTH) errors.memo = e.memoLong;

  const body: Record<string, unknown> = { category: form.category };
  const date = dateOf(form.day, openedAt);

  /** 시각 칸을 `at`(오프셋 있는 ISO8601)으로. */
  const atOf = (): string | null => {
    const time = normalizeTime(form.time);
    if (time === null) {
      errors.time = e.timeInvalid;
      return null;
    }
    const at = `${date}T${time}:00+09:00`;
    if (Date.parse(at) < now.getTime()) {
      errors.time = e.timePast;
      return null;
    }
    return at;
  };

  switch (form.category) {
    case 'care': {
      const item = oneLine(form.item);
      if (item === '') errors.item = e.itemEmpty;
      else if (item.length > MAX_ITEM_LENGTH) errors.item = e.itemLong;
      if (form.timing === null) errors.timing = e.timing;
      body.item = item;
      body.timing = form.timing;
      body.date = date;
      break;
    }
    case 'stop': {
      placeError(form.place, errors, 'place');
      const item = oneLine(form.item);
      if (item === '') errors.item = e.itemEmpty;
      else if (item.length > MAX_ITEM_LENGTH) errors.item = e.itemLong;
      let deadline: Deadline = { type: 'today' };
      if (form.deadlineType === 'by') {
        const time = normalizeTime(form.time);
        if (time === null) errors.time = e.deadlineInvalid;
        else if (Date.parse(`${date}T${time}:00+09:00`) < now.getTime()) errors.time = e.deadlinePast;
        else deadline = { type: 'by', time };
      }
      body.place = placeBody(form.place);
      body.item = item;
      body.deadline = deadline;
      body.date = date;
      break;
    }
    case 'appointment': {
      const at = atOf();
      placeError(form.place, errors, 'place');
      const companions = parseCompanions(form.companions);
      if (companions.length > MAX_COMPANIONS) errors.companions = e.companionsMany;
      else if (companions.some((name) => name.length > MAX_PERSON_LENGTH)) errors.companions = e.companionLong;
      body.at = at;
      body.place = placeBody(form.place);
      if (companions.length > 0) body.companions = companions;
      break;
    }
    case 'ride': {
      const who = oneLine(form.who);
      if (who === '') errors.who = e.whoEmpty;
      else if (who.length > MAX_PERSON_LENGTH) errors.who = e.whoLong;
      placeError(form.pickup, errors, 'pickup');
      placeError(form.dropoff, errors, 'dropoff');
      body.who = who;
      body.pickup = placeBody(form.pickup);
      body.dropoff = placeBody(form.dropoff);
      body.at = atOf();
      break;
    }
  }

  if (Object.keys(errors).length > 0 || form.recipient === null) return { ok: false, errors };
  body.recipient = form.recipient.kind === 'member' ? { memberId: form.recipient.memberId } : { carRef: form.recipient.carRef };
  if (memo !== '') body.memo = memo;
  return { ok: true, body: body as CreateRequestBody };
}

/** 폰과 서버 시계가 어긋나도 '방금 보낸 것'으로 보는 여유(밀리초). */
const CLOCK_SKEW_MS = 2 * 60_000;

const sameDeadline = (a: unknown, b: Deadline) => {
  const d = a as Deadline | undefined;
  return d?.type === b.type && (d.type === 'today' || (b.type === 'by' && d.time === b.time));
};
const textOf = (place: unknown) => (typeof place === 'object' && place !== null ? (place as { text?: unknown }).text : undefined);

/**
 * 이 요청 본문이 보낸 목록의 `request`와 같은 요청인가: 카테고리·받는 사람·핵심 항목(물건·장소 글자·기한·시각·누구를)·메모가 같고 `sinceMs`(보내기 시작한 때) 이후에 만들어졌다.
 * 보내기가 결과를 알 수 없이 실패했을 때(시간 초과·네트워크·5xx) 서버가 이미 받았는지 가리는 데 쓴다(서버에 중복 방지 키가 없어서 폰이 막는다).
 */
export function matchesSent(body: CreateRequestBody, request: ReceivedRequest, sinceMs: number): boolean {
  if (Date.parse(request.createdAt) < sinceMs - CLOCK_SKEW_MS) return false;
  if (request.category !== body.category) return false;
  const to = body.recipient as { memberId?: string; carRef?: string };
  if (to.memberId !== undefined) {
    if (request.to.kind !== 'member' || request.to.memberId !== to.memberId) return false;
  } else if (request.to.kind !== 'car' || request.to.carRef !== to.carRef) return false;
  if ((typeof body.memo === 'string' ? body.memo : null) !== request.memo) return false;
  const sameAt = (a: unknown, b: string) => typeof a === 'string' && Date.parse(a) === Date.parse(b);
  switch (request.category) {
    case 'care':
      return body.item === request.item && body.timing === request.timing;
    case 'stop':
      return textOf(body.place) === request.place.text && body.item === request.item && sameDeadline(body.deadline, request.deadline);
    case 'appointment':
      return sameAt(body.at, request.at) && textOf(body.place) === request.place.text;
    case 'ride':
      return body.who === request.who && textOf(body.pickup) === request.pickup.text && textOf(body.dropoff) === request.dropoff.text && sameAt(body.at, request.at);
  }
}
